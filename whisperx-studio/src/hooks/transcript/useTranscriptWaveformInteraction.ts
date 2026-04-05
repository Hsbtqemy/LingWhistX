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

export type DrawRange = { startSec: number; endSec: number };

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
  const [drawRange, setDrawRange] = useState<DrawRange | null>(null);
  const drawRangeAnchorRef = useRef<number | null>(null);
  const drawPendingRef = useRef<{ seconds: number; clientX: number; clientY: number } | null>(null);
  const dragStartSnapshotRef = useRef<EditorSnapshot | null>(null);
  const dragHasHistoryChangeRef = useRef(false);

  const DRAW_DRAG_THRESHOLD_PX = 4;

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
      drawPendingRef.current = null;
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

    // Clear previous draw range and prepare for potential drag-to-select
    setDrawRange(null);
    drawRangeAnchorRef.current = null;
    drawPendingRef.current = { seconds, clientX: event.clientX, clientY: event.clientY };

    wf.seekMedia(seconds);
    wf.setWaveformCursorSec(seconds);
    const nearest = closestSegmentIndex(editorSegments, seconds);
    if (nearest !== null) {
      setActiveSegmentIndex(nearest);
    }
  }

  function onWaveformMouseMove(event: MouseEvent<HTMLCanvasElement>) {
    if (wf.rangeDragStartSec !== null) {
      return;
    }

    // Pending draw: activate draw mode once drag threshold is crossed
    if (drawPendingRef.current !== null && drawRangeAnchorRef.current === null) {
      const dx = event.clientX - drawPendingRef.current.clientX;
      const dy = event.clientY - drawPendingRef.current.clientY;
      if (Math.abs(dx) > DRAW_DRAG_THRESHOLD_PX || Math.abs(dy) > DRAW_DRAG_THRESHOLD_PX) {
        const anchor = drawPendingRef.current.seconds;
        drawRangeAnchorRef.current = anchor;
        const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
        if (seconds !== null) {
          setDrawRange({
            startSec: Math.min(anchor, seconds),
            endSec: Math.max(anchor, seconds),
          });
          wf.setWaveformCursorSec(seconds);
        }
      }
      return;
    }

    // Active draw: update range while dragging
    if (drawRangeAnchorRef.current !== null) {
      const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
      if (seconds !== null) {
        const anchor = drawRangeAnchorRef.current;
        setDrawRange({
          startSec: Math.min(anchor, seconds),
          endSec: Math.max(anchor, seconds),
        });
        wf.setWaveformCursorSec(seconds);
      }
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
    drawPendingRef.current = null;
    if (drawRangeAnchorRef.current !== null) {
      drawRangeAnchorRef.current = null;
      return;
    }
    if (dragSegmentState) {
      stopWaveformDrag();
    }
  }

  function onWaveformMouseLeave() {
    drawPendingRef.current = null;
    if (drawRangeAnchorRef.current !== null) {
      drawRangeAnchorRef.current = null;
      return;
    }
    if (dragSegmentState) {
      stopWaveformDrag();
      return;
    }
    setHoveredSegmentEdge(null);
  }

  const clearDrawRange = useCallback(() => {
    drawPendingRef.current = null;
    drawRangeAnchorRef.current = null;
    setDrawRange(null);
  }, []);

  const resetWaveformInteraction = useCallback(() => {
    dragStartSnapshotRef.current = null;
    dragHasHistoryChangeRef.current = false;
    setDragSegmentState(null);
    setHoveredSegmentEdge(null);
    clearDrawRange();
  }, [clearDrawRange]);

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
    drawRange,
    clearDrawRange,
    updateEditorSegmentBoundary,
    onWaveformMouseDown,
    onWaveformMouseMove,
    onWaveformMouseUp,
    onWaveformMouseLeave,
    resetWaveformInteraction,
  };
}
