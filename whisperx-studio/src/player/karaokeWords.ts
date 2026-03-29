import type { EventWordRow } from "../types";

/** Nombre de mots à afficher de chaque côté du mot actif (virtualisation). */
export const KARAOKE_VISIBLE_RADIUS = 40;

/**
 * WX-668 — Un mot est considéré « aligné » si son alignmentStatus est absent,
 * null, ou égal à `'aligned'`. Les statuts `'failed'`, `'interpolated'`, etc.
 * sont affichés en style dégradé.
 */
export function isWordAligned(word: EventWordRow): boolean {
  const s = word.alignmentStatus;
  if (s == null || s === "aligned") return true;
  return false;
}

/**
 * Index du mot « actif » pour une tête de lecture donnée : mot courant si dedans,
 * sinon dernier mot commencé (pause / silence entre deux mots).
 */
export function findActiveWordIndex(sortedWords: EventWordRow[], playheadMs: number): number {
  if (sortedWords.length === 0) {
    return -1;
  }
  for (let i = 0; i < sortedWords.length; i++) {
    const w = sortedWords[i];
    if (playheadMs >= w.startMs && playheadMs < w.endMs) {
      return i;
    }
  }
  let best = -1;
  for (let i = 0; i < sortedWords.length; i++) {
    if (sortedWords[i].startMs <= playheadMs) {
      best = i;
    }
  }
  return best;
}

export function karaokeVisibleRange(
  len: number,
  activeIdx: number,
  radius: number,
): { from: number; to: number } {
  if (len === 0) {
    return { from: 0, to: 0 };
  }
  const center = activeIdx >= 0 ? activeIdx : 0;
  const from = Math.max(0, center - radius);
  const to = Math.min(len, center + radius + 1);
  return { from, to };
}
