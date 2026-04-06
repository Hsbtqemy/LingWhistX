import { useCallback, useEffect, useRef } from "react";
import { formatClockSeconds } from "../../../appUtils";
import { getStatsCanvasThemeColors } from "../../../hooks/statsCanvasTheme";
import { useWaveformThemeRevision } from "../../../hooks/waveformCanvasTheme";
import { buildPauseHistogram } from "../../../player/playerSpeakerStats";
import type {
  BrushRange,
  DensityPoint,
  SpeechRateSeries,
  TimelineSegment,
} from "../../../player/playerSpeakerStats";
import { speakerColor } from "./viewUtils";

const STATS_HISTOGRAM_BINS = 12;
const STATS_HISTOGRAM_W = 200;
const STATS_HISTOGRAM_H = 56;
const CANVAS_W_REF = 600;

// ─── Shared brush helpers ────────────────────────────────────────────────────

type BrushDrag = { startMs: number; startCssX: number };

function startBrush(
  cssX: number,
  ms: number,
  dragRef: React.MutableRefObject<BrushDrag | null>,
  overlayRef: React.MutableRefObject<HTMLDivElement | null>,
) {
  dragRef.current = { startMs: ms, startCssX: cssX };
  const ov = overlayRef.current;
  if (ov) {
    ov.style.left = `${cssX}px`;
    ov.style.width = "0px";
    ov.style.display = "block";
  }
}

function moveBrush(
  cssX: number,
  dragRef: React.MutableRefObject<BrushDrag | null>,
  overlayRef: React.MutableRefObject<HTMLDivElement | null>,
): boolean {
  const drag = dragRef.current;
  if (!drag) return false;
  const x0 = Math.min(drag.startCssX, cssX);
  const x1 = Math.max(drag.startCssX, cssX);
  const ov = overlayRef.current;
  if (ov) {
    ov.style.left = `${x0}px`;
    ov.style.width = `${x1 - x0}px`;
  }
  return true;
}

function endBrush(
  endMs: number,
  totalDurationMs: number,
  dragRef: React.MutableRefObject<BrushDrag | null>,
  overlayRef: React.MutableRefObject<HTMLDivElement | null>,
  onBrushChange?: (range: BrushRange | null) => void,
  onSeekToMs?: (ms: number) => void,
) {
  const drag = dragRef.current;
  if (!drag) return;
  dragRef.current = null;
  const ov = overlayRef.current;
  if (ov) ov.style.display = "none";
  const lo = Math.max(0, Math.min(drag.startMs, endMs));
  const hi = Math.min(totalDurationMs, Math.max(drag.startMs, endMs));
  if (hi - lo < 500) {
    onSeekToMs?.(Math.max(0, Math.round(lo)));
  } else {
    onBrushChange?.({ startMs: Math.round(lo), endMs: Math.round(hi) });
  }
}

function cancelBrush(
  dragRef: React.MutableRefObject<BrushDrag | null>,
  overlayRef: React.MutableRefObject<HTMLDivElement | null>,
) {
  dragRef.current = null;
  const ov = overlayRef.current;
  if (ov) ov.style.display = "none";
}

// ─── Shared tooltip helpers ───────────────────────────────────────────────────

function showTooltip(tip: HTMLDivElement, text: string, x: number, y: number, canvasWidth: number) {
  tip.textContent = text;
  tip.style.display = "block";
  tip.style.left = `${Math.min(x + 8, canvasWidth - 130)}px`;
  tip.style.top = `${Math.max(0, y - 36)}px`;
}

function hideTooltip(tip: HTMLDivElement | null) {
  if (tip) tip.style.display = "none";
}

// ─── PauseHistogramCanvas ─────────────────────────────────────────────────────

