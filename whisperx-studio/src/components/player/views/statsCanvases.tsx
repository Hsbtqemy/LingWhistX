import { useEffect, useRef } from "react";
import { formatClockSeconds } from "../../../appUtils";
import { getStatsCanvasThemeColors } from "../../../hooks/statsCanvasTheme";
import { useWaveformThemeRevision } from "../../../hooks/waveformCanvasTheme";
import { buildPauseHistogram } from "../../../player/playerSpeakerStats";
import type {
  DensityPoint,
  SpeechRateSeries,
  TimelineSegment,
} from "../../../player/playerSpeakerStats";
import { speakerColor } from "./viewUtils";

const STATS_HISTOGRAM_BINS = 12;
const STATS_HISTOGRAM_W = 200;
const STATS_HISTOGRAM_H = 56;

export function PauseHistogramCanvas({
  durationsMs,
  activeColor,
}: {
  durationsMs: number[];
  activeColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRev = useWaveformThemeRevision();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || STATS_HISTOGRAM_W;
    const H = STATS_HISTOGRAM_H;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const bins = buildPauseHistogram(durationsMs, STATS_HISTOGRAM_BINS);
    ctx.clearRect(0, 0, W, H);

    if (bins.length === 0) {
      ctx.fillStyle = t.labelMuted;
      ctx.font = "10px sans-serif";
      ctx.fillText("\u2014", 4, H / 2 + 4);
      return;
    }

    const maxCount = Math.max(...bins.map((b) => b.count), 1);
    const barW = W / bins.length;
    const pad = 1;

    for (let i = 0; i < bins.length; i++) {
      const barH = Math.round((bins[i].count / maxCount) * (H - 2));
      ctx.fillStyle = activeColor;
      ctx.fillRect(i * barW + pad, H - barH, barW - pad * 2, barH);
    }
  }, [durationsMs, activeColor, themeRev]);

  return (
    <canvas
      ref={canvasRef}
      width={STATS_HISTOGRAM_W}
      height={STATS_HISTOGRAM_H}
      className="stats-histogram-canvas"
      title="Distribution durées de pauses"
    />
  );
}

export function SpeechBarCanvas({
  stats,
  totalDurationMs,
  activeSpeaker,
}: {
  stats: { speaker: string; speechMs: number }[];
  totalDurationMs: number;
  activeSpeaker: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRev = useWaveformThemeRevision();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || 600;
    const H = 38;
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

    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const w = (s.speechMs / totalDurationMs) * W;
      if (w < 1) continue;
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
      x += w;
    }

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
    x = 0;
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const w = (s.speechMs / totalDurationMs) * W;
      if (w > 40) {
        const pct = ((s.speechMs / totalDurationMs) * 100).toFixed(0);
        ctx.fillText(`${pct}%`, x + 3, barH + 10);
      }
      x += w;
    }
  }, [stats, totalDurationMs, activeSpeaker, themeRev]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={38}
      className="stats-speech-bar-canvas"
      title="Répartition temps de parole"
    />
  );
}

export function SpeechTimelineCanvas({
  timeline,
  speakers,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
  overlapSegments,
}: {
  timeline: TimelineSegment[];
  speakers: string[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  overlapSegments?: { startMs: number; endMs: number }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const W_REF = 600;
  const H = 60;
  const themeRev = useWaveformThemeRevision();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    if (totalDurationMs <= 0) return;

    const laneH = speakers.length > 0 ? Math.min(20, (H - 10) / speakers.length) : 20;
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
  }, [timeline, speakers, totalDurationMs, playheadMs, overlapSegments, themeRev]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeekToMs || totalDurationMs <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ms = (x / rect.width) * totalDurationMs;
    onSeekToMs(Math.max(0, Math.round(ms)));
  };

  return (
    <canvas
      ref={canvasRef}
      width={W_REF}
      height={H}
      className="stats-timeline-canvas"
      title="Timeline alternances de parole — clic pour seek"
      onClick={handleClick}
      style={{ cursor: onSeekToMs ? "pointer" : "default" }}
    />
  );
}

