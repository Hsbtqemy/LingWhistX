import { useEffect } from "react";
import { MAX_WAVEFORM_ZOOM, MIN_WAVEFORM_ZOOM } from "../constants";
import { clampNumber } from "../appUtils";
import type { EditableSegment, SegmentDragState, SegmentEdge } from "../types";
import type { WaveformWorkspace } from "./useWaveformWorkspace";

/**
 * Dessine la waveform + segments + playheads sur le canvas (effet synchronisé sur wf et l’overlay éditeur).
 */
export function useWaveformCanvas(
  wf: WaveformWorkspace,
  editorSegments: EditableSegment[],
  focusedSegmentIndex: number | null,
  hoveredSegmentEdge: SegmentEdge | null,
  dragSegmentState: SegmentDragState | null,
): void {
  const {
    waveformCanvasRef,
    waveform,
    waveformZoom,
    waveformViewStartSec,
    mediaCurrentSec,
    waveformCursorSec,
    viewportWidth,
    clampWaveformViewStart,
    detailEnvelope,
    showSegmentOverlaysOnWaveform,
  } = wf;

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveform) {
      return;
    }

    const widthCss = Math.max(320, Math.floor(canvas.clientWidth));
    const heightCss = 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(widthCss * dpr);
    canvas.height = Math.floor(heightCss * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, heightCss);

    ctx.fillStyle = "#f5fcfc";
    ctx.fillRect(0, 0, widthCss, heightCss);

    const totalDuration = Math.max(0.001, waveform.durationSec);
    const visibleDuration = Math.max(
      0.001,
      totalDuration / clampNumber(waveformZoom, MIN_WAVEFORM_ZOOM, MAX_WAVEFORM_ZOOM),
    );
    const viewStart = clampWaveformViewStart(waveformViewStartSec, totalDuration, visibleDuration);
    const viewEnd = viewStart + visibleDuration;
    const toX = (seconds: number): number => ((seconds - viewStart) / visibleDuration) * widthCss;

    if (editorSegments.length > 0) {
      ctx.fillStyle = "rgba(19, 111, 126, 0.14)";
      const maxOverlays = Math.min(editorSegments.length, 6000);
      for (let i = 0; i < maxOverlays; i += 1) {
        const segment = editorSegments[i];
        if (segment.end < viewStart || segment.start > viewEnd) {
          continue;
        }
        const visibleStart = Math.max(segment.start, viewStart);
        const visibleEnd = Math.min(segment.end, viewEnd);
        const xStart = Math.floor(toX(visibleStart));
        const xEnd = Math.ceil(toX(visibleEnd));
        if (xEnd <= 0 || xStart >= widthCss) {
          continue;
        }
        const w = Math.max(1, xEnd - xStart);
        ctx.fillRect(Math.max(0, xStart), 0, w, heightCss);
      }

      if (focusedSegmentIndex !== null) {
        const focused = editorSegments[focusedSegmentIndex];
        if (focused) {
          const startX = Math.floor(toX(focused.start));
          const endX = Math.ceil(toX(focused.end));
          const segW = Math.max(2, endX - startX);

          ctx.fillStyle = "rgba(36, 123, 176, 0.24)";
          ctx.fillRect(Math.max(0, startX), 0, segW, heightCss);

          const handleSize = 9;
          const drawHandle = (x: number, active: boolean) => {
            ctx.strokeStyle = active ? "#e06b2f" : "#1a6fb0";
            ctx.lineWidth = active ? 2.2 : 2;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, heightCss);
            ctx.stroke();

            ctx.fillStyle = active ? "#e06b2f" : "#1a6fb0";
            ctx.fillRect(
              x - Math.floor(handleSize / 2),
              Math.floor(heightCss / 2 - handleSize),
              handleSize,
              handleSize * 2,
            );
          };

          const startActive =
            dragSegmentState?.segmentIndex === focusedSegmentIndex &&
            dragSegmentState?.edge === "start";
          const endActive =
            dragSegmentState?.segmentIndex === focusedSegmentIndex &&
            dragSegmentState?.edge === "end";
          const startHover = hoveredSegmentEdge === "start";
          const endHover = hoveredSegmentEdge === "end";

          drawHandle(startX, startActive || startHover);
          drawHandle(endX, endActive || endHover);
        }
      }
    }

    const centerY = heightCss / 2;
    ctx.strokeStyle = "rgba(16, 93, 103, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY + 0.5);
    ctx.lineTo(widthCss, centerY + 0.5);
    ctx.stroke();

    const pixelColumns = Math.max(1, widthCss);
    const env = detailEnvelope;
    const useWxenv = env !== null && env.minMax.length >= 2 && env.returnedBlocks > 0;

    ctx.strokeStyle = "#0f7e8a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (useWxenv) {
      const { minMax, blockSize, sampleRate, startBlock } = env;
      const sr = sampleRate > 0 ? sampleRate : 16000;
      const bs = blockSize > 0 ? blockSize : 256;
      for (let x = 0; x < pixelColumns; x += 1) {
        const t = viewStart + (x / pixelColumns) * visibleDuration;
        const sample = t * sr;
        const globalBlock = Math.floor(sample / bs);
        const li = globalBlock - startBlock;
        const o = li * 2;
        if (li < 0 || o + 1 >= minMax.length) {
          continue;
        }
        const mn = (minMax[o] ?? 0) / 32767;
        const mx = (minMax[o + 1] ?? 0) / 32767;
        const amp = Math.max(Math.abs(mn), Math.abs(mx));
        const h = Math.max(1, Math.min(1, amp) * (centerY - 8));
        ctx.moveTo(x + 0.5, centerY - h);
        ctx.lineTo(x + 0.5, centerY + h);
      }
    } else {
      const peaks = waveform.peaks;
      const binsPerSecond = waveform.binsPerSecond > 0 ? waveform.binsPerSecond : 1;
      const firstVisibleBin = Math.max(0, Math.floor(viewStart * binsPerSecond));
      const lastVisibleBin = Math.min(
        peaks.length,
        Math.max(firstVisibleBin + 1, Math.ceil(viewEnd * binsPerSecond)),
      );
      const visibleBinCount = Math.max(1, lastVisibleBin - firstVisibleBin);
      const binsPerPixel = visibleBinCount / pixelColumns;
      for (let x = 0; x < pixelColumns; x += 1) {
        const start = firstVisibleBin + Math.floor(x * binsPerPixel);
        const end = Math.min(
          peaks.length,
          Math.max(start + 1, firstVisibleBin + Math.floor((x + 1) * binsPerPixel)),
        );
        let amp = 0;
        for (let i = start; i < end && i < peaks.length; i += 1) {
          const value = peaks[i] ?? 0;
          if (value > amp) {
            amp = value;
          }
        }
        const h = Math.max(1, Math.min(1, amp) * (centerY - 8));
        ctx.moveTo(x + 0.5, centerY - h);
        ctx.lineTo(x + 0.5, centerY + h);
      }
    }
    ctx.stroke();

    const playheadX = Math.floor(toX(Math.max(0, mediaCurrentSec)));
    if (playheadX >= -2 && playheadX <= widthCss + 2) {
      ctx.strokeStyle = "#d35d2f";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX + 0.5, 0);
      ctx.lineTo(playheadX + 0.5, heightCss);
      ctx.stroke();
    }

    if (waveformCursorSec !== null) {
      const cursorX = Math.floor(toX(Math.max(0, waveformCursorSec)));
      if (cursorX >= -2 && cursorX <= widthCss + 2) {
        ctx.strokeStyle = "#1964b6";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cursorX + 0.5, 0);
        ctx.lineTo(cursorX + 0.5, heightCss);
        ctx.stroke();
      }
    }
  }, [
    waveformCanvasRef,
    waveform,
    waveformZoom,
    waveformViewStartSec,
    clampWaveformViewStart,
    mediaCurrentSec,
    waveformCursorSec,
    editorSegments,
    focusedSegmentIndex,
    hoveredSegmentEdge,
    dragSegmentState,
    viewportWidth,
    detailEnvelope,
    showSegmentOverlaysOnWaveform,
  ]);
}