export function PauseHistogramCanvas({
  durationsMs,
  activeColor,
  expanded,
}: {
  durationsMs: number[];
  activeColor: string;
  expanded?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  // Store bins computed during draw for re-use in mouse handlers
  const binsRef = useRef<{ binMs: number; count: number; lo: number; hi: number }[]>([]);
  const themeRev = useWaveformThemeRevision();
  const H = expanded ? STATS_HISTOGRAM_H * 2 : STATS_HISTOGRAM_H;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || STATS_HISTOGRAM_W;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const rawBins = buildPauseHistogram(durationsMs, STATS_HISTOGRAM_BINS);
    ctx.clearRect(0, 0, W, H);

    if (rawBins.length === 0) {
      ctx.fillStyle = t.labelMuted;
      ctx.font = "10px sans-serif";
      ctx.fillText("\u2014", 4, H / 2 + 4);
      binsRef.current = [];
      return;
    }

    const maxDur = durationsMs.reduce((m, v) => (v > m ? v : m), 0);
    const binWidth = maxDur > 0 ? maxDur / STATS_HISTOGRAM_BINS : 0;

    const maxCount = Math.max(...rawBins.map((b) => b.count), 1);
    const barW = W / rawBins.length;
    const pad = 1;

    binsRef.current = rawBins.map((b, i) => ({
      ...b,
      lo: i * binWidth,
      hi: (i + 1) * binWidth,
    }));

    for (let i = 0; i < rawBins.length; i++) {
      const barH = Math.round((rawBins[i].count / maxCount) * (H - 2));
      ctx.fillStyle = activeColor;
      ctx.fillRect(i * barW + pad, H - barH, barW - pad * 2, barH);
    }
  }, [durationsMs, activeColor, themeRev, H]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const tip = tooltipRef.current;
    const canvas = canvasRef.current;
    if (!tip || !canvas || binsRef.current.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const binIdx = Math.min(
      binsRef.current.length - 1,
      Math.floor((x / rect.width) * binsRef.current.length),
    );
    if (binIdx < 0) {
      hideTooltip(tip);
      return;
    }
    const b = binsRef.current[binIdx];
    const loFmt = b.lo >= 1000 ? `${(b.lo / 1000).toFixed(1)}s` : `${Math.round(b.lo)}ms`;
    const hiFmt = b.hi >= 1000 ? `${(b.hi / 1000).toFixed(1)}s` : `${Math.round(b.hi)}ms`;
    showTooltip(
      tip,
      `${loFmt} – ${hiFmt} : ${b.count} pause${b.count !== 1 ? "s" : ""}`,
      x,
      e.clientY - rect.top,
      rect.width,
    );
  };

  return (
    <div className="stats-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={STATS_HISTOGRAM_W}
        height={H}
        className="stats-histogram-canvas"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => hideTooltip(tooltipRef.current)}
      />
      <div ref={tooltipRef} className="stats-canvas-tooltip" style={{ display: "none" }} />
    </div>
  );
}

// ─── SpeechBarCanvas ──────────────────────────────────────────────────────────

export function SpeechBarCanvas({
  stats,
  totalDurationMs,
  activeSpeaker,
  onSeekToMs,
  expanded,
}: {
  stats: { speaker: string; speechMs: number }[];
  totalDurationMs: number;
  activeSpeaker: string | null;
  onSeekToMs?: (ms: number) => void;
  expanded?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  // Stores cumulative x boundaries per speaker for hit-testing
  const segmentsRef = useRef<{ speaker: string; speechMs: number; xStart: number; xEnd: number }[]>(
    [],
  );
  const themeRev = useWaveformThemeRevision();
  const H = expanded ? 76 : 38;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || 600;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    if (totalDurationMs <= 0) return;

    const totalSpeech = stats.reduce((s, st) => s + st.speechMs, 0);
    const silenceMs = Math.max(0, totalDurationMs - totalSpeech);

    let x = 0;
    const barH = H - 12;
    const segs: typeof segmentsRef.current = [];

    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const w = (s.speechMs / totalDurationMs) * W;
      if (w < 1) {
        segs.push({ speaker: s.speaker, speechMs: s.speechMs, xStart: x, xEnd: x });
        continue;
      }
      ctx.fillStyle = speakerColor(i);
      if (activeSpeaker && s.speaker !== activeSpeaker) ctx.globalAlpha = 0.35;
      else ctx.globalAlpha = 1;
      ctx.fillRect(x, 0, w, barH);
      ctx.globalAlpha = 1;

      if (w > 30) {
        ctx.fillStyle = t.textInverse;
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(s.speaker, x + w / 2, barH / 2 + 4);
      }
      segs.push({ speaker: s.speaker, speechMs: s.speechMs, xStart: x, xEnd: x + w });
      x += w;
    }
    segmentsRef.current = segs;

    if (silenceMs > 0) {
      const sw = (silenceMs / totalDurationMs) * W;
      ctx.fillStyle = t.silenceBg;
      ctx.fillRect(x, 0, sw, barH);
      if (sw > 30) {
        ctx.fillStyle = t.labelMuted;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("silence", x + sw / 2, barH / 2 + 4);
      }
    }

    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = t.labelMuted;
    for (const seg of segs) {
      const w = seg.xEnd - seg.xStart;
      if (w > 40) {
        const pct = ((seg.speechMs / totalDurationMs) * 100).toFixed(0);
        ctx.fillText(`${pct}%`, seg.xStart + 3, barH + 10);
      }
    }
  }, [stats, totalDurationMs, activeSpeaker, themeRev, H]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const tip = tooltipRef.current;
    const canvas = canvasRef.current;
    if (!tip || !canvas || totalDurationMs <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const segs = segmentsRef.current;
    const hit = segs.find((s) => cssX >= s.xStart && cssX < s.xEnd);
    if (!hit) {
      hideTooltip(tip);
      return;
    }
    const pct = ((hit.speechMs / totalDurationMs) * 100).toFixed(1);
    showTooltip(
      tip,
      `${hit.speaker} · ${formatClockSeconds(hit.speechMs / 1000)} · ${pct}%`,
      cssX,
      e.clientY - rect.top,
      rect.width,
    );
  };

  return (
    <div className="stats-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={600}
        height={H}
        className="stats-speech-bar-canvas"
        title="Répartition temps de parole — clic pour seek"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => hideTooltip(tooltipRef.current)}
        style={{ cursor: onSeekToMs ? "pointer" : "default" }}
      />
      <div ref={tooltipRef} className="stats-canvas-tooltip" style={{ display: "none" }} />
    </div>
  );
}

