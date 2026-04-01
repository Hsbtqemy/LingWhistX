/**
 * Couleurs canvas stats — lues depuis `tokens.css` (--lx-stats-*, --lx-text-*).
 * Canvas 2D n’accepte pas `var()` dans fillStyle/strokeStyle de façon fiable partout.
 */
export type StatsCanvasThemeColors = {
  labelMuted: string;
  textInverse: string;
  laneBg: string;
  silenceBg: string;
  grid: string;
  overlapFill: string;
  overlapStroke: string;
  accent: string;
  densityFill: string;
  densityStroke: string;
};

export function getStatsCanvasThemeColors(): StatsCanvasThemeColors {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    labelMuted: v("--lx-text-2", "#64748b"),
    textInverse: v("--lx-text-inverse", "#ffffff"),
    laneBg: v("--lx-stats-lane-bg", "rgba(0, 0, 0, 0.06)"),
    silenceBg: v("--lx-stats-silence-bg", "rgba(128, 128, 128, 0.15)"),
    grid: v("--lx-stats-grid", "rgba(128, 128, 128, 0.15)"),
    overlapFill: v("--lx-stats-overlap-fill", "rgba(217, 83, 79, 0.25)"),
    overlapStroke: v("--lx-stats-overlap-stroke", "rgba(217, 83, 79, 0.6)"),
    accent: v("--lx-accent", "#0f8a94"),
    densityFill: v("--lx-stats-density-fill", "rgba(52, 152, 219, 0.08)"),
    densityStroke: v("--lx-stats-density-stroke", "rgba(52, 152, 219, 0.9)"),
  };
}
