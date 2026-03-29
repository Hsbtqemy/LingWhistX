import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";
import { getWaveformCanvasThemeColors, useWaveformThemeRevision } from "../../hooks/waveformCanvasTheme";
import type { WaveformOverviewEnvelope } from "../../types";

export type WaveformOverviewStripProps = {
  durationSec: number;
  viewStartSec: number;
  viewEndSec: number;
  maxViewStartSec: number;
  overview: WaveformOverviewEnvelope | null;
  isLoading: boolean;
  setViewStartSec: (sec: number) => void;
};

/**
 * Bandeau overview (L3/L4) + rectangle de fenêtre synchronisé avec le canvas détail.
 */
export function WaveformOverviewStrip(props: WaveformOverviewStripProps) {
  const {
    durationSec,
    viewStartSec,
    viewEndSec,
    maxViewStartSec,
    overview,
    isLoading,
    setViewStartSec,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startClientX: number; startViewStart: number } | null>(null);
  const themeRevision = useWaveformThemeRevision();

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !overview || durationSec <= 0) {
      return;
    }
    const colors = getWaveformCanvasThemeColors();
    const widthCss = Math.max(120, Math.floor(wrap.clientWidth));
    const heightCss = 56;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(widthCss * dpr);
    canvas.height = Math.floor(heightCss * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, heightCss);
    ctx.fillStyle = colors.overviewBg;
    ctx.fillRect(0, 0, widthCss, heightCss);

    const { minMax, nBlocks } = overview;
    const centerY = heightCss / 2;
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY + 0.5);
    ctx.lineTo(widthCss, centerY + 0.5);
    ctx.stroke();

    ctx.strokeStyle = colors.envelopeStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cols = Math.max(1, widthCss);
    for (let x = 0; x < cols; x += 1) {
      const bi = Math.min(nBlocks - 1, Math.floor((x / cols) * nBlocks));
      const o = bi * 2;
      const mn = (minMax[o] ?? 0) / 32767;
      const mx = (minMax[o + 1] ?? 0) / 32767;
      const amp = Math.max(Math.abs(mn), Math.abs(mx));
      const h = Math.max(1, Math.min(1, amp) * (centerY - 6));
      ctx.moveTo(x + 0.5, centerY - h);
      ctx.lineTo(x + 0.5, centerY + h);
    }
    ctx.stroke();
  }, [durationSec, overview, themeRevision]);

  const visible = Math.max(0.001, viewEndSec - viewStartSec);
  const leftPct = durationSec > 0 ? (viewStartSec / durationSec) * 100 : 0;
  const widthPct = durationSec > 0 ? (visible / durationSec) * 100 : 100;

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || durationSec <= 0) {
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return;
    }
    const ratio = (e.clientX - rect.left) / rect.width;
    const center = ratio * durationSec;
    const next = center - visible / 2;
    setViewStartSec(Math.max(0, Math.min(maxViewStartSec, next)));
  };

  const onViewportPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    dragRef.current = { startClientX: e.clientX, startViewStart: viewStartSec };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onViewportPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || durationSec <= 0) {
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return;
    }
    const deltaSec = ((e.clientX - drag.startClientX) / rect.width) * durationSec;
    const next = drag.startViewStart + deltaSec;
    setViewStartSec(Math.max(0, Math.min(maxViewStartSec, next)));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="waveform-overview-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="waveform-overview-canvas" aria-hidden />
      {overview ? (
        <>
          <button
            type="button"
            className="waveform-overview-track"
            aria-label="Cliquer pour centrer la fenetre sur cette position"
            onPointerDown={onTrackPointerDown}
          />
          <div
            className="waveform-overview-viewport"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </>
      ) : null}
      {isLoading ? (
        <div className="waveform-overview-status" role="status">
          Chargement overview…
        </div>
      ) : null}
      {!overview && !isLoading ? (
        <div className="waveform-overview-placeholder">
          Overview (L3/L4) après génération pyramide WXENV.
        </div>
      ) : null}
    </div>
  );
}