// ─── SpeechTimelineCanvas ─────────────────────────────────────────────────────

export function SpeechTimelineCanvas({
  timeline,
  speakers,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
  overlapSegments,
  expanded,
  brushRange,
  onBrushChange,
}: {
  timeline: TimelineSegment[];
  speakers: string[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  overlapSegments?: { startMs: number; endMs: number }[];
  expanded?: boolean;
  brushRange?: BrushRange | null;
  onBrushChange?: (range: BrushRange | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const brushDragRef = useRef<BrushDrag | null>(null);
  const brushOverlayRef = useRef<HTMLDivElement | null>(null);
  const H = expanded ? 120 : 60;
  const maxLaneH = expanded ? 36 : 20;
  const themeRev = useWaveformThemeRevision();
  const getLaneH = useCallback(
    (containerH: number) =>
      speakers.length > 0 ? Math.min(maxLaneH, (containerH - 10) / speakers.length) : maxLaneH,
    [speakers.length, maxLaneH],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || CANVAS_W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    if (totalDurationMs <= 0) return;

    const laneH = getLaneH(H);
    const contentH = speakers.length * laneH;

    for (let si = 0; si < speakers.length; si++) {
      const y = si * laneH + 2;
      ctx.fillStyle = t.laneBg;
      ctx.fillRect(0, y, W, laneH - 2);
      ctx.fillStyle = t.labelMuted;
      ctx.font = "9px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(speakers[si], 2, y + laneH / 2 + 3);
    }

    for (const seg of timeline) {
      const si = speakers.indexOf(seg.speaker);
      if (si < 0) continue;
      const x = (seg.startMs / totalDurationMs) * W;
      const w = Math.max(1, ((seg.endMs - seg.startMs) / totalDurationMs) * W);
      const y = si * laneH + 2;
      ctx.fillStyle = speakerColor(si);
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x, y, w, laneH - 3);
      ctx.globalAlpha = 1;
    }

    if (overlapSegments && overlapSegments.length > 0) {
      for (const ov of overlapSegments) {
        const x = (ov.startMs / totalDurationMs) * W;
        const w = Math.max(1, ((ov.endMs - ov.startMs) / totalDurationMs) * W);
        ctx.fillStyle = t.overlapFill;
        ctx.fillRect(x, 0, w, contentH + 2);
        ctx.strokeStyle = t.overlapStroke;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, 0, w, contentH + 2);
      }
    }

    const px = (playheadMs / totalDurationMs) * W;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();

    if (brushRange) {
      const bx = (brushRange.startMs / totalDurationMs) * W;
      const bw = ((brushRange.endMs - brushRange.startMs) / totalDurationMs) * W;
      ctx.fillStyle = t.brushFill;
      ctx.fillRect(bx, 0, bw, H);
      ctx.strokeStyle = t.brushStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, 0, bw, H);
    }
  }, [
    timeline,
    speakers,
    totalDurationMs,
    playheadMs,
    overlapSegments,
    themeRev,
    H,
    brushRange,
    getLaneH,
  ]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || totalDurationMs <= 0) return;
    if (e.shiftKey && brushRange) {
      onBrushChange?.(null);
      e.preventDefault();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const ms = (cssX / rect.width) * totalDurationMs;
    if (ms < 0 || ms > totalDurationMs) return;
    startBrush(cssX, ms, brushDragRef, brushOverlayRef);
    e.preventDefault();
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!brushDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ms = ((e.clientX - rect.left) / rect.width) * totalDurationMs;
    endBrush(ms, totalDurationMs, brushDragRef, brushOverlayRef, onBrushChange, onSeekToMs);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    onBrushChange?.(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;

    if (moveBrush(cssX, brushDragRef, brushOverlayRef)) return;

    const tip = tooltipRef.current;
    if (!tip || totalDurationMs <= 0) return;
    const y = e.clientY - rect.top;
    const ms = (cssX / rect.width) * totalDurationMs;
    if (ms < 0 || ms > totalDurationMs) {
      hideTooltip(tip);
      return;
    }

    const laneH = getLaneH(rect.height);
    const si = Math.floor(y / laneH);
    const speaker = speakers[si] ?? null;
    const seg = speaker
      ? timeline.find((s) => s.speaker === speaker && s.startMs <= ms && s.endMs >= ms)
      : null;

    let text = `${formatClockSeconds(ms / 1000)}`;
    if (speaker) text += ` · ${speaker}`;
    if (seg) text += ` · ${formatClockSeconds((seg.endMs - seg.startMs) / 1000)}`;
    showTooltip(tip, text, cssX, y, rect.width);
  };

  return (
    <div className="stats-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={CANVAS_W_REF}
        height={H}
        className="stats-timeline-canvas"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          cancelBrush(brushDragRef, brushOverlayRef);
          hideTooltip(tooltipRef.current);
        }}
        onDoubleClick={handleDoubleClick}
        title="Glisser pour une plage · Shift+clic pour effacer la sélection · double-clic efface aussi (un clic simple peut seek)"
        style={{ cursor: "crosshair" }}
      />
      <div ref={brushOverlayRef} className="stats-brush-overlay" />
      <div ref={tooltipRef} className="stats-canvas-tooltip" style={{ display: "none" }} />
    </div>
  );
}

