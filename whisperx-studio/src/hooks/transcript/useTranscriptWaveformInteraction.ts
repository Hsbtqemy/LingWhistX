import type { Dispatch, MouseEvent, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { areEditorSnapshotsEqual, closestSegmentIndex } from "../../appUtils";
import type { EditableSegment, EditorSnapshot, SegmentDragState, SegmentEdge } from "../../types";
import {
  hitTestFocusedSegmentEdge,
  secondsFromWaveformPointer,
  type WaveformPointerContext,
} from "./waveformPointer";
import { resizeSegmentBoundaryInSnapshot } from "./transcriptSegmentMutations";
import type { WaveformWorkspace } from "../useWaveformWorkspace";

export type UseTranscriptWaveformInteractionArgs = {
  wf: WaveformWorkspace;
  waveformPointerCtx: WaveformPointerContext;
  editorSegments: EditableSegment[];
  focusedSegmentIndex: number | null;
  getCurrentEditorSnapshot: () => EditorSnapshot;
  applyEditorSnapshotMutation: (
    mutator: (current: EditorSnapshot) => EditorSnapshot,
    options?: { recordHistory?: boolean; clearRedo?: boolean },
  ) => boolean;
  pushUndoSnapshot: (snapshot: EditorSnapshot) => void;
  setActiveSegmentIndex: Dispatch<SetStateAction<number | null>>;
};

export function useTranscriptWaveformInteraction({
  wf,
  waveformPointerCtx,
  editorSegments,
  focusedSegmentIndex,
  getCurrentEditorSnapshot,
  applyEditorSnapshotMutation,
  pushUndoSnapshot,
  setActiveSegmentIndex,
}: UseTranscriptWaveformInteractionArgs) {
  const [hoveredSegmentEdge, setHoveredSegmentEdge] = useState<SegmentEdge | null>(null);
  const [dragSegmentState, setDragSegmentState] = useState<SegmentDragState | null>(null);
  const dragStartSnapshotRef = useRef<EditorSnapshot | null>(null);
  const dragHasHistoryChangeRef = useRef(false);

  const maxDurationSec =
    wf.waveform?.durationSec && wf.waveform.durationSec > 0 ? wf.waveform.durationSec : Number.NaN;

  function updateEditorSegmentBoundary(
    index: number,
    edge: SegmentEdge,
    rawSeconds: number,
    options?: { recordHistory?: boolean; clearRedo?: boolean },
  ): boolean {
    return applyEditorSnapshotMutation(
      (current) =>
        resizeSegmentBoundaryInSnapshot(
          current,
          index,
          edge,
          rawSeconds,
          maxDurationSec,
          wf.applySnap,
        ),
      options,
    );
  }

  function onWaveformMouseDown(event: MouseEvent<HTMLCanvasElement>) {
    if (wf.rangeSelectionMode) {
      const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
      if (seconds !== null) {
        wf.beginRangeDrag(seconds);
        wf.setWaveformCursorSec(seconds);
        return;
      }
    }
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
    if (wf.rangeDragStartSec !== null) {
      return;
    }
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

  const resetWaveformInteraction = useCallback(() => {
    dragStartSnapshotRef.current = null;
    dragHasHistoryChangeRef.current = false;
    setDragSegmentState(null);
    setHoveredSegmentEdge(null);
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
    hoveredSegmentEdge,
    setHoveredSegmentEdge,
    dragSegmentState,
    setDragSegmentState,
    updateEditorSegmentBoundary,
    onWaveformMouseDown,
    onWaveformMouseMove,
    onWaveformMouseUp,
    onWaveformMouseLeave,
    resetWaveformInteraction,
  };
}
