import type { EditableSegment, EventTurnRow, QueryWindowResult } from "../../../types";
import { LX_THEME_CHANGED_EVENT } from "../../../theme/applyStoredTheme";

/** Noms des variables `tokens.css` — même ordre que --lx-speaker-0 … 7 */
const SPEAKER_VAR = [
  "--lx-speaker-0",
  "--lx-speaker-1",
  "--lx-speaker-2",
  "--lx-speaker-3",
  "--lx-speaker-4",
  "--lx-speaker-5",
  "--lx-speaker-6",
  "--lx-speaker-7",
] as const;

/** Fallback si `getComputedStyle` indisponible (tests SSR sans :root) */
const SPEAKER_FALLBACK = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
] as const;

/** Cache des couleurs résolues — invalidé au changement de thème OS ou préférence LingWhistX */
let speakerResolvedCache: string[] | null = null;
let speakerCacheListeners = false;

function refreshSpeakerResolvedCache(): string[] {
  if (typeof document === "undefined") {
    return [...SPEAKER_FALLBACK];
  }
  const cs = getComputedStyle(document.documentElement);
  return SPEAKER_VAR.map((name, i) => {
    const raw = cs.getPropertyValue(name).trim();
    return raw || SPEAKER_FALLBACK[i];
  });
}

function ensureSpeakerResolvedCache(): string[] {
  if (speakerResolvedCache === null) {
    speakerResolvedCache = refreshSpeakerResolvedCache();
    if (!speakerCacheListeners && typeof window !== "undefined") {
      speakerCacheListeners = true;
      const bump = () => {
        speakerResolvedCache = null;
      };
      window.addEventListener(LX_THEME_CHANGED_EVENT, bump);
      if (typeof window.matchMedia === "function") {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", bump);
      }
    }
  }
  return speakerResolvedCache;
}

/**
 * Couleur locuteur (vues Player + canvas stats) — résolu depuis les tokens thème.
 * Une seule lecture `getComputedStyle` par palette tant que le thème ne change pas.
 */
export function speakerColor(idx: number): string {
  const cache = ensureSpeakerResolvedCache();
  const i = ((idx % cache.length) + cache.length) % cache.length;
  return cache[i];
}

/** Invalide le cache (tests ou après injection CSS dynamique). */
export function invalidateSpeakerColorCache(): void {
  speakerResolvedCache = null;
}

/** Alias pour styles inline `var(--lx-speaker-*)` sans résolution (léger) */
export const SPEAKER_COLORS = SPEAKER_VAR.map((v) => `var(${v})`) as readonly string[];

export function turnTextFromIpus(
  turn: EventTurnRow,
  ipus: QueryWindowResult["ipus"],
): string {
  const overlapping = ipus.filter(
    (ipu) => ipu.endMs > turn.startMs && ipu.startMs < turn.endMs,
  );
  if (overlapping.length === 0) return "";
  return overlapping
    .map((ipu) => ipu.text?.trim())
    .filter(Boolean)
    .join(" ");
}

export function turnTextFromSegments(
  turn: EventTurnRow,
  segments: EditableSegment[],
): string {
  const overlapping = segments.filter((seg) => {
    const sMs = Math.round(seg.start * 1000);
    const eMs = Math.round(seg.end * 1000);
    return eMs > turn.startMs && sMs < turn.endMs;
  });
  if (overlapping.length === 0) return "";
  return overlapping
    .map((seg) => seg.text?.trim())
    .filter(Boolean)
    .join(" ");
}

export function findSegmentIndexForTurn(
  turn: EventTurnRow,
  segments: EditableSegment[],
  ordinalIndex: Map<number, number> | null,
  allTurns: EventTurnRow[],
): number | null {
  for (let i = 0; i < segments.length; i++) {
    const sMs = Math.round(segments[i].start * 1000);
    const eMs = Math.round(segments[i].end * 1000);
    if (eMs > turn.startMs && sMs < turn.endMs) return i;
  }
  if (ordinalIndex) {
    const globalIdx = allTurns.indexOf(turn);
    const segIdx = ordinalIndex.get(globalIdx);
    if (segIdx != null) return segIdx;
  }
  return null;
}

/**
 * Pré-calcule un index ordinal turn→segment (global par ordre).
 * Fallback quand le matching temporel échoue (timestamps corrompus).
 */
export function buildOrdinalSegmentIndex(
  turns: EventTurnRow[],
  segments: EditableSegment[],
): Map<number, number> {
  const result = new Map<number, number>();
  for (let i = 0; i < turns.length && i < segments.length; i++) {
    result.set(i, i);
  }
  return result;
}