export function SpeechRateCanvas({
  series,
  speakers,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
}: {
  series: SpeechRateSeries[];
  speakers: string[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const themeRev = useWaveformThemeRevision();
  const W_REF = 600;
  const H = 120;
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
    const W = Math.round(rect.width) || W_REF;
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
  }, [series, speakers, totalDurationMs, playheadMs, themeRev]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeekToMs || totalDurationMs <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
    const ms = ((x - PAD_LEFT) / plotW) * totalDurationMs;
    onSeekToMs(Math.max(0, Math.round(ms)));
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const tip = tooltipRef.current;
    const canvas = canvasRef.current;
    if (!tip || !canvas || totalDurationMs <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
    const ms = ((x - PAD_LEFT) / plotW) * totalDurationMs;
    if (ms < 0 || ms > totalDurationMs) { tip.style.display = "none"; return; }

    let text = `${formatClockSeconds(ms / 1000)}\n`;
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      let closest = s.points[0];
      let minDist = Infinity;
      for (const p of s.points) {
        const d = Math.abs(p.timeMs - ms);
        if (d < minDist) { minDist = d; closest = p; }
      }
      if (closest) text += `${s.speaker}: ${closest.wordsPerMin.toFixed(0)} m/min\n`;
    }
    tip.textContent = text.trim();
    tip.style.display = "block";
    tip.style.left = `${Math.min(x + 8, rect.width - 120)}px`;
    tip.style.top = `${e.clientY - rect.top - 40}px`;
  };

  const handleMouseLeave = () => {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
  };

  return (
    <div className="stats-rate-chart-wrap" style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={W_REF}
        height={H}
        className="stats-rate-canvas"
        title="Débit de parole (mots/min) — clic pour seek"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: onSeekToMs ? "crosshair" : "default" }}
      />
      <div
        ref={tooltipRef}
        className="stats-rate-tooltip"
        style={{ display: "none", position: "absolute", pointerEvents: "none" }}
      />
    </div>
  );
}

export function SpeechDensityCanvas({
  points,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
}: {
  points: DensityPoint[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const W_REF = 600;
  const H = 70;
  const themeRev = useWaveformThemeRevision();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = getStatsCanvasThemeColors();
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (totalDurationMs <= 0 || points.length === 0) return;

    const padL = 28;
    const padR = 6;
    const padT = 4;
    const padB = 14;
    const gW = W - padL - padR;
    const gH = H - padT - padB;

    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 0.5;
    for (const pct of [0.25, 0.5, 0.75, 1]) {
      const y = padT + gH * (1 - pct);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + gW, y);
      ctx.stroke();
      ctx.fillStyle = t.labelMuted;
      ctx.font = "8px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(pct * 100)}%`, padL - 3, y + 3);
    }

    ctx.beginPath();
    let started = false;
    for (const pt of points) {
      const x = padL + (pt.timeMs / totalDurationMs) * gW;
      const y = padT + gH * (1 - pt.density);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = t.densityStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const last = points[points.length - 1];
    if (last) {
      ctx.lineTo(padL + (last.timeMs / totalDurationMs) * gW, padT + gH);
      ctx.lineTo(padL + (points[0].timeMs / totalDurationMs) * gW, padT + gH);
      ctx.closePath();
      ctx.fillStyle = t.densityFill;
      ctx.fill();
    }

    const px = padL + (playheadMs / totalDurationMs) * gW;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + gH);
    ctx.stroke();
  }, [points, totalDurationMs, playheadMs, themeRev]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeekToMs || totalDurationMs <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 28;
    const padR = 6;
    const gW = rect.width - padL - padR;
    const x = e.clientX - rect.left - padL;
    if (x < 0 || x > gW) return;
    onSeekToMs(Math.max(0, Math.round((x / gW) * totalDurationMs)));
  };

  return (
    <canvas
      ref={canvasRef}
      width={W_REF}
      height={H}
      className="stats-density-canvas"
      title="Densité de parole — clic pour seek"
      onClick={handleClick}
      style={{ cursor: onSeekToMs ? "pointer" : "default" }}
    />
  );
}
