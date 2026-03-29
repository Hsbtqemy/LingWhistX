/**
 * WX-667 — Calcul des statistiques prosodiques par locuteur depuis events.sqlite.
 */
import type { EventIpuRow, EventPauseRow, EventTurnRow } from "../types";

export type SpeakerStats = {
  speaker: string;
  /** Durée totale de parole (sum turns) en ms. */
  speechMs: number;
  /** Ratio parole/silence [0,1]. */
  speechRatio: number;
  /** Nombre d'IPU (unités prosodiques). */
  nIpus: number;
  /** Nombre de mots (depuis les IPU). */
  nWords: number;
  /** Débit moyen en mots/seconde. */
  speechRateWordsPerSec: number;
  /** Durées individuelles des pauses (ms). */
  pauseDurationsMs: number[];
  /** Durée moyenne des pauses (ms). */
  meanPauseDurMs: number;
  /** Durée totale des pauses (ms). */
  totalPauseMs: number;
  /** Nombre de pauses attribuées à ce locuteur. */
  nPauses: number;
};

/**
 * Calcule les statistiques par locuteur à partir de turns, pauses et IPUs.
 *
 * `totalDurationMs` — durée totale du run, utilisée pour le ratio parole/silence.
 * Si non fourni, la durée est estimée depuis la dernière fin de tour.
 */
export function computeSpeakerStats(
  turns: EventTurnRow[],
  pauses: EventPauseRow[],
  ipus: EventIpuRow[],
  totalDurationMs?: number,
): SpeakerStats[] {
  const speakerSet = new Set<string>();
  for (const t of turns) speakerSet.add(t.speaker);
  for (const p of pauses) if (p.speaker) speakerSet.add(p.speaker);
  for (const i of ipus) if (i.speaker) speakerSet.add(i.speaker);

  if (speakerSet.size === 0) return [];

  const maxEndMs = Math.max(
    ...turns.map((t) => t.endMs),
    ...pauses.map((p) => p.endMs),
    ...ipus.map((i) => i.endMs),
    0,
  );
  const durationMs = totalDurationMs ?? maxEndMs;

  const stats: SpeakerStats[] = [];

  for (const speaker of speakerSet) {
    const speakerTurns = turns.filter((t) => t.speaker === speaker);
    const speakerPauses = pauses.filter((p) => p.speaker === speaker);
    const speakerIpus = ipus.filter((i) => i.speaker === speaker);

    const speechMs = speakerTurns.reduce((s, t) => s + Math.max(0, t.endMs - t.startMs), 0);
    const nWords = speakerIpus.reduce((s, i) => s + i.nWords, 0);
    const nIpus = speakerIpus.length;
    const speechRateWordsPerSec = speechMs > 0 ? nWords / (speechMs / 1000) : 0;
    const pauseDurationsMs = speakerPauses.map((p) => p.durMs);
    const totalPauseMs = pauseDurationsMs.reduce((s, d) => s + d, 0);
    const meanPauseDurMs =
      pauseDurationsMs.length > 0 ? totalPauseMs / pauseDurationsMs.length : 0;
    const speechRatio = durationMs > 0 ? speechMs / durationMs : 0;

    stats.push({
      speaker,
      speechMs,
      speechRatio,
      nIpus,
      nWords,
      speechRateWordsPerSec,
      pauseDurationsMs,
      meanPauseDurMs,
      totalPauseMs,
      nPauses: pauseDurationsMs.length,
    });
  }

  return stats.sort((a, b) => b.speechMs - a.speechMs);
}

/** Construit un histogramme (bins) depuis une liste de durées en ms. */
export function buildPauseHistogram(
  durationsMs: number[],
  nBins: number,
): { binMs: number; count: number }[] {
  if (durationsMs.length === 0) return [];
  const maxDur = Math.max(...durationsMs);
  if (maxDur <= 0) return [];

  const binWidth = maxDur / nBins;
  const bins: { binMs: number; count: number }[] = Array.from({ length: nBins }, (_, i) => ({
    binMs: (i + 0.5) * binWidth,
    count: 0,
  }));

  for (const d of durationsMs) {
    const idx = Math.min(nBins - 1, Math.floor(d / binWidth));
    bins[idx].count++;
  }

  return bins;
}
