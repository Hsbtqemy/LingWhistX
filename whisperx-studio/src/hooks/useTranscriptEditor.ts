import React, { useEffect, useMemo, useRef, useState } from "react";
import { MIN_SEGMENT_DURATION_SEC, defaultExportRules } from "../constants";
import {
  buildEditorSnapshot,
  cloneEditorSnapshot,
  closestSegmentIndex,
  isPreviewableFile,
  normalizeExportRules,
} from "../appUtils";
import type {
  AnnotationSegment,
  EditableSegment,
  EditorSnapshot,
  ExportCorrectionReport,
  ExportTimingRules,
  FocusedSegmentInfo,
} from "../types";
import {
  attachTranscriptEditorKeyboard,
  type AttachTranscriptEditorKeyboardArgs,
} from "./transcript/transcriptEditorKeyboard";
import { exportTimingPackSequential } from "./transcript/transcriptEditorExportSequences";
import {
  hasTranscriptSourcePath,
  isTranscriptEditorReadyForIo,
  runWithEditorSavingFlag,
  TRANSCRIPT_EDITOR_NOT_LOADED_ERROR,
} from "./transcript/transcriptEditorIoHelpers";
import { loadTranscriptFromPath } from "./transcript/transcriptEditorLoad";
import {
  tauriExportTranscript,
  tauriSaveTranscriptJson,
  tauriSyncPlayerTimelineFromTranscript,
} from "./transcript/transcriptEditorTauri";
import type { WaveformPointerContext } from "./transcript/waveformPointer";
import { computeEditorDirtyFromBaseline } from "./transcript/computeEditorDirty";
import { relativeSegmentIndex } from "./transcript/transcriptEditorNavigation";
import {
  buildSplitPair,
  computeSplitAtCursor,
  mergeTwoEditableSegments,
} from "./transcript/transcriptEditorSplitMerge";
import {
  createSegmentFromRangeInSnapshot,
  insertBlankSegmentInSnapshot,
} from "./transcript/transcriptSegmentMutations";
import { useTranscriptWaveformInteraction } from "./transcript/useTranscriptWaveformInteraction";
import { useEditorDraftPersistence } from "./transcript/useEditorDraftPersistence";
import { useEditorHistory } from "./transcript/useEditorHistory";
import { useEditorQa } from "./transcript/useEditorQa";
import type { WaveformWorkspace } from "./useWaveformWorkspace";

export type UseTranscriptEditorOptions = {
  wf: WaveformWorkspace;
  refreshJobs: () => Promise<void>;
  previewOutput: (path: string) => Promise<void>;
  selectedJobId: string;
  /** Dossier du run (onglet Éditeur) : après sauvegarde JSON, sync timeline → events pour le Player. */
  runDirForPlayerSync?: string;
  /** Appelé après une sync Player réussie (ex. rafraîchir la fenêtre événements). */
  onTranscriptPersistedForPlayer?: () => void;
};

