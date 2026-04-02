import { useEffect, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActiveRun } from "../EditorPanel";
import { usePlayerPlayback } from "../../hooks/usePlayerPlayback";
import { useWaveformWorkspace } from "../../hooks/useWaveformWorkspace";
import { useWaveformCanvas } from "../../hooks/useWaveformCanvas";
import { useTranscriptEditor } from "../../hooks/useTranscriptEditor";
import { EditorMiniPlayer } from "./EditorMiniPlayer";
import { EditorToolbar } from "./EditorToolbar";
import { EditorSegmentList } from "./EditorSegmentList";

export type EditorWorkspaceSectionProps = {
  activeRun: ActiveRun;
  onOpenPlayer: () => void;
};

const noopAsync = async () => {};

export function EditorWorkspaceSection({ activeRun, onOpenPlayer }: EditorWorkspaceSectionProps) {
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
  });

  useWaveformCanvas(
    wf,
    editor.editorSegments,
    editor.focusedSegmentIndex,
    editor.hoveredSegmentEdge,
    editor.dragSegmentState,
    playback.loopAsec,
    playback.loopBsec,
  );

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
      <EditorToolbar
        editorSourcePath={editor.editorSourcePath}
        editorLanguage={editor.editorLanguage}
        editorDirty={editor.editorDirty}
        isEditorSaving={editor.isEditorSaving}
        isEditorLoading={editor.isEditorLoading}
        editorError={editor.editorError}
        editorStatus={editor.editorStatus}
        canUndoEditor={editor.canUndoEditor}
        canRedoEditor={editor.canRedoEditor}
        canSplitActiveSegment={editor.canSplitActiveSegment}
        canMergePrev={editor.canMergePrev}
        canMergeNext={editor.canMergeNext}
        undoEditorChange={editor.undoEditorChange}
        redoEditorChange={editor.redoEditorChange}
        splitActiveSegmentAtCursor={editor.splitActiveSegmentAtCursor}
        mergeActiveSegment={editor.mergeActiveSegment}
        updateEditorLanguage={editor.updateEditorLanguage}
        saveEditedJson={editor.saveEditedJson}
        exportEditedTranscript={editor.exportEditedTranscript}
        exportTimingPack={() => void editor.exportTimingPack()}
        exportRules={editor.exportRules}
        setExportRules={editor.setExportRules}
        lastExportReport={editor.lastExportReport}
        onOpenPlayer={onOpenPlayer}
      />

      <div className="editor-workspace-section__body">
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
        />

        <EditorSegmentList
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
        />
      </div>
    </div>
  );
}
