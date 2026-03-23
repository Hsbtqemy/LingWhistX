import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_DRAFT_AUTOSAVE_SEC,
  DEFAULT_EDITOR_HISTORY_LIMIT,
  DEFAULT_QA_GAP_SEC,
  DEFAULT_QA_MAX_WPS,
  DEFAULT_QA_MIN_WPS,
  MAX_DRAFT_AUTOSAVE_SEC,
  MAX_EDITOR_HISTORY_LIMIT,
  MIN_DRAFT_AUTOSAVE_SEC,
  MIN_EDITOR_HISTORY_LIMIT,
  MIN_SEGMENT_DURATION_SEC,
  defaultExportRules,
} from "../constants";
import {
  areEditorSnapshotsEqual,
  buildEditorSnapshot,
  buildTranscriptQaIssues,
  clampNumber,
  cloneEditorSnapshot,
  cloneEditableSegments,
  closestSegmentIndex,
  isPreviewableFile,
  joinSegmentTexts,
  normalizeExportRules,
  qaIssueLabel,
  roundSecondsMs,
  splitSegmentText,
} from "../appUtils";
import type {
  EditableSegment,
  EditorSnapshot,
  ExportCorrectionReport,
  ExportTimingRules,
  ExportTranscriptResponse,
  FocusedSegmentInfo,
  SaveDraftRequest,
  SaveDraftResponse,
  SegmentDragState,
  SegmentEdge,
  TranscriptDraftDocument,
  TranscriptDocument,
  TranscriptQaIssue,
} from "../types";
import { applyQaAutoFixSnapshot } from "./transcript/qaAutoFix";
import {
  attachTranscriptEditorKeyboard,
  type AttachTranscriptEditorKeyboardArgs,
} from "./transcript/transcriptEditorKeyboard";
import {
  hitTestFocusedSegmentEdge,
  secondsFromWaveformPointer,
  type WaveformPointerContext,
} from "./transcript/waveformPointer";
import type { WaveformWorkspace } from "./useWaveformWorkspace";

function trimEditorHistoryStack(stack: EditorSnapshot[], limit: number): EditorSnapshot[] {
  if (stack.length <= limit) {
    return stack;
  }
  return stack.slice(stack.length - limit);
}

export type UseTranscriptEditorOptions = {
  wf: WaveformWorkspace;
  refreshJobs: () => Promise<void>;
  previewOutput: (path: string) => Promise<void>;
  selectedJobId: string;
};