export function useTranscriptEditor({
  wf,
  refreshJobs,
  previewOutput,
  selectedJobId,
  runDirForPlayerSync,
  onTranscriptPersistedForPlayer,
}: UseTranscriptEditorOptions) {
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [editorSourcePath, setEditorSourcePath] = useState<string>("");
  const [editorLanguage, setEditorLanguage] = useState<string>("");
  const [editorSegments, setEditorSegments] = useState<EditableSegment[]>([]);
  const [editorVisibleCount, setEditorVisibleCount] = useState<number>(120);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorStatus, setEditorStatus] = useState<string>("");
  const [editorError, setEditorError] = useState<string>("");
  const [editorLastOutputPath, setEditorLastOutputPath] = useState<string>("");
  const [exportRules, setExportRules] = useState<ExportTimingRules>(defaultExportRules);
  const [lastExportReport, setLastExportReport] = useState<ExportCorrectionReport | null>(null);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const editorSegmentsRef = useRef<EditableSegment[]>([]);
  const editorLanguageRef = useRef("");
  const editorBaselineRef = useRef<EditorSnapshot | null>(null);
  const transcriptKeyboardArgsRef = useRef<AttachTranscriptEditorKeyboardArgs | null>(null);

  function getCurrentEditorSnapshot(): EditorSnapshot {
    return buildEditorSnapshot(editorLanguageRef.current, editorSegmentsRef.current);
  }

  function updateEditorDirtyFromSnapshot(snapshot: EditorSnapshot) {
    setEditorDirty(computeEditorDirtyFromBaseline(snapshot, editorBaselineRef.current));
  }

  function setEditorSnapshotState(snapshot: EditorSnapshot) {
    const next = cloneEditorSnapshot(snapshot);
    editorLanguageRef.current = next.language;
    editorSegmentsRef.current = next.segments;
    setEditorLanguage(next.language);
    setEditorSegments(next.segments);
    updateEditorDirtyFromSnapshot(next);
  }

  const {
    editorUndoStack,
    editorRedoStack,
    editorHistoryLimitInput,
    setEditorHistoryLimitInput,
    editorHistoryLimit,
    setHistoryStacks,
    applyEditorSnapshotMutation,
    applyEditorPatch,
    pushUndoSnapshot,
    undoEditorChange,
    redoEditorChange,
    canUndoEditor,
    canRedoEditor,
  } = useEditorHistory({
    getCurrentSnapshot: getCurrentEditorSnapshot,
    applySnapshot: setEditorSnapshotState,
    onUndoRedo: (kind) => {
      setEditorError("");
      setEditorStatus(kind === "undo" ? "Undo applique." : "Redo applique.");
    },
  });

  const {
    draftAutosaveSecInput,
    setDraftAutosaveSecInput,
    draftAutosaveSec,
    editorDraftPath,
    editorDraftUpdatedAtMs,
    editorAutosaveMessage,
    editorAutosaveError,
    isAutosavingDraft,
    purgeTranscriptDraft,
    clearDraftAutosaveUi,
    resetDraftAfterSuccessfulJsonSave,
    resetDraftMetaOnLoadError,
    markDraftLoadedFromDisk,
    clearDraftBecauseNoDraftFileOnDisk,
  } = useEditorDraftPersistence({
    editorSourcePath,
    editorDirty,
    getCurrentSnapshot: getCurrentEditorSnapshot,
  });

  const {
    qaGapThresholdSecInput,
    setQaGapThresholdSecInput,
    qaGapThresholdSec,
    qaMinWpsInput,
    setQaMinWpsInput,
    qaMinWps,
    qaMaxWpsInput,
    setQaMaxWpsInput,
    qaMaxWps,
    qaIssues,
    qaScannedAtMs,
    qaStatus,
    runTranscriptQaScan,
    jumpToQaIssue,
    autoFixQaIssue,
    seedQaFromLoadedSegments,
    clearQaState,
  } = useEditorQa({
    editorSourcePath,
    editorSegmentsRef,
    editorVisibleCount,
    setEditorVisibleCount,
    wf,
    applyEditorSnapshotMutation,
    setActiveSegmentIndex,
  });

  const displayedEditorSegments = useMemo(
    () => editorSegments.slice(0, editorVisibleCount),
    [editorSegments, editorVisibleCount],
  );

  const hasMoreEditorSegments = editorSegments.length > editorVisibleCount;

  const knownSpeakers = useMemo(() => {
    const set = new Set<string>();
    for (const seg of editorSegments) {
      if (seg.speaker) set.add(seg.speaker);
    }
    return Array.from(set).sort();
  }, [editorSegments]);

  const cursorTimeSec = wf.waveformCursorSec ?? wf.mediaCurrentSec;

  const waveformPointerCtx = useMemo(
    (): WaveformPointerContext => ({
      waveform: wf.waveform,
      waveformVisibleDurationSec: wf.waveformVisibleDurationSec,
      waveformViewStartSec: wf.waveformViewStartSec,
      applySnap: wf.applySnap,
    }),
    [wf.waveform, wf.waveformVisibleDurationSec, wf.waveformViewStartSec, wf.applySnap],
  );

  const nearestSegmentIndex = useMemo(
    () => closestSegmentIndex(editorSegments, cursorTimeSec),
    [cursorTimeSec, editorSegments],
  );

  const focusedSegmentIndex = useMemo(() => {
    if (activeSegmentIndex !== null && editorSegments[activeSegmentIndex]) {
      return activeSegmentIndex;
    }
    return nearestSegmentIndex;
  }, [activeSegmentIndex, editorSegments, nearestSegmentIndex]);

  const focusedSegment = useMemo((): FocusedSegmentInfo | null => {
    if (focusedSegmentIndex === null) {
      return null;
    }
    const segment = editorSegments[focusedSegmentIndex];
    if (!segment) {
      return null;
    }
    let distance = 0;
    if (cursorTimeSec < segment.start) {
      distance = segment.start - cursorTimeSec;
    } else if (cursorTimeSec > segment.end) {
      distance = cursorTimeSec - segment.end;
    }
    return {
      index: focusedSegmentIndex,
      segment,
      distanceSec: distance,
    };
  }, [cursorTimeSec, editorSegments, focusedSegmentIndex]);

  const {
    hoveredSegmentEdge,
    setHoveredSegmentEdge,
    dragSegmentState,
    setDragSegmentState,
    drawRange,
    clearDrawRange,
    updateEditorSegmentBoundary,
    onWaveformMouseDown,
    onWaveformMouseMove,
    onWaveformMouseUp,
    onWaveformMouseLeave,
    resetWaveformInteraction,
  } = useTranscriptWaveformInteraction({
    wf,
    waveformPointerCtx,
    editorSegments,
    focusedSegmentIndex,
    getCurrentEditorSnapshot,
    applyEditorSnapshotMutation,
    pushUndoSnapshot,
    setActiveSegmentIndex,
  });

  const waveformCursorStyle =
    wf.rangeDragStartSec !== null
      ? "col-resize"
      : dragSegmentState
        ? "grabbing"
        : hoveredSegmentEdge
          ? "ew-resize"
          : "crosshair";

  const actionSegmentIndex = useMemo(() => {
    if (activeSegmentIndex !== null && editorSegments[activeSegmentIndex]) {
      return activeSegmentIndex;
    }
    return focusedSegmentIndex;
  }, [activeSegmentIndex, editorSegments, focusedSegmentIndex]);

  const canSplitActiveSegment = useMemo(() => {
    if (actionSegmentIndex === null) {
      return false;
    }
    const segment = editorSegments[actionSegmentIndex];
    if (!segment) {
      return false;
    }
    return segment.end - segment.start > MIN_SEGMENT_DURATION_SEC * 2;
  }, [actionSegmentIndex, editorSegments]);

  const canMergePrev = actionSegmentIndex !== null && actionSegmentIndex > 0;
  const canMergeNext =
    actionSegmentIndex !== null && actionSegmentIndex < editorSegments.length - 1;

  async function loadTranscriptEditor(path: string) {
    setEditorError("");
    setEditorStatus("");
    setEditorLastOutputPath("");
    setLastExportReport(null);
    clearDraftAutosaveUi();
    setIsEditorLoading(true);
    try {
      const r = await loadTranscriptFromPath(path);
      if (r.draftOnDisk) {
        markDraftLoadedFromDisk(
          r.draftOnDisk.draftPath,
          r.draftOnDisk.updatedAtMs,
          r.draftOnDisk.draftSnapshot,
        );
      } else {
        clearDraftBecauseNoDraftFileOnDisk();
      }

      setEditorSourcePath(r.docPath);
      editorBaselineRef.current = cloneEditorSnapshot(r.sourceSnapshot);
      setHistoryStacks([], []);
      setEditorSnapshotState(r.loadedSnapshot);
      setEditorVisibleCount(120);
      setActiveSegmentIndex(r.loadedSnapshot.segments.length > 0 ? 0 : null);
      if (r.recoveredFromDraft) {
        setEditorStatus(
          `Transcript charge avec recovery du brouillon (${r.loadedSnapshot.segments.length} segment(s)).`,
        );
      } else {
        setEditorStatus(`Transcript charge: ${r.loadedSnapshot.segments.length} segment(s).`);
      }
      seedQaFromLoadedSegments(r.loadedSnapshot.segments);
    } catch (e) {
      editorBaselineRef.current = null;
      resetDraftMetaOnLoadError();
      setHistoryStacks([], []);
      setEditorSnapshotState(buildEditorSnapshot("", []));
      setEditorSourcePath("");
      setActiveSegmentIndex(null);
      setLastExportReport(null);
      clearQaState();
      setEditorError(String(e));
    } finally {
      setIsEditorLoading(false);
    }
  }

  function updateEditorSegmentText(index: number, text: string) {
    applyEditorPatch({
      kind: "text_change",
      index,
      prevText: editorSegmentsRef.current[index]?.text ?? "",
      nextText: text,
    });
  }

  /**
   * WX-719 — Insère un symbole d'annotation à la fin du texte du segment actif.
   * Le textarea actif garde le focus via onMouseDown+preventDefault sur les boutons toolbar.
   * La ref `activeTextareaRef` (portée par EditorSegmentList) permet d'insérer à la position
   * exacte du caret si elle est fournie ; sinon on appende en fin de texte.
   */
  function insertAnnotationMark(
    symbol: string,
    caretRef?: React.RefObject<HTMLTextAreaElement | null>,
  ) {
    const idx = activeSegmentIndex;
    if (idx === null) return;
    const seg = editorSegmentsRef.current[idx];
    if (!seg) return;
    const prevText = seg.text ?? "";
    let nextText: string;
    const textarea = caretRef?.current;
    if (textarea && document.activeElement === textarea) {
      const start = textarea.selectionStart ?? prevText.length;
      nextText = prevText.slice(0, start) + symbol + prevText.slice(textarea.selectionEnd ?? start);
    } else {
      nextText = prevText + symbol;
    }
    applyEditorPatch({ kind: "text_change", index: idx, prevText, nextText });
  }

  function updateEditorSegmentSpeaker(index: number, speaker: string | null) {
    applyEditorPatch({
      kind: "speaker_change",
      index,
      prevSpeaker: editorSegmentsRef.current[index]?.speaker,
      nextSpeaker: speaker || null,
    });
  }

  function updateEditorLanguage(nextLanguage: string) {
    applyEditorPatch({
      kind: "language_change",
      prevLanguage: editorLanguageRef.current,
      nextLanguage,
    });
  }

  function focusSegment(index: number) {
    const segment = editorSegmentsRef.current[index];
    if (!segment) {
      return;
    }
    setActiveSegmentIndex(index);
    wf.seekMedia(segment.start);
  }

  function focusRelativeSegment(delta: -1 | 1) {
    const segments = editorSegmentsRef.current;
    const nextIndex = relativeSegmentIndex(segments, actionSegmentIndex, cursorTimeSec, delta);
    if (nextIndex === null) {
      return;
    }
    focusSegment(nextIndex);
  }

  function editableTargetSegmentIndex(): number | null {
    return actionSegmentIndex;
  }

  function splitActiveSegmentAtCursor() {
    const targetIndex = editableTargetSegmentIndex();
    if (targetIndex === null) {
      setEditorError("Aucun segment actif a split.");
      return;
    }
    const segment = editorSegmentsRef.current[targetIndex];
    if (!segment) {
      setEditorError("Segment actif introuvable.");
      return;
    }

    const splitResult = computeSplitAtCursor(segment, cursorTimeSec, wf.applySnap);
    if (!splitResult.ok) {
      setEditorError(
        splitResult.reason === "segment_too_short"
          ? "Segment trop court pour un split."
          : "Position de split invalide.",
      );
      return;
    }
    const splitAt = splitResult.splitAt;
    const [leftSegment, rightSegment] = buildSplitPair(segment, splitAt);

    applyEditorPatch({
      kind: "split",
      index: targetIndex,
      original: segment,
      left: leftSegment,
      right: rightSegment,
    });
    setActiveSegmentIndex(targetIndex + 1);
    wf.setWaveformCursorSec(splitAt);
    setEditorError("");
    setEditorStatus(`Segment #${targetIndex + 1} split a ${splitAt.toFixed(3)}s.`);
  }

  function mergeActiveSegment(direction: "prev" | "next") {
    const targetIndex = editableTargetSegmentIndex();
    if (targetIndex === null) {
      setEditorError("Aucun segment actif a fusionner.");
      return;
    }

    const currentSegments = editorSegmentsRef.current;
    const neighborIndex = direction === "prev" ? targetIndex - 1 : targetIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= currentSegments.length) {
      setEditorError("Fusion impossible: segment voisin manquant.");
      return;
    }

    const firstIndex = Math.min(targetIndex, neighborIndex);
    const secondIndex = Math.max(targetIndex, neighborIndex);
    const first = currentSegments[firstIndex];
    const second = currentSegments[secondIndex];
    if (!first || !second) {
      setEditorError("Fusion impossible: segment introuvable.");
      return;
    }

    const mergedSegment = mergeTwoEditableSegments(first, second);

    applyEditorPatch({
      kind: "merge",
      firstIndex,
      secondIndex,
      seg1: first,
      seg2: second,
      merged: mergedSegment,
    });
    setActiveSegmentIndex(firstIndex);
    wf.setWaveformCursorSec(mergedSegment.start);
    setEditorError("");
    setEditorStatus(`Segments #${firstIndex + 1} et #${secondIndex + 1} fusionnes.`);
  }

  const canDeleteSegment = actionSegmentIndex !== null && editorSegments.length > 0;

  function deleteActiveSegment() {
    const targetIndex = actionSegmentIndex;
    if (targetIndex === null) {
      setEditorError("Aucun segment actif à supprimer.");
      return;
    }
    const segment = editorSegmentsRef.current[targetIndex];
    if (!segment) {
      setEditorError("Segment introuvable.");
      return;
    }
    applyEditorPatch({ kind: "delete_segment", index: targetIndex, segment });
    const newLength = editorSegmentsRef.current.length;
    if (newLength === 0) {
      setActiveSegmentIndex(null);
    } else {
      setActiveSegmentIndex(Math.min(targetIndex, newLength - 1));
    }
    setEditorError("");
    setEditorStatus(`Segment #${targetIndex + 1} supprimé.`);
  }

  function insertBlankSegment() {
    const currentSegments = editorSegmentsRef.current;
    // Insère après le segment actif, ou à la fin si aucun actif
    const afterIndex =
      actionSegmentIndex !== null
        ? actionSegmentIndex
        : currentSegments.length > 0
          ? currentSegments.length - 1
          : null;

    const atSec = cursorTimeSec;
    const maxDurationSec = wf.waveform?.durationSec ?? 0;

    const current = getCurrentEditorSnapshot();
    const { insertedIndex, segment } = insertBlankSegmentInSnapshot(
      current,
      afterIndex,
      atSec,
      maxDurationSec,
    );

    applyEditorPatch({ kind: "insert_segment", index: insertedIndex, segment });
    setActiveSegmentIndex(insertedIndex);
    wf.setWaveformCursorSec(segment.start);
    setEditorError("");
    setEditorStatus(`Segment vide inséré à ${segment.start.toFixed(3)}s.`);
  }

  function createSegmentFromRange(startSec: number, endSec: number) {
    const current = getCurrentEditorSnapshot();
    const maxDurationSec = wf.waveform?.durationSec ?? 0;
    const result = createSegmentFromRangeInSnapshot(current, startSec, endSec, maxDurationSec);
    if (!result) {
      setEditorError("Plage trop courte ou chevauchement avec un segment existant.");
      return;
    }
    applyEditorPatch({ kind: "insert_segment", index: result.insertedIndex, segment: result.segment });
    setActiveSegmentIndex(result.insertedIndex);
    wf.setWaveformCursorSec(result.segment.start);
    setEditorError("");
    setEditorStatus(
      `Segment créé : ${result.segment.start.toFixed(2)}s → ${result.segment.end.toFixed(2)}s`,
    );
  }

  async function saveEditedJson(overwrite: boolean) {
    if (!hasTranscriptSourcePath(editorSourcePath)) {
      setEditorError(TRANSCRIPT_EDITOR_NOT_LOADED_ERROR);
      return;
    }
    if (overwrite) {
      const confirmed = window.confirm("Ecraser le JSON source avec les modifications ?");
      if (!confirmed) {
        return;
      }
    }

    setEditorError("");
    setEditorStatus("");
    try {
      await runWithEditorSavingFlag(setIsEditorSaving, async () => {
        const outPath = await tauriSaveTranscriptJson({
          path: editorSourcePath,
          language: editorLanguageRef.current.trim() || null,
          segments: editorSegmentsRef.current,
          overwrite,
        });
        if (outPath.trim() && outPath !== editorSourcePath) {
          setEditorSourcePath(outPath);
        }
        const savedSnapshot = getCurrentEditorSnapshot();
        editorBaselineRef.current = savedSnapshot;
        updateEditorDirtyFromSnapshot(savedSnapshot);
        resetDraftAfterSuccessfulJsonSave();
        setEditorLastOutputPath(outPath);
        setEditorStatus(`JSON sauvegarde: ${outPath}`);
        const rd = runDirForPlayerSync?.trim();
        if (rd) {
          try {
            await tauriSyncPlayerTimelineFromTranscript(rd);
            onTranscriptPersistedForPlayer?.();
          } catch (syncErr) {
            setEditorError(`Sync Player: ${String(syncErr)}`);
          }
        }
        await refreshJobs();
      });
    } catch (e) {
      setEditorError(String(e));
    }
  }

  async function exportEditedTranscript(
    format: "json" | "srt" | "vtt" | "txt" | "csv" | "textgrid" | "eaf",
  ) {
    if (!isTranscriptEditorReadyForIo(editorSourcePath, editorSegmentsRef.current.length)) {
      setEditorError(TRANSCRIPT_EDITOR_NOT_LOADED_ERROR);
      return;
    }
    const normalizedRules = normalizeExportRules(exportRules);
    setExportRules(normalizedRules);
    setEditorError("");
    setEditorStatus("");
    try {
      await runWithEditorSavingFlag(setIsEditorSaving, async () => {
        const result = await tauriExportTranscript({
          path: editorSourcePath,
          language: editorLanguageRef.current.trim() || null,
          segments: editorSegmentsRef.current,
          format,
          rules: normalizedRules,
        });
        setEditorLastOutputPath(result.outputPath);
        setLastExportReport(result.report);
        setEditorStatus(`Export ${format.toUpperCase()} genere: ${result.outputPath}`);
        await refreshJobs();
        if (isPreviewableFile(result.outputPath)) {
          void previewOutput(result.outputPath);
        }
      });
    } catch (e) {
      setEditorError(String(e));
    }
  }

  async function exportTimingPack() {
    if (!isTranscriptEditorReadyForIo(editorSourcePath, editorSegmentsRef.current.length)) {
      setEditorError(TRANSCRIPT_EDITOR_NOT_LOADED_ERROR);
      return;
    }
    const normalizedRules = normalizeExportRules(exportRules);
    setExportRules(normalizedRules);
    setEditorError("");
    setEditorStatus("");
    try {
      await runWithEditorSavingFlag(setIsEditorSaving, async () => {
        const { lastPath, lastReport } = await exportTimingPackSequential({
          path: editorSourcePath,
          language: editorLanguageRef.current.trim() || null,
          segments: editorSegmentsRef.current,
          rules: normalizedRules,
        });
        setLastExportReport(lastReport);
        setEditorLastOutputPath(lastPath);
        setEditorStatus("Pack timing exporte (JSON + SRT + CSV a cote du transcript source).");
        await refreshJobs();
        if (lastPath && isPreviewableFile(lastPath)) {
          void previewOutput(lastPath);
        }
      });
    } catch (e) {
      setEditorError(String(e));
    }
  }

  useEffect(() => {
    setActiveSegmentIndex(null);
    resetWaveformInteraction();
  }, [selectedJobId, resetWaveformInteraction]);

  useEffect(() => {
    if (activeSegmentIndex === null) {
      return;
    }
    if (!editorSegments[activeSegmentIndex]) {
      setActiveSegmentIndex(editorSegments.length > 0 ? editorSegments.length - 1 : null);
    }
  }, [activeSegmentIndex, editorSegments]);

  transcriptKeyboardArgsRef.current = {
    editorSourcePath,
    selectedJobId,
    wf,
    undoEditorChange,
    redoEditorChange,
    focusRelativeSegment,
  };

  useEffect(() => {
    return attachTranscriptEditorKeyboard(() => transcriptKeyboardArgsRef.current!);
  }, []);

  // WX-676 — Load an annotation tier's segments into the transcript editor.
  // The tier_id is used as the speaker label on all segments.
  function loadAnnotationTier(tierId: string, segments: AnnotationSegment[]) {
    const editableSegments: EditableSegment[] = segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: tierId,
    }));
    setEditorError("");
    setEditorStatus("");
    setEditorSourcePath("");
    editorBaselineRef.current = null;
    setHistoryStacks([], []);
    setEditorSnapshotState(buildEditorSnapshot("", editableSegments));
    setEditorVisibleCount(120);
    setActiveSegmentIndex(editableSegments.length > 0 ? 0 : null);
    setEditorStatus(
      `Annotation importée: ${editableSegments.length} segment(s) — tier "${tierId}"`,
    );
    seedQaFromLoadedSegments(editableSegments);
  }

  return {
    activeSegmentIndex,
    setActiveSegmentIndex,
    hoveredSegmentEdge,
    setHoveredSegmentEdge,
    dragSegmentState,
    setDragSegmentState,
    drawRange,
    clearDrawRange,
    editorSourcePath,
    editorLanguage,
    setEditorLanguage,
    editorSegments,
    editorVisibleCount,
    setEditorVisibleCount,
    editorDirty,
    editorUndoStack,
    editorRedoStack,
    editorHistoryLimitInput,
    setEditorHistoryLimitInput,
    editorHistoryLimit,
    draftAutosaveSecInput,
    setDraftAutosaveSecInput,
    draftAutosaveSec,
    editorDraftPath,
    editorDraftUpdatedAtMs,
    editorAutosaveMessage,
    editorAutosaveError,
    isAutosavingDraft,
    qaGapThresholdSecInput,
    setQaGapThresholdSecInput,
    qaGapThresholdSec,
    qaMinWpsInput,
    setQaMinWpsInput,
    qaMinWps,
    qaMaxWpsInput,
    setQaMaxWpsInput,
    qaMaxWps,
    qaIssues,
    qaScannedAtMs,
    qaStatus,
    editorStatus,
    editorError,
    editorLastOutputPath,
    exportRules,
    setExportRules,
    lastExportReport,
    isEditorLoading,
    isEditorSaving,
    displayedEditorSegments,
    hasMoreEditorSegments,
    canUndoEditor,
    canRedoEditor,
    cursorTimeSec,
    nearestSegmentIndex,
    focusedSegmentIndex,
    focusedSegment,
    waveformCursorStyle,
    actionSegmentIndex,
    canSplitActiveSegment,
    canMergePrev,
    canMergeNext,
    canDeleteSegment,
    loadTranscriptEditor,
    knownSpeakers,
    updateEditorSegmentText,
    updateEditorSegmentSpeaker,
    updateEditorLanguage,
    undoEditorChange,
    redoEditorChange,
    purgeTranscriptDraft,
    saveEditedJson,
    exportEditedTranscript,
    exportTimingPack,
    runTranscriptQaScan,
    jumpToQaIssue,
    autoFixQaIssue,
    focusSegment,
    focusRelativeSegment,
    updateEditorSegmentBoundary,
    onWaveformMouseDown,
    onWaveformMouseMove,
    onWaveformMouseUp,
    onWaveformMouseLeave,
    splitActiveSegmentAtCursor,
    mergeActiveSegment,
    deleteActiveSegment,
    insertBlankSegment,
    createSegmentFromRange,
    loadAnnotationTier,
    insertAnnotationMark,
  };
}
