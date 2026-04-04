import { useEffect } from "react";
import { MAX_WAVEFORM_ZOOM, MIN_WAVEFORM_ZOOM } from "../constants";
import { clampNumber } from "../appUtils";
import type {
  EditableSegment,
  EventTurnRow,
  SegmentDragState,
  SegmentEdge,
  WaveformLaneToggles,
  WaveformOverlayData,
} from "../types";
import type { WaveformWorkspace } from "./useWaveformWorkspace";
import { getWaveformCanvasThemeColors, useWaveformThemeRevision } from "./waveformCanvasTheme";

const LANE_H = 22; // hauteur d'une lane en px (CSS)
const LOW_CONF_THRESHOLD = 0.65;

/**
 * Dessine la waveform + segments + playheads + marqueurs/lanes/sélection sur le canvas.
 */
export function useWaveformCanvas(
  wf: WaveformWorkspace,
  editorSegments: EditableSegment[],
  focusedSegmentIndex: number | null,
  hoveredSegmentEdge: SegmentEdge | null,
  dragSegmentState: SegmentDragState | null,
  loopAsec?: number | null,
  loopBsec?: number | null,
  compact?: boolean,
  waveformOverlay?: WaveformOverlayData | null,
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
    previewRangeSec,
    rangeDragPreviewSec,
    pauseOverlayIntervals,
    pauseOverlayVisible,
    markerToggles,
    laneToggles,
    analysisSelection,
    analysisSelDragPreview,
  } = wf;

  const waveformThemeRevision = useWaveformThemeRevision();

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveform) {
      return;
    }

    const colors = getWaveformCanvasThemeColors();

    const widthCss = Math.max(320, Math.floor(canvas.clientWidth));

    // Lanes actives (seulement en mode étendu)
    const activeLanes = compact
      ? ([] as (keyof WaveformLaneToggles)[])
      : (["density", "speechRate", "confidence"] as (keyof WaveformLaneToggles)[]).filter(
          (k) => laneToggles[k],
        );
    const totalLaneH = activeLanes.length * LANE_H;

    const baseH = compact ? 80 : 200;
    const heightCss = baseH + totalLaneH;
    // La zone waveform occupe 0..baseH, les lanes baseH..heightCss

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(widthCss * dpr);
    canvas.height = Math.floor(heightCss * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, heightCss);

    ctx.fillStyle = colors.canvasBg;
    ctx.fillRect(0, 0, widthCss, heightCss);

    const totalDuration = Math.max(0.001, waveform.durationSec);
    const visibleDuration = Math.max(
      0.001,
      totalDuration / clampNumber(waveformZoom, MIN_WAVEFORM_ZOOM, MAX_WAVEFORM_ZOOM),
    );
    const viewStart = clampWaveformViewStart(waveformViewStartSec, totalDuration, visibleDuration);
    const viewEnd = viewStart + visibleDuration;
    const toX = (seconds: number): number => ((seconds - viewStart) / visibleDuration) * widthCss;

    // ── Pause CSV overlay ──────────────────────────────────────────────────────
    if (pauseOverlayVisible && pauseOverlayIntervals.length > 0) {
      ctx.fillStyle = colors.pauseOverlay;
      const maxBands = Math.min(pauseOverlayIntervals.length, 8000);
      for (let i = 0; i < maxBands; i += 1) {
        const { start, end } = pauseOverlayIntervals[i];
        if (end < viewStart || start > viewEnd) {
          continue;
        }
        const visibleStart = Math.max(start, viewStart);
        const visibleEnd = Math.min(end, viewEnd);
        const xStart = Math.floor(toX(visibleStart));
        const xEnd = Math.ceil(toX(visibleEnd));
        if (xEnd <= 0 || xStart >= widthCss) {
          continue;
        }
        const w = Math.max(1, xEnd - xStart);
        ctx.fillRect(Math.max(0, xStart), 0, w, baseH);
      }
    }

    // ── Segment overlays ──────────────────────────────────────────────────────
    if (editorSegments.length > 0) {
      ctx.fillStyle = colors.segmentOverlay;
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
        ctx.fillRect(Math.max(0, xStart), 0, w, baseH);
      }

      if (focusedSegmentIndex !== null) {
        const focused = editorSegments[focusedSegmentIndex];
        if (focused) {
          const startX = Math.floor(toX(focused.start));
          const endX = Math.ceil(toX(focused.end));
          const segW = Math.max(2, endX - startX);

          ctx.fillStyle = colors.segmentFocus;
          ctx.fillRect(Math.max(0, startX), 0, segW, baseH);

          const handleSize = 9;
          const drawHandle = (x: number, active: boolean) => {
            ctx.strokeStyle = active ? colors.handleHot : colors.handleCold;
            ctx.lineWidth = active ? 2.2 : 2;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, baseH);
            ctx.stroke();

            ctx.fillStyle = active ? colors.handleHot : colors.handleCold;
            ctx.fillRect(
              x - Math.floor(handleSize / 2),
              Math.floor(baseH / 2 - handleSize),
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

    // ── Range bands ───────────────────────────────────────────────────────────
    const drawRangeBand = (startSec: number, endSec: number, fillStyle: string, h = baseH) => {
      if (endSec <= startSec) {
        return;
      }
      const s = Math.max(startSec, viewStart);
      const e = Math.min(endSec, viewEnd);
      if (e <= s) {
        return;
      }
      const x0 = Math.floor(toX(s));
      const x1 = Math.ceil(toX(e));
      ctx.fillStyle = fillStyle;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    };
    if (previewRangeSec) {
      drawRangeBand(previewRangeSec.start, previewRangeSec.end, colors.rangeValid);
    }
    if (rangeDragPreviewSec) {
      drawRangeBand(rangeDragPreviewSec.start, rangeDragPreviewSec.end, colors.rangePreview);
    }
    if (loopAsec != null && loopBsec != null && loopBsec > loopAsec) {
      drawRangeBand(loopAsec, loopBsec, colors.loopBand);
    }

    // ── Grille centrale ───────────────────────────────────────────────────────
    const centerY = baseH / 2;
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY + 0.5);
    ctx.lineTo(widthCss, centerY + 0.5);
    ctx.stroke();

    // ── Enveloppe waveform ────────────────────────────────────────────────────
    const pixelColumns = Math.max(1, widthCss);
    const env = detailEnvelope;
    const useWxenv = env !== null && env.minMax.length >= 2 && env.returnedBlocks > 0;

    ctx.strokeStyle = colors.envelopeStroke;
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

    // ── WX-726 : marqueurs contextuels superposés sur la waveform ─────────────
    if (waveformOverlay) {
      const { pauses, turns, words, longPauseMs } = waveformOverlay;

      // Pauses longues : traits verticaux rouges
      if (markerToggles.longPauses && pauses.length > 0) {
        ctx.strokeStyle = colors.markerLongPause;
        ctx.lineWidth = 1.5;
        for (const pause of pauses) {
          if (pause.durMs < longPauseMs) continue;
          const x = Math.round(toX(pause.startMs / 1000)) + 0.5;
          if (x < -2 || x > widthCss + 2) continue;
          ctx.beginPath();
          ctx.moveTo(x, 4);
          ctx.lineTo(x, baseH - 4);
          ctx.stroke();
        }
      }

      // Tri unique des turns pour chevauchements + changements de locuteur
      const sortedTurns =
        (markerToggles.overlaps || markerToggles.speakerChanges) && turns.length > 1
          ? ([...turns].sort((a, b) => a.startMs - b.startMs) as EventTurnRow[])
          : ([] as EventTurnRow[]);

      // Chevauchements : bandes semi-transparentes orangées
      if (markerToggles.overlaps && sortedTurns.length > 1) {
        ctx.fillStyle = colors.markerOverlap;
        for (let i = 0; i < sortedTurns.length - 1; i++) {
          const a = sortedTurns[i];
          for (let j = i + 1; j < sortedTurns.length; j++) {
            const b = sortedTurns[j];
            if (b.startMs >= a.endMs) break;
            if (a.speaker === b.speaker) continue;
            const olStart = Math.max(a.startMs, b.startMs) / 1000;
            const olEnd = Math.min(a.endMs, b.endMs) / 1000;
            if (olEnd <= olStart) continue;
            drawRangeBand(olStart, olEnd, colors.markerOverlap);
          }
        }
      }

      // Changements de locuteur : lignes verticales bleues
      if (markerToggles.speakerChanges && sortedTurns.length > 1) {
        ctx.strokeStyle = colors.markerSpeakerChange;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        for (let i = 1; i < sortedTurns.length; i++) {
          const prev = sortedTurns[i - 1];
          const cur = sortedTurns[i];
          if (prev.speaker === cur.speaker) continue;
          const x = Math.round(toX(cur.startMs / 1000)) + 0.5;
          if (x < -2 || x > widthCss + 2) continue;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, baseH);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Mots à faible confiance : points orangés
      if (markerToggles.lowConfWords && words.length > 0) {
        ctx.fillStyle = colors.markerLowConf;
        for (const word of words) {
          if ((word.confidence ?? 1) >= LOW_CONF_THRESHOLD) continue;
          const midSec = ((word.startMs + word.endMs) / 2) / 1000;
          const x = Math.round(toX(midSec));
          if (x < 0 || x > widthCss) continue;
          ctx.beginPath();
          ctx.arc(x, baseH - 6, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ── WX-726 : lanes d'analyse ──────────────────────────────────────────────
    if (waveformOverlay && activeLanes.length > 0) {
      const { turns, ipus, words, durationMs } = waveformOverlay;
      let laneTop = baseH;

      const drawLaneBackground = (y: number, label: string) => {
        ctx.fillStyle = colors.laneBg;
        ctx.fillRect(0, y, widthCss, LANE_H);
        ctx.strokeStyle = colors.laneGrid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(widthCss, y);
        ctx.stroke();
        ctx.fillStyle = colors.laneLabel;
        ctx.font = `${Math.floor(LANE_H * 0.55)}px sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(label, 4, y + LANE_H / 2);
      };

      // Lane densité de parole — O(turns + pixels)
      if (activeLanes.includes("density")) {
        drawLaneBackground(laneTop, "Densité");
        if (turns.length > 0 && durationMs > 0) {
          const densityArr = new Float32Array(pixelColumns);
          for (const turn of turns) {
            const ts = turn.startMs / 1000;
            const te = turn.endMs / 1000;
            if (te < viewStart || ts > viewEnd) continue;
            const px0 = ((ts - viewStart) / visibleDuration) * pixelColumns;
            const px1 = ((te - viewStart) / visibleDuration) * pixelColumns;
            const ix0 = Math.max(0, Math.floor(px0));
            const ix1 = Math.min(pixelColumns - 1, Math.floor(px1));
            for (let x = ix0; x <= ix1; x++) {
              densityArr[x] = Math.min(1, densityArr[x] + Math.min(x + 1, px1) - Math.max(x, px0));
            }
          }
          ctx.fillStyle = colors.laneDensityFill;
          for (let x = 0; x < pixelColumns; x++) {
            const density = densityArr[x];
            if (density <= 0) continue;
            const h = Math.max(1, density * (LANE_H - 4));
            ctx.fillRect(x, laneTop + LANE_H - 2 - h, 1, h);
          }
        }
        laneTop += LANE_H;
      }

      // Lane débit de parole (mots/min par IPU)
      if (activeLanes.includes("speechRate")) {
        drawLaneBackground(laneTop, "Débit");
        if (ipus.length > 0) {
          const MAX_WPM = 250;
          ctx.fillStyle = colors.laneSpeechRateFill;
          for (const ipu of ipus) {
            const durSec = (ipu.endMs - ipu.startMs) / 1000;
            if (durSec <= 0) continue;
            const wpm = Math.min(MAX_WPM, (ipu.nWords / durSec) * 60);
            const ratio = wpm / MAX_WPM;
            const startSec = ipu.startMs / 1000;
            const endSec = ipu.endMs / 1000;
            if (endSec < viewStart || startSec > viewEnd) continue;
            const x0 = Math.max(0, Math.floor(toX(startSec)));
            const x1 = Math.min(widthCss, Math.ceil(toX(endSec)));
            const h = Math.max(1, ratio * (LANE_H - 4));
            ctx.fillRect(x0, laneTop + LANE_H - 2 - h, Math.max(1, x1 - x0), h);
          }
        }
        laneTop += LANE_H;
      }

      // Lane confiance des mots (gradient couleur)
      if (activeLanes.includes("confidence")) {
        drawLaneBackground(laneTop, "Confiance");
        if (words.length > 0) {
          for (const word of words) {
            const conf = word.confidence ?? 1;
            const startSec = word.startMs / 1000;
            const endSec = word.endMs / 1000;
            if (endSec < viewStart || startSec > viewEnd) continue;
            const x0 = Math.max(0, Math.floor(toX(startSec)));
            const x1 = Math.min(widthCss, Math.ceil(toX(endSec)));
            // vert (conf=1) → orange (conf=0.5) → rouge (conf=0)
            const r = Math.round(conf < 0.5 ? 200 : 200 - (conf - 0.5) * 2 * 150);
            const g = Math.round(conf < 0.5 ? conf * 2 * 180 : 180);
            ctx.fillStyle = `rgba(${r},${g},40,0.7)`;
            ctx.fillRect(x0, laneTop + 3, Math.max(1, x1 - x0), LANE_H - 6);
          }
        }
        laneTop += LANE_H;
      }
    }

    // ── Playhead ──────────────────────────────────────────────────────────────
    const playheadX = Math.floor(toX(Math.max(0, mediaCurrentSec)));
    if (playheadX >= -2 && playheadX <= widthCss + 2) {
      const px = playheadX + 0.5;
      ctx.strokeStyle = colors.playhead;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, heightCss);
      ctx.stroke();
      const triSize = compact ? 4 : 6;
      ctx.fillStyle = colors.playhead;
      ctx.beginPath();
      ctx.moveTo(px - triSize, 0);
      ctx.lineTo(px + triSize, 0);
      ctx.lineTo(px, triSize * 1.4);
      ctx.closePath();
      ctx.fill();
    }

    if (waveformCursorSec !== null) {
      const cursorX = Math.floor(toX(Math.max(0, waveformCursorSec)));
      if (cursorX >= -2 && cursorX <= widthCss + 2) {
        ctx.strokeStyle = colors.cursor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cursorX + 0.5, 0);
        ctx.lineTo(cursorX + 0.5, heightCss);
        ctx.stroke();
      }
    }

    // ── WX-727 : sélection de région d'analyse ────────────────────────────────
    const selRange = analysisSelDragPreview ?? analysisSelection;
    if (selRange) {
      const selX0 = Math.max(0, Math.floor(toX(selRange.start)));
      const selX1 = Math.min(widthCss, Math.ceil(toX(selRange.end)));
      if (selX1 > selX0) {
        ctx.fillStyle = colors.analysisSelFill;
        ctx.fillRect(selX0, 0, selX1 - selX0, heightCss);
        ctx.strokeStyle = colors.analysisSelHandle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(selX0 + 0.5, 0);
        ctx.lineTo(selX0 + 0.5, heightCss);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(selX1 - 0.5, 0);
        ctx.lineTo(selX1 - 0.5, heightCss);
        ctx.stroke();
        // Poignées triangulaires en haut
        const hw = 5;
        ctx.fillStyle = colors.analysisSelHandle;
        ctx.beginPath();
        ctx.moveTo(selX0 - hw, 0);
        ctx.lineTo(selX0 + hw, 0);
        ctx.lineTo(selX0, hw * 1.4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(selX1 - hw, 0);
        ctx.lineTo(selX1 + hw, 0);
        ctx.lineTo(selX1, hw * 1.4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [
    waveformThemeRevision,
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
    previewRangeSec,
    rangeDragPreviewSec,
    pauseOverlayIntervals,
    pauseOverlayVisible,
    loopAsec,
    loopBsec,
    compact,
    waveformOverlay,
    markerToggles,
    laneToggles,
    analysisSelection,
    analysisSelDragPreview,
  ]);
}
