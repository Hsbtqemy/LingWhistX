import { useEffect, useState } from "react";
import { LX_THEME_CHANGED_EVENT } from "../theme/applyStoredTheme";

/**
 * Couleurs canvas résolues depuis les tokens `--lx-waveform-*` (voir `styles/tokens.css`).
 * `fillStyle` / `strokeStyle` n’acceptent pas `var()` ; on lit les valeurs calculées sur `:root`.
 */
export type WaveformCanvasThemeColors = {
  canvasBg: string;
  overviewBg: string;
  gridLine: string;
  envelopeStroke: string;
  playhead: string;
  cursor: string;
  segmentOverlay: string;
  segmentFocus: string;
  pauseOverlay: string;
  rangeValid: string;
  rangePreview: string;
  loopBand: string;
  handleCold: string;
  handleHot: string;
  // WX-726 marqueurs contextuels
  markerLongPause: string;
  markerOverlap: string;
  markerSpeakerChange: string;
  markerLowConf: string;
  // WX-726 lanes d'analyse
  laneDensityFill: string;
  laneSpeechRateFill: string;
  laneConfFill: string;
  laneBg: string;
  laneGrid: string;
  laneLabel: string;
  // WX-727 sélection analyse
  analysisSelFill: string;
  analysisSelHandle: string;
  // Dessin de plage (création de segment)
  drawRangeFill: string;
  drawRangeStroke: string;
};

function readWaveformCanvasThemeColors(): WaveformCanvasThemeColors {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    canvasBg: v("--lx-waveform-canvas-bg", "#f5fcfc"),
    overviewBg: v("--lx-waveform-overview-bg", "#eef8f9"),
    gridLine: v("--lx-waveform-grid-line", "rgba(16, 93, 103, 0.25)"),
    envelopeStroke: v("--lx-waveform-envelope-stroke", "#0f7e8a"),
    playhead: v("--lx-waveform-playhead", "#d35d2f"),
    cursor: v("--lx-waveform-cursor", "#1964b6"),
    segmentOverlay: v("--lx-waveform-segment-overlay", "rgba(19, 111, 126, 0.14)"),
    segmentFocus: v("--lx-waveform-segment-focus", "rgba(36, 123, 176, 0.24)"),
    pauseOverlay: v("--lx-waveform-pause-overlay", "rgba(110, 75, 155, 0.13)"),
    rangeValid: v("--lx-waveform-range-valid", "rgba(52, 140, 88, 0.22)"),
    rangePreview: v("--lx-waveform-range-preview", "rgba(210, 165, 40, 0.2)"),
    loopBand: v("--lx-waveform-loop-band", "rgba(138, 75, 22, 0.18)"),
    handleCold: v("--lx-waveform-handle-cold", "#1a6fb0"),
    handleHot: v("--lx-waveform-handle-hot", "#e06b2f"),
    markerLongPause: v("--lx-waveform-marker-long-pause", "rgba(210, 50, 50, 0.7)"),
    markerOverlap: v("--lx-waveform-marker-overlap", "rgba(220, 120, 30, 0.28)"),
    markerSpeakerChange: v("--lx-waveform-marker-speaker-change", "rgba(30, 120, 200, 0.55)"),
    markerLowConf: v("--lx-waveform-marker-low-conf", "rgba(220, 140, 30, 0.85)"),
    laneDensityFill: v("--lx-waveform-lane-density", "rgba(19, 111, 126, 0.55)"),
    laneSpeechRateFill: v("--lx-waveform-lane-speech-rate", "rgba(80, 140, 60, 0.6)"),
    laneConfFill: v("--lx-waveform-lane-conf", "rgba(52, 140, 88, 0.7)"),
    laneBg: v("--lx-waveform-lane-bg", "rgba(240, 248, 252, 0.9)"),
    laneGrid: v("--lx-waveform-lane-grid", "rgba(16, 93, 103, 0.15)"),
    laneLabel: v("--lx-waveform-lane-label", "#4a7a85"),
    analysisSelFill: v("--lx-waveform-analysis-sel-fill", "rgba(100, 60, 200, 0.12)"),
    analysisSelHandle: v("--lx-waveform-analysis-sel-handle", "rgba(100, 60, 200, 0.8)"),
    drawRangeFill: v("--lx-waveform-draw-range-fill", "rgba(80, 200, 120, 0.18)"),
    drawRangeStroke: v("--lx-waveform-draw-range-stroke", "rgba(80, 200, 120, 0.7)"),
  };
}

/** Incrémente quand le thème système ou la préférence utilisateur change (redessin canvas). */
export function useWaveformThemeRevision(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN((x) => x + 1);
    window.addEventListener(LX_THEME_CHANGED_EVENT, bump);
    let mq: MediaQueryList | null = null;
    if (typeof window.matchMedia === "function") {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", bump);
    }
    return () => {
      window.removeEventListener(LX_THEME_CHANGED_EVENT, bump);
      mq?.removeEventListener("change", bump);
    };
  }, []);
  return n;
}

export function getWaveformCanvasThemeColors(): WaveformCanvasThemeColors {
  return readWaveformCanvasThemeColors();
}
