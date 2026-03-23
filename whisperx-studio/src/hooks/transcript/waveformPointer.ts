import type { MouseEvent } from "react";
import { clampNumber } from "../../appUtils";
import type { EditableSegment, SegmentEdge } from "../../types";

/** Contexte waveform + snap (sans dependre du hook workspace). */
export type WaveformPointerContext = {
  waveform: { durationSec: number } | null | undefined;
  waveformVisibleDurationSec: number;
  waveformViewStartSec: number;
  applySnap: (seconds: number) => number;
};

export function secondsFromWaveformPointer(
  ctx: WaveformPointerContext,
  event: MouseEvent<HTMLCanvasElement>,
): number | null {
  if (!ctx.waveform || ctx.waveform.durationSec <= 0 || ctx.waveformVisibleDurationSec <= 0) {
    return null;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) {
    return null;
  }
  const ratio = (event.clientX - rect.left) / rect.width;
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const seconds = ctx.waveformViewStartSec + clampedRatio * ctx.waveformVisibleDurationSec;
  return clampNumber(ctx.applySnap(seconds), 0, ctx.waveform.durationSec);
}

export function hitTestFocusedSegmentEdge(
  ctx: WaveformPointerContext,
  editorSegments: EditableSegment[],
  focusedSegmentIndex: number | null,
  event: MouseEvent<HTMLCanvasElement>,
): SegmentEdge | null {
  if (
    !ctx.waveform ||
    ctx.waveform.durationSec <= 0 ||
    ctx.waveformVisibleDurationSec <= 0 ||
    focusedSegmentIndex === null
  ) {
    return null;
  }
  const segment = editorSegments[focusedSegmentIndex];
  if (!segment) {
    return null;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) {
    return null;
  }

  const x = event.clientX - rect.left;
  const startX =
    ((segment.start - ctx.waveformViewStartSec) / ctx.waveformVisibleDurationSec) * rect.width;
  const endX =
    ((segment.end - ctx.waveformViewStartSec) / ctx.waveformVisibleDurationSec) * rect.width;
  const thresholdPx = 7;
  if (Math.abs(x - startX) <= thresholdPx) {
    return "start";
  }
  if (Math.abs(x - endX) <= thresholdPx) {
    return "end";
  }
  return null;
}
