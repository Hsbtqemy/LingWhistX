import type { EventTurnRow } from "../types";

export type TimeBinMs = { startMs: number; endMs: number };

/** Découpe [t0Ms, t1Ms) en tranches de `binSec` secondes (alignées sur des multiples de binMs). */
export function buildTimeBins(t0Ms: number, t1Ms: number, binSec: number): TimeBinMs[] {
  if (t1Ms <= t0Ms || binSec <= 0) {
    return [];
  }
  const binMs = Math.round(binSec * 1000);
  const out: TimeBinMs[] = [];
  let s = Math.floor(t0Ms / binMs) * binMs;
  while (s < t1Ms) {
    const e = Math.min(s + binMs, t1Ms);
    if (e > s) {
      out.push({ startMs: s, endMs: e });
    }
    s += binMs;
  }
  return out;
}

export function turnOverlapsBin(turn: EventTurnRow, binStartMs: number, binEndMs: number): boolean {
  return turn.endMs > binStartMs && turn.startMs < binEndMs;
}

/** Tours d’un locuteur qui intersectent le bin (pour la grille temps). */
export function turnsForSpeakerInBin(
  turns: EventTurnRow[],
  speaker: string,
  binStartMs: number,
  binEndMs: number,
): EventTurnRow[] {
  const sp = speaker.trim() || "—";
  return turns.filter(
    (t) => (t.speaker?.trim() || "—") === sp && turnOverlapsBin(t, binStartMs, binEndMs),
  );
}

export function uniqueSpeakersFromTurns(turns: EventTurnRow[]): string[] {
  const s = new Set<string>();
  for (const t of turns) {
    s.add(t.speaker?.trim() || "—");
  }
  return Array.from(s).sort((a, b) => a.localeCompare(b, "fr"));
}