// ─── SpeechRateCanvas ─────────────────────────────────────────────────────────

export function SpeechRateCanvas({
  series,
  speakers,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
  expanded,
  brushRange,
  onBrushChange,
}: {
  series: SpeechRateSeries[];
  speakers: string[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  expanded?: boolean;
  brushRange?: BrushRange | null;
  onBrushChange?: (range: BrushRange | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const brushDragRef = useRef<BrushDrag | null>(null);
  const brushOverlayRef = useRef<HTMLDivElement | null>(null);
  const themeRev = useWaveformThemeRevision();
  const H = expanded ? 200 : 120;
  const PAD_TOP = 20;
  const PAD_BOTTOM = 22;
  const PAD_LEFT = 42;
  const PAD_RIGHT = 10;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || CANVAS_W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    if (series.length === 0 || totalDurationMs <= 0) return;

    const t = getStatsCanvasThemeColors();
    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOTTOM;

    let maxRate = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (p.wordsPerMin > maxRate) maxRate = p.wordsPerMin;
      }
    }
    maxRate = Math.max(maxRate, 10);
    const yMax = Math.ceil(maxRate / 20) * 20;

    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 0.5;
    ctx.font = "9px sans-serif";
    ctx.fillStyle = t.labelMuted;
    ctx.textAlign = "right";
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const val = (yMax / gridSteps) * i;
      const y = PAD_TOP + plotH - (val / yMax) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(W - PAD_RIGHT, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(val)}`, PAD_LEFT - 4, y + 3);
    }

    ctx.textAlign = "center";
    const timeSteps = Math.min(6, Math.floor(totalDurationMs / 60000));
    for (let i = 0; i <= Math.max(timeSteps, 1); i++) {
      const tMs = (totalDurationMs / Math.max(timeSteps, 1)) * i;
      const x = PAD_LEFT + (tMs / totalDurationMs) * plotW;
      const min = Math.floor(tMs / 60000);
      const sec = Math.floor((tMs % 60000) / 1000);
      ctx.fillText(`${min}:${sec.toString().padStart(2, "0")}`, x, H - 4);
    }

    ctx.save();
    ctx.translate(10, PAD_TOP + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = t.labelMuted;
    ctx.font = "9px sans-serif";
    ctx.fillText("mots/min", 0, 0);
    ctx.restore();

    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      if (s.points.length === 0) continue;
      const spIdx = speakers.indexOf(s.speaker);
      ctx.strokeStyle = speakerColor(spIdx >= 0 ? spIdx : si);
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let pi = 0; pi < s.points.length; pi++) {
        const p = s.points[pi];
        const x = PAD_LEFT + (p.timeMs / totalDurationMs) * plotW;
        const y = PAD_TOP + plotH - (Math.min(p.wordsPerMin, yMax) / yMax) * plotH;
        if (pi === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const px = PAD_LEFT + (playheadMs / totalDurationMs) * plotW;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, PAD_TOP);
    ctx.lineTo(px, PAD_TOP + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    if (brushRange) {
      const bx = PAD_LEFT + (brushRange.startMs / totalDurationMs) * plotW;
      const bw = ((brushRange.endMs - brushRange.startMs) / totalDurationMs) * plotW;
      ctx.fillStyle = t.brushFill;
      ctx.fillRect(bx, PAD_TOP, bw, plotH);
      ctx.strokeStyle = t.brushStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, PAD_TOP, bw, plotH);
    }
  }, [series, speakers, totalDurationMs, playheadMs, themeRev, H, brushRange]);

  const toMs = (cssX: number, rectWidth: number) =>
    ((cssX - PAD_LEFT) / (rectWidth - PAD_LEFT - PAD_RIGHT)) * totalDurationMs;

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || totalDurationMs <= 0) return;
    if (e.shiftKey && brushRange) {
      onBrushChange?.(null);
      e.preventDefault();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const ms = toMs(cssX, rect.width);
    if (ms < 0 || ms > totalDurationMs) return;
    startBrush(cssX, ms, brushDragRef, brushOverlayRef);
    e.preventDefault();
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!brushDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ms = toMs(e.clientX - rect.left, rect.width);
    endBrush(ms, totalDurationMs, brushDragRef, brushOverlayRef, onBrushChange, onSeekToMs);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    onBrushChange?.(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;

    if (moveBrush(cssX, brushDragRef, brushOverlayRef)) return;

    const tip = tooltipRef.current;
    if (!tip || totalDurationMs <= 0) return;
    const ms = toMs(cssX, rect.width);
    if (ms < 0 || ms > totalDurationMs) {
      hideTooltip(tip);
      return;
    }

    let text = `${formatClockSeconds(ms / 1000)}`;
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      let closest = s.points[0];
      let minDist = Infinity;
      for (const p of s.points) {
        const d = Math.abs(p.timeMs - ms);
        if (d < minDist) {
          minDist = d;
          closest = p;
        }
      }
      if (closest) text += `\n${s.speaker}: ${closest.wordsPerMin.toFixed(0)} m/min`;
    }
    showTooltip(tip, text, cssX, e.clientY - rect.top, rect.width);
  };

  return (
    <div className="stats-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={CANVAS_W_REF}
        height={H}
        className="stats-rate-canvas"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          cancelBrush(brushDragRef, brushOverlayRef);
          hideTooltip(tooltipRef.current);
        }}
        onDoubleClick={handleDoubleClick}
        title="Glisser pour une plage · Shift+clic pour effacer la sélection · double-clic efface aussi (un clic simple peut seek)"
        style={{ cursor: "crosshair" }}
      />
      <div ref={brushOverlayRef} className="stats-brush-overlay" />
      <div ref={tooltipRef} className="stats-canvas-tooltip" style={{ display: "none" }} />
    </div>
  );
}

// ─── SpeechDensityCanvas ──────────────────────────────────────────────────────

export function SpeechDensityCanvas({
  points,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
  expanded,
  brushRange,
  onBrushChange,
}: {
  points: DensityPoint[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  expanded?: boolean;
  brushRange?: BrushRange | null;
  onBrushChange?: (range: BrushRange | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const brushDragRef = useRef<BrushDrag | null>(null);
  const brushOverlayRef = useRef<HTMLDivElement | null>(null);
  const H = expanded ? 140 : 70;
  const themeRev = useWaveformThemeRevision();

  const PAD_L = 28;
  const PAD_R = 6;
  const PAD_T = 4;
  const PAD_B = 14;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || CANVAS_W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (totalDurationMs <= 0 || points.length === 0) return;

    const gW = W - PAD_L - PAD_R;
    const gH = H - PAD_T - PAD_B;

    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 0.5;
    for (const pct of [0.25, 0.5, 0.75, 1]) {
      const y = PAD_T + gH * (1 - pct);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(PAD_L + gW, y);
      ctx.stroke();
      ctx.fillStyle = t.labelMuted;
      ctx.font = "8px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(pct * 100)}%`, PAD_L - 3, y + 3);
    }

    ctx.beginPath();
    let started = false;
    for (const pt of points) {
      const x = PAD_L + (pt.timeMs / totalDurationMs) * gW;
      const y = PAD_T + gH * (1 - pt.density);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = t.densityStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const last = points[points.length - 1];
    if (last) {
      ctx.lineTo(PAD_L + (last.timeMs / totalDurationMs) * gW, PAD_T + gH);
      ctx.lineTo(PAD_L + (points[0].timeMs / totalDurationMs) * gW, PAD_T + gH);
      ctx.closePath();
      ctx.fillStyle = t.densityFill;
      ctx.fill();
    }

    const px = PAD_L + (playheadMs / totalDurationMs) * gW;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, PAD_T);
    ctx.lineTo(px, PAD_T + gH);
    ctx.stroke();

    if (brushRange) {
      const bx = PAD_L + (brushRange.startMs / totalDurationMs) * gW;
      const bw = ((brushRange.endMs - brushRange.startMs) / totalDurationMs) * gW;
      ctx.fillStyle = t.brushFill;
      ctx.fillRect(bx, PAD_T, bw, gH);
      ctx.strokeStyle = t.brushStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, PAD_T, bw, gH);
    }
  }, [points, totalDurationMs, playheadMs, themeRev, H, brushRange]);

  const toMs = (cssX: number, rectWidth: number) =>
    ((cssX - PAD_L) / (rectWidth - PAD_L - PAD_R)) * totalDurationMs;

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || totalDurationMs <= 0) return;
    if (e.shiftKey && brushRange) {
      onBrushChange?.(null);
      e.preventDefault();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const ms = toMs(cssX, rect.width);
    if (ms < 0 || ms > totalDurationMs) return;
    startBrush(cssX, ms, brushDragRef, brushOverlayRef);
    e.preventDefault();
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!brushDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ms = toMs(e.clientX - rect.left, rect.width);
    endBrush(ms, totalDurationMs, brushDragRef, brushOverlayRef, onBrushChange, onSeekToMs);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    onBrushChange?.(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;

    if (moveBrush(cssX, brushDragRef, brushOverlayRef)) return;

    const tip = tooltipRef.current;
    if (!tip || totalDurationMs <= 0 || points.length === 0) return;
    const ms = toMs(cssX, rect.width);
    if (ms < 0 || ms > totalDurationMs) {
      hideTooltip(tip);
      return;
    }

    let closest = points[0];
    let minDist = Infinity;
    for (const pt of points) {
      const d = Math.abs(pt.timeMs - ms);
      if (d < minDist) {
        minDist = d;
        closest = pt;
      }
    }

    showTooltip(
      tip,
      `${formatClockSeconds(ms / 1000)} · ${(closest.density * 100).toFixed(0)}% activité`,
      cssX,
      e.clientY - rect.top,
      rect.width,
    );
  };

  return (
    <div className="stats-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={CANVAS_W_REF}
        height={H}
        className="stats-density-canvas"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          cancelBrush(brushDragRef, brushOverlayRef);
          hideTooltip(tooltipRef.current);
        }}
        onDoubleClick={handleDoubleClick}
        title="Glisser pour une plage · Shift+clic pour effacer la sélection · double-clic efface aussi (un clic simple peut seek)"
        style={{ cursor: "crosshair" }}
      />
      <div ref={brushOverlayRef} className="stats-brush-overlay" />
      <div ref={tooltipRef} className="stats-canvas-tooltip" style={{ display: "none" }} />
    </div>
  );
}
