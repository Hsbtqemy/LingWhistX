import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActiveRun } from "../EditorPanel";
import { usePlayerPlayback } from "../../hooks/usePlayerPlayback";
import { useWaveformWorkspace } from "../../hooks/useWaveformWorkspace";
import { useWaveformCanvas } from "../../hooks/useWaveformCanvas";
import { useTranscriptEditor } from "../../hooks/useTranscriptEditor";
import { useAnnotationConventions } from "../../hooks/useAnnotationConventions";
import { EditorFileToolbar } from "./EditorFileToolbar";
import { EditorMiniPlayer } from "./EditorMiniPlayer";
import { EditorToolbar } from "./EditorToolbar";
import { EditorSegmentList } from "./EditorSegmentList";

export type EditorWorkspaceSectionProps = {
  activeRun: ActiveRun;
  onOpenPlayer: () => void;
  onTranscriptPersistedForPlayer?: () => void;
};

const noopAsync = async () => {};

export function EditorWorkspaceSection({
  activeRun,
  onOpenPlayer,
  onTranscriptPersistedForPlayer,
}: EditorWorkspaceSectionProps) {
  const playback = usePlayerPlayback(activeRun.runDir);

  const wf = useWaveformWorkspace({
    selectedJob: null,
    selectedJobId: "",
    selectedIsVideo: playback.isVideo,
    previewMediaPath: playback.mediaPath,
    playerMediaRef: playback.mediaRef,
  });

  const editor = useTranscriptEditor({
    wf,
    refreshJobs: noopAsync,
    previewOutput: noopAsync,
    selectedJobId: "",
    runDirForPlayerSync: activeRun.runDir,
    onTranscriptPersistedForPlayer,
  });

  const conventions = useAnnotationConventions();

  useWaveformCanvas(
    wf,
    editor.editorSegments,
    editor.focusedSegmentIndex,
    editor.hoveredSegmentEdge,
    editor.dragSegmentState,
    playback.loopAsec,
    playback.loopBsec,
    false,
    null,
    editor.drawRange,
  );

  const playSegmentTimeoutRef = useRef<number | null>(null);
  const [waveformHeight, setWaveformHeight] = useState(200);
  const splitDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleCommitDrawRange = useCallback(() => {
    if (!editor.drawRange) return;
    editor.createSegmentFromRange(editor.drawRange.startSec, editor.drawRange.endSec);
    editor.clearDrawRange();
  }, [editor]);

  const handleZoomToSegment = useCallback(() => {
    const idx = editor.focusedSegmentIndex;
    if (idx === null) return;
    const seg = editor.editorSegments[idx];
    if (!seg) return;
    const margin = Math.max(1, (seg.end - seg.start) * 0.3);
    wf.ensureTimeVisible(seg.start - margin);
    const range = seg.end - seg.start + margin * 2;
    const totalDuration = wf.waveform?.durationSec ?? range;
    if (totalDuration > 0 && range < totalDuration) {
      wf.setWaveformZoomAround(totalDuration / range, (seg.start + seg.end) / 2);
    }
  }, [editor.focusedSegmentIndex, editor.editorSegments, wf]);

  const handleResetZoom = useCallback(() => {
    wf.resetWaveformZoom();
  }, [wf]);

  const handlePlaySegment = useCallback(() => {
    const idx = editor.focusedSegmentIndex;
    if (idx === null) return;
    const seg = editor.editorSegments[idx];
    if (!seg) return;
    playback.seek(seg.start);
    void playback.play();
    if (playSegmentTimeoutRef.current !== null) {
      window.clearTimeout(playSegmentTimeoutRef.current);
    }
    const durationMs = (seg.end - seg.start) * 1000;
    playSegmentTimeoutRef.current = window.setTimeout(() => {
      playback.pause();
      playSegmentTimeoutRef.current = null;
    }, durationMs);
  }, [editor.focusedSegmentIndex, editor.editorSegments, playback]);

  useEffect(() => {
    return () => {
      if (playSegmentTimeoutRef.current !== null) {
        window.clearTimeout(playSegmentTimeoutRef.current);
      }
    };
  }, []);

  const onSplitHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      splitDragRef.current = { startY: e.clientY, startH: waveformHeight };

      const onMove = (ev: globalThis.MouseEvent) => {
        if (!splitDragRef.current) return;
        const delta = ev.clientY - splitDragRef.current.startY;
        setWaveformHeight(Math.max(100, Math.min(500, splitDragRef.current.startH + delta)));
      };
      const onUp = () => {
        splitDragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [waveformHeight],
  );

  // Sync waveform lorsque le segment focalisé change
  useEffect(() => {
    const idx = editor.focusedSegmentIndex;
    if (idx === null) return;
    const seg = editor.editorSegments[idx];
    if (!seg) return;
    wf.ensureTimeVisible(seg.start);
  }, [editor.focusedSegmentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Découverte automatique du transcript JSON au chargement du run
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const path = await invoke<string | null>("find_run_transcript_json", {
          runDir: activeRun.runDir,
        });
        if (!cancelled && path) {
          await editor.loadTranscriptEditor(path);
        }
      } catch {
        // L'erreur sera affichée via editorError si loadTranscriptEditor échoue
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRun.runDir]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="editor-workspace-section">
      <div className="editor-workspace-section__file-bar">
        <EditorFileToolbar
          editorSourcePath={editor.editorSourcePath}
          editorLanguage={editor.editorLanguage}
          editorDirty={editor.editorDirty}
          isEditorSaving={editor.isEditorSaving}
          isEditorLoading={editor.isEditorLoading}
          updateEditorLanguage={editor.updateEditorLanguage}
          saveEditedJson={editor.saveEditedJson}
          onOpenPlayer={onOpenPlayer}
        />
      </div>
      <div className="editor-workspace-section__body">
        <div className="editor-waveform-pane" style={{ height: waveformHeight }}>
        <EditorMiniPlayer
          playback={playback}
          wf={wf}
          onWaveformMouseDown={
            editor.onWaveformMouseDown as unknown as (e: MouseEvent<HTMLDivElement>) => void
          }
          onWaveformMouseMove={
            editor.onWaveformMouseMove as unknown as (e: MouseEvent<HTMLDivElement>) => void
          }
          onWaveformMouseUp={
            editor.onWaveformMouseUp as unknown as (e: MouseEvent<HTMLDivElement>) => void
          }
          onWaveformMouseLeave={
            editor.onWaveformMouseLeave as unknown as (e: MouseEvent<HTMLDivElement>) => void
          }
          hoveredSegmentEdge={editor.hoveredSegmentEdge}
          drawRange={editor.drawRange}
          onCommitDrawRange={handleCommitDrawRange}
          onClearDrawRange={editor.clearDrawRange}
          onZoomToSegment={handleZoomToSegment}
          onResetZoom={handleResetZoom}
          onPlaySegment={handlePlaySegment}
        />
        </div>
        <div
          className="editor-split-handle"
          onMouseDown={onSplitHandleMouseDown}
        >
          <div className="editor-split-handle__bar" />
        </div>
        <EditorSegmentList
          transcriptSourcePath={editor.editorSourcePath}
          segments={editor.displayedEditorSegments}
          allSegments={editor.editorSegments}
          allSegmentsCount={editor.editorSegments.length}
          activeSegmentIndex={editor.activeSegmentIndex}
          hasMoreSegments={editor.hasMoreEditorSegments}
          editorVisibleCount={editor.editorVisibleCount}
          focusSegment={editor.focusSegment}
          setActiveSegmentIndex={editor.setActiveSegmentIndex}
          updateSegmentText={editor.updateEditorSegmentText}
          updateSegmentBoundary={editor.updateEditorSegmentBoundary}
          updateSegmentSpeaker={editor.updateEditorSegmentSpeaker}
          setEditorVisibleCount={editor.setEditorVisibleCount}
          canSplitActiveSegment={editor.canSplitActiveSegment}
          canMergePrev={editor.canMergePrev}
          canMergeNext={editor.canMergeNext}
          canDeleteSegment={editor.canDeleteSegment}
          splitActiveSegmentAtCursor={editor.splitActiveSegmentAtCursor}
          mergeActiveSegment={editor.mergeActiveSegment}
          deleteActiveSegment={editor.deleteActiveSegment}
        />
      </div>

      <div className="editor-workspace-section__toolbar">
        <EditorToolbar
          playback={playback}
          editorSourcePath={editor.editorSourcePath}
          isEditorSaving={editor.isEditorSaving}
          isEditorLoading={editor.isEditorLoading}
          editorError={editor.editorError}
          editorStatus={editor.editorStatus}
          canUndoEditor={editor.canUndoEditor}
          canRedoEditor={editor.canRedoEditor}
          canSplitActiveSegment={editor.canSplitActiveSegment}
          canMergePrev={editor.canMergePrev}
          canMergeNext={editor.canMergeNext}
          canDeleteSegment={editor.canDeleteSegment}
          undoEditorChange={editor.undoEditorChange}
          redoEditorChange={editor.redoEditorChange}
          splitActiveSegmentAtCursor={editor.splitActiveSegmentAtCursor}
          mergeActiveSegment={editor.mergeActiveSegment}
          insertBlankSegment={editor.insertBlankSegment}
          deleteActiveSegment={editor.deleteActiveSegment}
          exportEditedTranscript={editor.exportEditedTranscript}
          exportTimingPack={() => void editor.exportTimingPack()}
          exportRules={editor.exportRules}
          setExportRules={editor.setExportRules}
          lastExportReport={editor.lastExportReport}
          activeConvention={conventions.activeConvention}
          availableConventions={conventions.conventions}
          activeConventionId={conventions.activeConventionId}
          onChangeConvention={conventions.setActiveConventionId}
          onInsertMark={editor.insertAnnotationMark}
        />
      </div>
    </div>
  );
}