export function useTranscriptEditor({
  wf,
  refreshJobs,
  previewOutput,
  selectedJobId,
}: UseTranscriptEditorOptions) {
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [hoveredSegmentEdge, setHoveredSegmentEdge] = useState<SegmentEdge | null>(null);
  const [dragSegmentState, setDragSegmentState] = useState<SegmentDragState | null>(null);
  const [editorSourcePath, setEditorSourcePath] = useState<string>("");
  const [editorLanguage, setEditorLanguage] = useState<string>("");
  const [editorSegments, setEditorSegments] = useState<EditableSegment[]>([]);
  const [editorVisibleCount, setEditorVisibleCount] = useState<number>(120);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorUndoStack, setEditorUndoStack] = useState<EditorSnapshot[]>([]);
  const [editorRedoStack, setEditorRedoStack] = useState<EditorSnapshot[]>([]);
  const [editorHistoryLimitInput, setEditorHistoryLimitInput] = useState(
    String(DEFAULT_EDITOR_HISTORY_LIMIT),
  );
  const [draftAutosaveSecInput, setDraftAutosaveSecInput] = useState(
    String(DEFAULT_DRAFT_AUTOSAVE_SEC),
  );
  const [editorDraftPath, setEditorDraftPath] = useState("");
  const [editorDraftUpdatedAtMs, setEditorDraftUpdatedAtMs] = useState<number | null>(null);
  const [editorAutosaveMessage, setEditorAutosaveMessage] = useState("");
  const [editorAutosaveError, setEditorAutosaveError] = useState("");
  const [isAutosavingDraft, setIsAutosavingDraft] = useState(false);
  const [qaGapThresholdSecInput, setQaGapThresholdSecInput] = useState(String(DEFAULT_QA_GAP_SEC));
  const [qaMinWpsInput, setQaMinWpsInput] = useState(String(DEFAULT_QA_MIN_WPS));
  const [qaMaxWpsInput, setQaMaxWpsInput] = useState(String(DEFAULT_QA_MAX_WPS));
  const [qaIssues, setQaIssues] = useState<TranscriptQaIssue[]>([]);
  const [qaScannedAtMs, setQaScannedAtMs] = useState<number | null>(null);
  const [qaStatus, setQaStatus] = useState("");
  const [editorStatus, setEditorStatus] = useState<string>("");
  const [editorError, setEditorError] = useState<string>("");
  const [editorLastOutputPath, setEditorLastOutputPath] = useState<string>("");
  const [exportRules, setExportRules] = useState<ExportTimingRules>(defaultExportRules);
  const [lastExportReport, setLastExportReport] = useState<ExportCorrectionReport | null>(null);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const editorSegmentsRef = useRef<EditableSegment[]>([]);
  const editorLanguageRef = useRef("");
  const editorUndoStackRef = useRef<EditorSnapshot[]>([]);
  const editorRedoStackRef = useRef<EditorSnapshot[]>([]);
  const editorBaselineRef = useRef<EditorSnapshot | null>(null);
  const lastAutosavedSnapshotRef = useRef<EditorSnapshot | null>(null);
  const autosaveInFlightRef = useRef(false);
  const dragStartSnapshotRef = useRef<EditorSnapshot | null>(null);
  const dragHasHistoryChangeRef = useRef(false);
  const autosaveEditorDraftRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false);
  const transcriptKeyboardArgsRef = useRef<AttachTranscriptEditorKeyboardArgs | null>(null);

  const displayedEditorSegments = useMemo(
    () => editorSegments.slice(0, editorVisibleCount),
    [editorSegments, editorVisibleCount],
  );

  const hasMoreEditorSegments = editorSegments.length > editorVisibleCount;

  const editorHistoryLimit = useMemo(() => {
    const parsed = Number(editorHistoryLimitInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_EDITOR_HISTORY_LIMIT;
    }
    return clampNumber(Math.floor(parsed), MIN_EDITOR_HISTORY_LIMIT, MAX_EDITOR_HISTORY_LIMIT);
  }, [editorHistoryLimitInput]);
  const draftAutosaveSec = useMemo(() => {
    const parsed = Number(draftAutosaveSecInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_DRAFT_AUTOSAVE_SEC;
    }
    return clampNumber(Math.floor(parsed), MIN_DRAFT_AUTOSAVE_SEC, MAX_DRAFT_AUTOSAVE_SEC);
  }, [draftAutosaveSecInput]);
  const qaGapThresholdSec = useMemo(() => {
    const parsed = Number(qaGapThresholdSecInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_QA_GAP_SEC;
    }
    return Math.max(0, parsed);
  }, [qaGapThresholdSecInput]);
  const qaMinWps = useMemo(() => {
    const parsed = Number(qaMinWpsInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_QA_MIN_WPS;
    }
    return Math.max(0.1, parsed);
  }, [qaMinWpsInput]);
  const qaMaxWps = useMemo(() => {
    const parsed = Number(qaMaxWpsInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_QA_MAX_WPS;
    }
    return Math.max(0.1, parsed);
  }, [qaMaxWpsInput]);
  const canUndoEditor = editorUndoStack.length > 0;
  const canRedoEditor = editorRedoStack.length > 0;

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

  const waveformCursorStyle = dragSegmentState
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

  function getCurrentEditorSnapshot(): EditorSnapshot {
    return buildEditorSnapshot(editorLanguageRef.current, editorSegmentsRef.current);
  }

  function setEditorHistoryStacks(nextUndo: EditorSnapshot[], nextRedo: EditorSnapshot[]) {
    editorUndoStackRef.current = nextUndo;
    editorRedoStackRef.current = nextRedo;
    setEditorUndoStack(nextUndo);
    setEditorRedoStack(nextRedo);
  }

  function updateEditorDirtyFromSnapshot(snapshot: EditorSnapshot) {
    const baseline = editorBaselineRef.current;
    if (!baseline) {
      setEditorDirty(snapshot.segments.length > 0 || snapshot.language.trim().length > 0);
      return;
    }
    setEditorDirty(!areEditorSnapshotsEqual(snapshot, baseline));
  }

  function setEditorSnapshotState(snapshot: EditorSnapshot) {
    const next = cloneEditorSnapshot(snapshot);
    editorLanguageRef.current = next.language;
    editorSegmentsRef.current = next.segments;
    setEditorLanguage(next.language);
    setEditorSegments(next.segments);
    updateEditorDirtyFromSnapshot(next);
  }

  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    const nextUndo = trimEditorHistoryStack(
      [...editorUndoStackRef.current, cloneEditorSnapshot(snapshot)],
      editorHistoryLimit,
    );
    setEditorHistoryStacks(nextUndo, []);
  }

  function applyEditorSnapshotMutation(
    mutator: (current: EditorSnapshot) => EditorSnapshot,
    options?: { recordHistory?: boolean; clearRedo?: boolean },
  ): boolean {
    const recordHistory = options?.recordHistory ?? true;
    const clearRedo = options?.clearRedo ?? true;
    const currentSnapshot = getCurrentEditorSnapshot();
    const candidateSnapshot = cloneEditorSnapshot(mutator(currentSnapshot));
    if (areEditorSnapshotsEqual(currentSnapshot, candidateSnapshot)) {
      return false;
    }

    if (recordHistory) {
      const nextUndo = trimEditorHistoryStack(
        [...editorUndoStackRef.current, cloneEditorSnapshot(currentSnapshot)],
        editorHistoryLimit,
      );
      setEditorHistoryStacks(nextUndo, []);
    } else if (clearRedo) {
      setEditorHistoryStacks(editorUndoStackRef.current, []);
    }

    setEditorSnapshotState(candidateSnapshot);
    return true;
  }

  function undoEditorChange() {
    if (editorUndoStackRef.current.length === 0) {
      return;
    }
    const undoStack = [...editorUndoStackRef.current];
    const previous = undoStack.pop();
    if (!previous) {
      return;
    }
    const current = getCurrentEditorSnapshot();
    const nextRedo = trimEditorHistoryStack(
      [...editorRedoStackRef.current, current],
      editorHistoryLimit,
    );
    setEditorHistoryStacks(undoStack, nextRedo);
    setEditorSnapshotState(previous);
    setEditorError("");
    setEditorStatus("Undo applique.");
  }

  function redoEditorChange() {
    if (editorRedoStackRef.current.length === 0) {
      return;
    }
    const redoStack = [...editorRedoStackRef.current];
    const next = redoStack.pop();
    if (!next) {
      return;
    }
    const current = getCurrentEditorSnapshot();
    const nextUndo = trimEditorHistoryStack(
      [...editorUndoStackRef.current, current],
      editorHistoryLimit,
    );
    setEditorHistoryStacks(nextUndo, redoStack);
    setEditorSnapshotState(next);
    setEditorError("");
    setEditorStatus("Redo applique.");
  }

  async function autosaveEditorDraft(force = false): Promise<boolean> {
    if (!editorSourcePath) {
      return false;
    }
    if (autosaveInFlightRef.current) {
      return false;
    }

    const snapshot = getCurrentEditorSnapshot();
    if (!force && !editorDirty) {
      return false;
    }

    const lastSaved = lastAutosavedSnapshotRef.current;
    if (!force && lastSaved && areEditorSnapshotsEqual(snapshot, lastSaved)) {
      return false;
    }

    autosaveInFlightRef.current = true;
    setIsAutosavingDraft(true);
    try {
      const response = await invoke<SaveDraftResponse>("save_transcript_draft", {
        request: {
          path: editorSourcePath,
          language: snapshot.language.trim() || null,
          segments: snapshot.segments,
        } as SaveDraftRequest,
      });
      lastAutosavedSnapshotRef.current = cloneEditorSnapshot(snapshot);
      setEditorDraftPath(response.draftPath);
      setEditorDraftUpdatedAtMs(response.updatedAtMs);
      setEditorAutosaveError("");
      setEditorAutosaveMessage(
        `Brouillon autosauve: ${new Date(response.updatedAtMs).toLocaleString()}`,
      );
      return true;
    } catch (e) {
      setEditorAutosaveError(String(e));
      return false;
    } finally {
      autosaveInFlightRef.current = false;
      setIsAutosavingDraft(false);
    }
  }

  autosaveEditorDraftRef.current = autosaveEditorDraft;

  async function purgeTranscriptDraft(manual: boolean) {
    if (!editorSourcePath) {
      return;
    }
    try {
      const deleted = await invoke<boolean>("delete_transcript_draft", {
        path: editorSourcePath,
      });
      if (deleted) {
        setEditorDraftPath("");
        setEditorDraftUpdatedAtMs(null);
        setEditorAutosaveError("");
        setEditorAutosaveMessage(manual ? "Brouillon purge." : "");
        lastAutosavedSnapshotRef.current = manual ? getCurrentEditorSnapshot() : null;
      } else if (manual) {
        setEditorAutosaveMessage("Aucun brouillon a purger.");
        lastAutosavedSnapshotRef.current = getCurrentEditorSnapshot();
      }
    } catch (e) {
      setEditorAutosaveError(String(e));
    }
  }

  function runTranscriptQaScan() {
    const maxWps = Math.max(qaMinWps, qaMaxWps);
    const issues = buildTranscriptQaIssues(
      editorSegmentsRef.current,
      qaGapThresholdSec,
      qaMinWps,
      maxWps,
    );
    setQaIssues(issues);
    setQaScannedAtMs(Date.now());
    setQaStatus(
      issues.length === 0
        ? "QA: aucune anomalie detectee."
        : `QA: ${issues.length} anomalie(s) detectee(s).`,
    );
  }

  function ensureEditorSegmentVisible(index: number) {
    if (index < 0) {
      return;
    }
    const pageSize = 120;
    if (index >= editorVisibleCount) {
      const nextVisible = Math.ceil((index + 1) / pageSize) * pageSize;
      setEditorVisibleCount(nextVisible);
    }
  }

  function jumpToQaIssue(issue: TranscriptQaIssue) {
    const index = issue.segmentIndex;
    const segment = editorSegmentsRef.current[index];
    if (!segment) {
      return;
    }
    ensureEditorSegmentVisible(index);
    setActiveSegmentIndex(index);
    wf.seekMedia(segment.start);
    setQaStatus(`QA focus: segment #${index + 1}.`);
  }

  function autoFixQaIssue(issue: TranscriptQaIssue) {
    const changed = applyEditorSnapshotMutation((current) => {
      const result = applyQaAutoFixSnapshot(current, issue, {
        waveformDurationSec: wf.waveform?.durationSec,
        qaMinWps,
        qaMaxWps,
      });
      return result ?? current;
    });

    if (!changed) {
      setQaStatus(`Auto-fix impossible pour ${qaIssueLabel(issue.type).toLowerCase()}.`);
      return;
    }

    setQaStatus(
      `Auto-fix applique (${qaIssueLabel(issue.type)}) sur segment #${issue.segmentIndex + 1}.`,
    );
    ensureEditorSegmentVisible(issue.segmentIndex);
    setActiveSegmentIndex(issue.segmentIndex);
    runTranscriptQaScan();
  }

  function updateEditorSegmentBoundary(
    index: number,
    edge: SegmentEdge,
    rawSeconds: number,
    options?: { recordHistory?: boolean; clearRedo?: boolean },
  ): boolean {
    return applyEditorSnapshotMutation((current) => {
      const nextSegments = cloneEditableSegments(current.segments);
      const segment = nextSegments[index];
      if (!segment) {
        return current;
      }

      const maxDuration =
        wf.waveform?.durationSec && wf.waveform.durationSec > 0
          ? wf.waveform.durationSec
          : Number.POSITIVE_INFINITY;

      let start = segment.start;
      let end = segment.end;
      const snappedInput = wf.applySnap(Number.isFinite(rawSeconds) ? rawSeconds : 0);
      const clampedInput = Math.max(0, snappedInput);

      if (edge === "start") {
        start = Math.min(clampedInput, end - MIN_SEGMENT_DURATION_SEC);
        if (start < 0) {
          start = 0;
        }
        if (start > maxDuration - MIN_SEGMENT_DURATION_SEC) {
          start = Math.max(0, maxDuration - MIN_SEGMENT_DURATION_SEC);
        }
      } else {
        end = Math.max(clampedInput, start + MIN_SEGMENT_DURATION_SEC);
        if (end > maxDuration) {
          end = maxDuration;
        }
      }

      if (end < start + MIN_SEGMENT_DURATION_SEC) {
        end = start + MIN_SEGMENT_DURATION_SEC;
      }
      start = Math.max(0, start);
      end = Math.max(start + MIN_SEGMENT_DURATION_SEC, end);

      nextSegments[index] = {
        ...segment,
        start: roundSecondsMs(start),
        end: roundSecondsMs(end),
      };
      return buildEditorSnapshot(current.language, nextSegments);
    }, options);
  }

  function onWaveformMouseDown(event: MouseEvent<HTMLCanvasElement>) {
    const edge = hitTestFocusedSegmentEdge(
      waveformPointerCtx,
      editorSegments,
      focusedSegmentIndex,
      event,
    );
    if (edge && focusedSegmentIndex !== null) {
      dragStartSnapshotRef.current = getCurrentEditorSnapshot();
      dragHasHistoryChangeRef.current = false;
      setDragSegmentState({ segmentIndex: focusedSegmentIndex, edge });
      setHoveredSegmentEdge(edge);
      setActiveSegmentIndex(focusedSegmentIndex);
      return;
    }

    const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
    if (seconds === null) {
      return;
    }
    wf.seekMedia(seconds);
    const nearest = closestSegmentIndex(editorSegments, seconds);
    if (nearest !== null) {
      setActiveSegmentIndex(nearest);
    }
  }

  function onWaveformMouseMove(event: MouseEvent<HTMLCanvasElement>) {
    if (dragSegmentState) {
      const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
      if (seconds === null) {
        return;
      }
      const changed = updateEditorSegmentBoundary(
        dragSegmentState.segmentIndex,
        dragSegmentState.edge,
        seconds,
        { recordHistory: false, clearRedo: false },
      );
      if (changed) {
        dragHasHistoryChangeRef.current = true;
      }
      wf.setWaveformCursorSec(seconds);
      return;
    }

    const edge = hitTestFocusedSegmentEdge(
      waveformPointerCtx,
      editorSegments,
      focusedSegmentIndex,
      event,
    );
    setHoveredSegmentEdge(edge);
  }

  function finalizeDragHistory() {
    const startSnapshot = dragStartSnapshotRef.current;
    if (!startSnapshot || !dragHasHistoryChangeRef.current) {
      dragStartSnapshotRef.current = null;
      dragHasHistoryChangeRef.current = false;
      return;
    }
    const currentSnapshot = getCurrentEditorSnapshot();
    if (!areEditorSnapshotsEqual(startSnapshot, currentSnapshot)) {
      pushUndoSnapshot(startSnapshot);
    }
    dragStartSnapshotRef.current = null;
    dragHasHistoryChangeRef.current = false;
  }

  function stopWaveformDrag() {
    finalizeDragHistory();
    setDragSegmentState(null);
    setHoveredSegmentEdge(null);
  }

  function onWaveformMouseUp() {
    if (dragSegmentState) {
      stopWaveformDrag();
    }
  }

  function onWaveformMouseLeave() {
    if (dragSegmentState) {
      stopWaveformDrag();
      return;
    }
    setHoveredSegmentEdge(null);
  }

  async function loadTranscriptEditor(path: string) {
    setEditorError("");
    setEditorStatus("");
    setEditorLastOutputPath("");
    setLastExportReport(null);
    setEditorAutosaveError("");
    setEditorAutosaveMessage("");
    setIsEditorLoading(true);
    try {
      const doc = await invoke<TranscriptDocument>("load_transcript_document", { path });
      const sourceSnapshot = buildEditorSnapshot(doc.language ?? "", doc.segments);
      let loadedSnapshot = sourceSnapshot;
      let recoveredFromDraft = false;

      const maybeDraft = await invoke<TranscriptDraftDocument | null>("load_transcript_draft", {
        path: doc.path,
      });
      if (maybeDraft) {
        const draftSnapshot = buildEditorSnapshot(maybeDraft.language ?? "", maybeDraft.segments);
        setEditorDraftPath(maybeDraft.draftPath);
        setEditorDraftUpdatedAtMs(maybeDraft.updatedAtMs);
        lastAutosavedSnapshotRef.current = cloneEditorSnapshot(draftSnapshot);

        if (!areEditorSnapshotsEqual(sourceSnapshot, draftSnapshot)) {
          const shouldRecover = window.confirm(
            `Un brouillon autosauve existe (${new Date(maybeDraft.updatedAtMs).toLocaleString()}). Restaurer ce brouillon ?`,
          );
          if (shouldRecover) {
            loadedSnapshot = draftSnapshot;
            recoveredFromDraft = true;
          }
        }
      } else {
        setEditorDraftPath("");
        setEditorDraftUpdatedAtMs(null);
        lastAutosavedSnapshotRef.current = null;
      }

      setEditorSourcePath(doc.path);
      editorBaselineRef.current = cloneEditorSnapshot(sourceSnapshot);
      setEditorHistoryStacks([], []);
      setEditorSnapshotState(loadedSnapshot);
      setEditorVisibleCount(120);
      setActiveSegmentIndex(loadedSnapshot.segments.length > 0 ? 0 : null);
      if (recoveredFromDraft) {
        setEditorStatus(
          `Transcript charge avec recovery du brouillon (${loadedSnapshot.segments.length} segment(s)).`,
        );
      } else {
        setEditorStatus(`Transcript charge: ${loadedSnapshot.segments.length} segment(s).`);
      }
      const initialQaIssues = buildTranscriptQaIssues(
        loadedSnapshot.segments,
        qaGapThresholdSec,
        qaMinWps,
        Math.max(qaMinWps, qaMaxWps),
      );
      setQaIssues(initialQaIssues);
      setQaScannedAtMs(Date.now());
      setQaStatus(
        initialQaIssues.length === 0
          ? "QA: aucune anomalie detectee."
          : `QA: ${initialQaIssues.length} anomalie(s) detectee(s).`,
      );
    } catch (e) {
      editorBaselineRef.current = null;
      lastAutosavedSnapshotRef.current = null;
      setEditorHistoryStacks([], []);
      setEditorSnapshotState(buildEditorSnapshot("", []));
      setEditorSourcePath("");
      setEditorDraftPath("");
      setEditorDraftUpdatedAtMs(null);
      setActiveSegmentIndex(null);
      setLastExportReport(null);
      setQaIssues([]);
      setQaScannedAtMs(null);
      setQaStatus("");
      setEditorError(String(e));
    } finally {
      setIsEditorLoading(false);
    }
  }

  function updateEditorSegmentText(index: number, text: string) {
    applyEditorSnapshotMutation((current) => {
      const nextSegments = cloneEditableSegments(current.segments);
      const segment = nextSegments[index];
      if (!segment) {
        return current;
      }
      nextSegments[index] = { ...segment, text };
      return buildEditorSnapshot(current.language, nextSegments);
    });
  }

  function updateEditorLanguage(nextLanguage: string) {
    applyEditorSnapshotMutation((current) => {
      if (current.language === nextLanguage) {
        return current;
      }
      return buildEditorSnapshot(nextLanguage, current.segments);
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
    if (segments.length === 0) {
      return;
    }
    const baseIndex = actionSegmentIndex ?? closestSegmentIndex(segments, cursorTimeSec) ?? 0;
    const nextIndex = clampNumber(baseIndex + delta, 0, segments.length - 1);
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
    const currentSegments = editorSegmentsRef.current;
    const segment = currentSegments[targetIndex];
    if (!segment) {
      setEditorError("Segment actif introuvable.");
      return;
    }

    const lowerBound = segment.start + MIN_SEGMENT_DURATION_SEC;
    const upperBound = segment.end - MIN_SEGMENT_DURATION_SEC;
    if (upperBound <= lowerBound) {
      setEditorError("Segment trop court pour un split.");
      return;
    }

    const rawCursor = Number.isFinite(cursorTimeSec)
      ? cursorTimeSec
      : segment.start + (segment.end - segment.start) / 2;
    let splitAt = Math.min(upperBound, Math.max(lowerBound, wf.applySnap(rawCursor)));
    splitAt = Math.min(upperBound, Math.max(lowerBound, splitAt));
    splitAt = roundSecondsMs(splitAt);
    if (splitAt <= segment.start || splitAt >= segment.end) {
      setEditorError("Position de split invalide.");
      return;
    }

    const [leftText, rightText] = splitSegmentText(segment.text);
    const leftSegment: EditableSegment = {
      ...segment,
      end: splitAt,
      text: leftText,
    };
    const rightSegment: EditableSegment = {
      ...segment,
      start: splitAt,
      text: rightText,
    };

    applyEditorSnapshotMutation((current) => {
      const nextSegments = cloneEditableSegments(current.segments);
      if (!nextSegments[targetIndex]) {
        return current;
      }
      nextSegments.splice(targetIndex, 1, leftSegment, rightSegment);
      return buildEditorSnapshot(current.language, nextSegments);
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

    const leftSpeaker = first.speaker?.trim() || "";
    const rightSpeaker = second.speaker?.trim() || "";
    const mergedSpeaker = leftSpeaker || rightSpeaker || undefined;
    const mergedSegment: EditableSegment = {
      start: roundSecondsMs(Math.min(first.start, second.start)),
      end: roundSecondsMs(Math.max(first.end, second.end)),
      text: joinSegmentTexts(first.text, second.text),
      speaker: mergedSpeaker,
    };

    applyEditorSnapshotMutation((current) => {
      const nextSegments = cloneEditableSegments(current.segments);
      if (!nextSegments[firstIndex] || !nextSegments[secondIndex]) {
        return current;
      }
      nextSegments.splice(firstIndex, 2, mergedSegment);
      return buildEditorSnapshot(current.language, nextSegments);
    });
    setActiveSegmentIndex(firstIndex);
    wf.setWaveformCursorSec(mergedSegment.start);
    setEditorError("");
    setEditorStatus(`Segments #${firstIndex + 1} et #${secondIndex + 1} fusionnes.`);
  }

  async function saveEditedJson(overwrite: boolean) {
    if (!editorSourcePath || editorSegmentsRef.current.length === 0) {
      setEditorError("Aucun transcript charge dans l'editeur.");
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
    setIsEditorSaving(true);
    try {
      const outPath = await invoke<string>("save_transcript_json", {
        request: {
          path: editorSourcePath,
          language: editorLanguageRef.current.trim() || null,
          segments: editorSegmentsRef.current,
          overwrite,
        },
      });
      const savedSnapshot = getCurrentEditorSnapshot();
      editorBaselineRef.current = savedSnapshot;
      updateEditorDirtyFromSnapshot(savedSnapshot);
      lastAutosavedSnapshotRef.current = null;
      setEditorDraftPath("");
      setEditorDraftUpdatedAtMs(null);
      setEditorAutosaveError("");
      setEditorAutosaveMessage("");
      setEditorLastOutputPath(outPath);
      setEditorStatus(`JSON sauvegarde: ${outPath}`);
      await refreshJobs();
    } catch (e) {
      setEditorError(String(e));
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function exportEditedTranscript(format: "json" | "srt" | "vtt" | "txt" | "csv") {
    if (!editorSourcePath || editorSegmentsRef.current.length === 0) {
      setEditorError("Aucun transcript charge dans l'editeur.");
      return;
    }
    const normalizedRules = normalizeExportRules(exportRules);
    setExportRules(normalizedRules);
    setEditorError("");
    setEditorStatus("");
    setIsEditorSaving(true);
    try {
      const result = await invoke<ExportTranscriptResponse>("export_transcript", {
        request: {
          path: editorSourcePath,
          language: editorLanguageRef.current.trim() || null,
          segments: editorSegmentsRef.current,
          format,
          rules: normalizedRules,
        },
      });
      setEditorLastOutputPath(result.outputPath);
      setLastExportReport(result.report);
      setEditorStatus(`Export ${format.toUpperCase()} genere: ${result.outputPath}`);
      await refreshJobs();
      if (isPreviewableFile(result.outputPath)) {
        void previewOutput(result.outputPath);
      }
    } catch (e) {
      setEditorError(String(e));
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function exportTimingPack() {
    if (!editorSourcePath || editorSegmentsRef.current.length === 0) {
      setEditorError("Aucun transcript charge dans l'editeur.");
      return;
    }
    const normalizedRules = normalizeExportRules(exportRules);
    setExportRules(normalizedRules);
    setEditorError("");
    setEditorStatus("");
    setIsEditorSaving(true);
    try {
      let lastPath = "";
      for (const format of ["json", "srt", "csv"] as const) {
        const result = await invoke<ExportTranscriptResponse>("export_transcript", {
          request: {
            path: editorSourcePath,
            language: editorLanguageRef.current.trim() || null,
            segments: editorSegmentsRef.current,
            format,
            rules: normalizedRules,
          },
        });
        lastPath = result.outputPath;
        setLastExportReport(result.report);
      }
      setEditorLastOutputPath(lastPath);
      setEditorStatus("Pack timing exporte (JSON + SRT + CSV a cote du transcript source).");
      await refreshJobs();
      if (lastPath && isPreviewableFile(lastPath)) {
        void previewOutput(lastPath);
      }
    } catch (e) {
      setEditorError(String(e));
    } finally {
      setIsEditorSaving(false);
    }
  }

  useEffect(() => {
    setActiveSegmentIndex(null);
    setDragSegmentState(null);
    setHoveredSegmentEdge(null);
    dragStartSnapshotRef.current = null;
    dragHasHistoryChangeRef.current = false;
  }, [selectedJobId]);

  useEffect(() => {
    if (activeSegmentIndex === null) {
      return;
    }
    if (!editorSegments[activeSegmentIndex]) {
      setActiveSegmentIndex(editorSegments.length > 0 ? editorSegments.length - 1 : null);
    }
  }, [activeSegmentIndex, editorSegments]);

  useEffect(() => {
    const trimmedUndo = trimEditorHistoryStack(editorUndoStackRef.current, editorHistoryLimit);
    const trimmedRedo = trimEditorHistoryStack(editorRedoStackRef.current, editorHistoryLimit);
    if (
      trimmedUndo.length !== editorUndoStackRef.current.length ||
      trimmedRedo.length !== editorRedoStackRef.current.length
    ) {
      setEditorHistoryStacks(trimmedUndo, trimmedRedo);
    }
  }, [editorHistoryLimit]);

  useEffect(() => {
    if (!editorSourcePath) {
      return;
    }
    const intervalMs = draftAutosaveSec * 1000;
    const timer = window.setInterval(() => {
      void autosaveEditorDraftRef.current(false);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [editorSourcePath, draftAutosaveSec]);

  useEffect(() => {
    if (editorSourcePath) {
      return;
    }
    setQaIssues([]);
    setQaScannedAtMs(null);
    setQaStatus("");
  }, [editorSourcePath]);

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
  useEffect(() => {
    if (!dragSegmentState) {
      return;
    }
    const stopDrag = () => {
      setDragSegmentState(null);
      setHoveredSegmentEdge(null);
    };
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, [dragSegmentState]);

  return {
    activeSegmentIndex,
    setActiveSegmentIndex,
    hoveredSegmentEdge,
    setHoveredSegmentEdge,
    dragSegmentState,
    setDragSegmentState,
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
    loadTranscriptEditor,
    updateEditorSegmentText,
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
  };
}
