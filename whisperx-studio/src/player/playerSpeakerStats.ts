/**
 * WX-667/710/711 — Calcul des statistiques prosodiques par locuteur depuis events.sqlite.
 */
import type { EventIpuRow, EventPauseRow, EventTurnRow, EventWordRow } from "../types";

/** Plage temporelle sélectionnée par brush (ms). */
export type BrushRange = { startMs: number; endMs: number };

/**
 * Filtre et clippe un tableau de rows EventRow à une plage temporelle.
 * Les rows qui ne chevauchent pas la plage sont éliminés.
 * `startMs`/`endMs` sont clampés aux bornes de la plage ; `durMs` est recalculé si présent.
 */
export function clipRowsToBrush<T extends { startMs: number; endMs: number }>(
  rows: T[],
  brush: BrushRange,
): T[] {
  const result: T[] = [];
  for (const row of rows) {
    if (row.endMs <= brush.startMs || row.startMs >= brush.endMs) continue;
    const clipped: T = {
      ...row,
      startMs: Math.max(row.startMs, brush.startMs),
      endMs: Math.min(row.endMs, brush.endMs),
    };
    if ("durMs" in clipped) {
      (clipped as { durMs: number }).durMs = clipped.endMs - clipped.startMs;
    }
    result.push(clipped);
  }
  return result;
}

export type PausesByType = Record<string, { count: number; totalMs: number }>;

export type TopIpu = {
  startMs: number;
  endMs: number;
  durMs: number;
  text: string;
  nWords: number;
};

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
  /** Ratio pause / (parole+pause) [0,1]. */
  pauseRatio: number;
  /** Ventilation des pauses par type (lexical, transition_gap, etc.). */
  pausesByType: PausesByType;
  /** Durée moyenne des IPU (ms). */
  meanIpuDurMs: number;
  /** Durée min des IPU (ms). */
  minIpuDurMs: number;
  /** Durée max des IPU (ms). */
  maxIpuDurMs: number;
  /** Top 3 IPU les plus longs. */
  topIpus: TopIpu[];
  /** Médiane des durées de pauses (ms). */
  medianPauseDurMs: number;
  /** 90e percentile des durées de pauses (ms). */
  p90PauseDurMs: number;
  /** Nombre de tours de parole. */
  nTurns: number;
  /** Durée moyenne d'un tour (ms). */
  meanTurnDurMs: number;
  /** Type-Token Ratio (0–1) — diversité lexicale. null si pas de mots. */
  ttr: number | null;
  /** Nombre de tokens uniques. null si pas de mots. */
  nUniqueTokens: number | null;
  /** Score de confiance moyen (0–1) si des mots sont fournis. */
  meanConfidence: number | null;
  /** % de mots avec confidence < 0.7. */
  lowConfidencePct: number | null;
  /** Distribution d'alignement {aligned, interpolated, failed, ...}. */
  alignmentDist: Record<string, number>;
};

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Calcule les statistiques par locuteur à partir de turns, pauses, IPUs et optionnellement words.
 *
 * `totalDurationMs` — durée totale du run, utilisée pour le ratio parole/silence.
 * Si non fourni, la durée est estimée depuis la dernière fin de tour.
 * `words` — optionnel, pour les scores de confiance et la distribution d'alignement.
 */
export function computeSpeakerStats(
  turns: EventTurnRow[],
  pauses: EventPauseRow[],
  ipus: EventIpuRow[],
  totalDurationMs?: number,
  words?: EventWordRow[],
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
    const meanPauseDurMs = pauseDurationsMs.length > 0 ? totalPauseMs / pauseDurationsMs.length : 0;
    const speechRatio = durationMs > 0 ? speechMs / durationMs : 0;
    const pauseRatio = speechMs + totalPauseMs > 0 ? totalPauseMs / (speechMs + totalPauseMs) : 0;

    const pausesByType: PausesByType = {};
    for (const p of speakerPauses) {
      const t = p.type ?? "unknown";
      if (!pausesByType[t]) pausesByType[t] = { count: 0, totalMs: 0 };
      pausesByType[t].count++;
      pausesByType[t].totalMs += p.durMs;
    }

    const ipuDurations = speakerIpus.map((i) => i.durMs);
    const meanIpuDurMs =
      ipuDurations.length > 0 ? ipuDurations.reduce((s, d) => s + d, 0) / ipuDurations.length : 0;
    const minIpuDurMs = ipuDurations.length > 0 ? Math.min(...ipuDurations) : 0;
    const maxIpuDurMs = ipuDurations.length > 0 ? Math.max(...ipuDurations) : 0;

    const topIpus: TopIpu[] = [...speakerIpus]
      .sort((a, b) => b.durMs - a.durMs)
      .slice(0, 3)
      .map((i) => ({
        startMs: i.startMs,
        endMs: i.endMs,
        durMs: i.durMs,
        text: i.text?.trim() ?? "",
        nWords: i.nWords,
      }));

    const sortedPauses = [...pauseDurationsMs].sort((a, b) => a - b);
    const medianPauseDurMs = percentile(sortedPauses, 50);
    const p90PauseDurMs = percentile(sortedPauses, 90);

    const nTurns = speakerTurns.length;
    const meanTurnDurMs = nTurns > 0 ? speechMs / nTurns : 0;

    let ttr: number | null = null;
    let nUniqueTokens: number | null = null;

    let meanConfidence: number | null = null;
    let lowConfidencePct: number | null = null;
    const alignmentDist: Record<string, number> = {};

    if (words && words.length > 0) {
      const speakerWords = words.filter((w) => w.speaker === speaker);
      if (speakerWords.length > 0) {
        const tokens = speakerWords
          .map((w) => (w.token ?? "").toLowerCase().trim())
          .filter((t) => t.length > 0);
        if (tokens.length > 0) {
          const unique = new Set(tokens);
          nUniqueTokens = unique.size;
          ttr = unique.size / tokens.length;
        }

        const withConf = speakerWords.filter((w) => w.confidence != null);
        if (withConf.length > 0) {
          const sum = withConf.reduce((s, w) => s + (w.confidence ?? 0), 0);
          meanConfidence = sum / withConf.length;
          const lowCount = withConf.filter((w) => (w.confidence ?? 0) < 0.7).length;
          lowConfidencePct = lowCount / withConf.length;
        }
        for (const w of speakerWords) {
          const status = w.alignmentStatus ?? "aligned";
          alignmentDist[status] = (alignmentDist[status] ?? 0) + 1;
        }
      }
    }

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
      pauseRatio,
      pausesByType,
      meanIpuDurMs,
      minIpuDurMs,
      maxIpuDurMs,
      topIpus,
      medianPauseDurMs,
      p90PauseDurMs,
      nTurns,
      meanTurnDurMs,
      ttr,
      nUniqueTokens,
      meanConfidence,
      lowConfidencePct,
      alignmentDist,
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

// ─── Overlap detection ───────────────────────────────────────────────────────

export type OverlapSegment = {
  startMs: number;
  endMs: number;
  speakers: string[];
};

export type OverlapStats = {
  segments: OverlapSegment[];
  count: number;
  totalMs: number;
  ratio: number;
};

/**
 * Détecte les zones de chevauchement (overlap) entre tours de speakers différents.
 */
export function computeOverlaps(turns: EventTurnRow[], totalDurationMs: number): OverlapStats {
  const sorted = [...turns]
    .filter((t) => t.endMs > t.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const segments: OverlapSegment[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].startMs >= sorted[i].endMs) break;
      if (sorted[i].speaker === sorted[j].speaker) continue;
      const oStart = Math.max(sorted[i].startMs, sorted[j].startMs);
      const oEnd = Math.min(sorted[i].endMs, sorted[j].endMs);
      if (oEnd - oStart > 20) {
        segments.push({
          startMs: oStart,
          endMs: oEnd,
          speakers: [sorted[i].speaker, sorted[j].speaker],
        });
      }
    }
  }

  const merged = mergeOverlapSegments(segments);
  const totalMs = merged.reduce((s, o) => s + (o.endMs - o.startMs), 0);
  return {
    segments: merged,
    count: merged.length,
    totalMs,
    ratio: totalDurationMs > 0 ? totalMs / totalDurationMs : 0,
  };
}

function mergeOverlapSegments(segs: OverlapSegment[]): OverlapSegment[] {
  if (segs.length === 0) return [];
  const sorted = [...segs].sort((a, b) => a.startMs - b.startMs);
  const result: OverlapSegment[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    if (sorted[i].startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, sorted[i].endMs);
      for (const sp of sorted[i].speakers) {
        if (!prev.speakers.includes(sp)) prev.speakers.push(sp);
      }
    } else {
      result.push({ ...sorted[i] });
    }
  }
  return result;
}

// ─── Transitions entre speakers ──────────────────────────────────────────────

export type TransitionPair = {
  from: string;
  to: string;
  gaps: number[];
  medianGapMs: number;
  count: number;
};

/**
 * Calcule les transitions (gaps/overlaps) entre tours consécutifs de speakers différents.
 * Un gap positif = silence entre les tours ; un gap négatif = overlap.
 */
export function computeTransitions(turns: EventTurnRow[]): TransitionPair[] {
  const sorted = [...turns]
    .filter((t) => t.endMs > t.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const pairMap = new Map<string, number[]>();

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.speaker === next.speaker) continue;
    const gap = next.startMs - cur.endMs;
    const key = `${cur.speaker}→${next.speaker}`;
    const arr = pairMap.get(key) ?? [];
    arr.push(gap);
    pairMap.set(key, arr);
  }

  const result: TransitionPair[] = [];
  for (const [key, gaps] of pairMap) {
    const [from, to] = key.split("→");
    const sorted2 = [...gaps].sort((a, b) => a - b);
    result.push({
      from,
      to,
      gaps,
      medianGapMs: percentile(sorted2, 50),
      count: gaps.length,
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

// ─── WX-710 : Timeline empilée (qui parle quand) ─────────────────────────────

export type TimelineSegment = {
  speaker: string;
  startMs: number;
  endMs: number;
};

/**
 * Construit une timeline linéaire des segments de parole par speaker,
 * triée chronologiquement. Utilisée pour la barre empilée et la timeline.
 */
export function buildSpeechTimeline(turns: EventTurnRow[]): TimelineSegment[] {
  return [...turns]
    .filter((t) => t.endMs > t.startMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((t) => ({ speaker: t.speaker, startMs: t.startMs, endMs: t.endMs }));
}

// ─── WX-711 : Débit de parole par fenêtre glissante ──────────────────────────

export type SpeechRatePoint = {
  timeMs: number;
  wordsPerMin: number;
};

export type SpeechRateSeries = {
  speaker: string;
  points: SpeechRatePoint[];
};

/**
 * Calcule le débit de parole (mots/min) par fenêtre glissante pour chaque speaker.
 *
 * @param ipus — IPU rows avec nWords, speaker, start/end
 * @param totalDurationMs — durée totale du fichier audio
 * @param windowMs — largeur de la fenêtre glissante (défaut 30s)
 * @param stepMs — pas de déplacement (défaut 5s)
 */
export function computeSpeechRate(
  ipus: EventIpuRow[],
  totalDurationMs: number,
  windowMs = 30_000,
  stepMs = 5_000,
): SpeechRateSeries[] {
  if (ipus.length === 0 || totalDurationMs <= 0) return [];

  const speakerSet = new Set<string>();
  for (const i of ipus) if (i.speaker) speakerSet.add(i.speaker);
  if (speakerSet.size === 0) return [];

  const sorted = [...ipus].sort((a, b) => a.startMs - b.startMs);

  const series: SpeechRateSeries[] = [];
  for (const speaker of speakerSet) {
    const speakerIpus = sorted.filter((i) => i.speaker === speaker);
    const points: SpeechRatePoint[] = [];

    for (let t = 0; t + windowMs <= totalDurationMs; t += stepMs) {
      const wStart = t;
      const wEnd = t + windowMs;
      let wordCount = 0;
      for (const si of speakerIpus) {
        const overlap = Math.max(0, Math.min(si.endMs, wEnd) - Math.max(si.startMs, wStart));
        if (overlap <= 0) continue;
        const ipuDur = si.endMs - si.startMs;
        const ratio = ipuDur > 0 ? overlap / ipuDur : 1;
        wordCount += si.nWords * ratio;
      }
      const windowSec = windowMs / 1000;
      points.push({
        timeMs: t + windowMs / 2,
        wordsPerMin: (wordCount / windowSec) * 60,
      });
    }

    series.push({ speaker, points });
  }

  return series.sort((a, b) => {
    const aMax = Math.max(0, ...a.points.map((p) => p.wordsPerMin));
    const bMax = Math.max(0, ...b.points.map((p) => p.wordsPerMin));
    return bMax - aMax;
  });
}

// ─── Densité de parole (% activité vocale par fenêtre glissante) ─────────────

export type DensityPoint = {
  timeMs: number;
  /** 0–1 : fraction de la fenêtre occupée par de la parole. */
  density: number;
};

/**
 * Calcule la densité de parole globale (toutes speakers confondues)
 * par fenêtre glissante.
 */
export function computeSpeechDensity(
  turns: EventTurnRow[],
  totalDurationMs: number,
  windowMs = 30_000,
  stepMs = 5_000,
): DensityPoint[] {
  if (turns.length === 0 || totalDurationMs <= 0) return [];
  const sorted = [...turns]
    .filter((t) => t.endMs > t.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const points: DensityPoint[] = [];
  for (let t = 0; t + windowMs <= totalDurationMs; t += stepMs) {
    const wStart = t;
    const wEnd = t + windowMs;
    let speechMs = 0;
    for (const turn of sorted) {
      if (turn.startMs >= wEnd) break;
      const overlap = Math.max(0, Math.min(turn.endMs, wEnd) - Math.max(turn.startMs, wStart));
      speechMs += overlap;
    }
    points.push({
      timeMs: t + windowMs / 2,
      density: Math.min(1, speechMs / windowMs),
    });
  }
  return points;
}

// ─── Export exhaustif ────────────────────────────────────────────────────────

export type FullStatsExport = {
  meta: {
    exported_at: string;
    duration_ms: number;
    total_speech_ms: number;
    silence_ms: number;
    speech_ratio: number;
    n_speakers: number;
    n_turns: number;
    n_words: number;
    global_rate_wpm: number;
  };
  overlaps: {
    count: number;
    total_ms: number;
    ratio: number;
    segments: { start_ms: number; end_ms: number; speakers: string[] }[];
  };
  transitions: {
    from: string;
    to: string;
    count: number;
    median_gap_ms: number;
    gaps_ms: number[];
  }[];
  density_curve: { time_ms: number; density: number }[];
  speech_rate_curves: {
    speaker: string;
    points: { time_ms: number; words_per_min: number }[];
  }[];
  quality: {
    score: number | null;
    global_mean_confidence: number | null;
    global_aligned_ratio: number | null;
  };
  per_speaker: FullSpeakerExport[];
  raw_data: {
    turns: { id: number; speaker: string; start_ms: number; end_ms: number; dur_ms: number }[];
    pauses: {
      id: number;
      speaker: string | null;
      start_ms: number;
      end_ms: number;
      dur_ms: number;
      type: string | null;
    }[];
    ipus: {
      id: number;
      speaker: string | null;
      start_ms: number;
      end_ms: number;
      dur_ms: number;
      n_words: number;
      text: string | null;
    }[];
    words: {
      id: number;
      speaker: string | null;
      start_ms: number;
      end_ms: number;
      token: string | null;
      confidence: number | null;
      alignment_status: string | null;
    }[];
  };
};

export type FullSpeakerExport = {
  speaker: string;
  speech: {
    total_ms: number;
    ratio: number;
    n_turns: number;
    mean_turn_ms: number;
  };
  words: {
    count: number;
    rate_words_per_sec: number;
    rate_words_per_min: number;
    unique_tokens: number | null;
    ttr: number | null;
  };
  ipus: {
    count: number;
    mean_dur_ms: number;
    min_dur_ms: number;
    max_dur_ms: number;
    top_3: { start_ms: number; end_ms: number; dur_ms: number; n_words: number; text: string }[];
  };
  pauses: {
    count: number;
    total_ms: number;
    mean_ms: number;
    median_ms: number;
    p90_ms: number;
    ratio: number;
    by_type: Record<string, { count: number; total_ms: number }>;
    all_durations_ms: number[];
  };
  quality: {
    mean_confidence: number | null;
    low_confidence_pct: number | null;
    alignment_distribution: Record<string, number>;
  };
};

/**
 * Construit l'objet d'export exhaustif avec toutes les données brutes et calculées.
 */
export function buildFullStatsExport(
  stats: SpeakerStats[],
  overlaps: OverlapStats,
  transitions: TransitionPair[],
  densityPoints: DensityPoint[],
  rateSeries: SpeechRateSeries[],
  qualityScore: number | null,
  durationMs: number,
  totalSpeechMs: number,
  totalWords: number,
  turns: EventTurnRow[],
  pauses: EventPauseRow[],
  ipus: EventIpuRow[],
  words: EventWordRow[],
): FullStatsExport {
  const silenceMs = Math.max(0, durationMs - totalSpeechMs);

  const confScores = stats.filter((s) => s.meanConfidence != null).map((s) => s.meanConfidence!);
  const globalMeanConf =
    confScores.length > 0 ? confScores.reduce((a, b) => a + b, 0) / confScores.length : null;
  const totalAligned = stats.reduce((sum, s) => sum + (s.alignmentDist["aligned"] ?? 0), 0);
  const totalAlignWords = stats.reduce(
    (sum, s) => sum + Object.values(s.alignmentDist).reduce((a, b) => a + b, 0),
    0,
  );
  const globalAlignedRatio = totalAlignWords > 0 ? totalAligned / totalAlignWords : null;

  return {
    meta: {
      exported_at: new Date().toISOString(),
      duration_ms: durationMs,
      total_speech_ms: totalSpeechMs,
      silence_ms: silenceMs,
      speech_ratio: durationMs > 0 ? totalSpeechMs / durationMs : 0,
      n_speakers: stats.length,
      n_turns: turns.length,
      n_words: totalWords,
      global_rate_wpm: totalSpeechMs > 0 ? (totalWords / (totalSpeechMs / 1000)) * 60 : 0,
    },
    overlaps: {
      count: overlaps.count,
      total_ms: overlaps.totalMs,
      ratio: overlaps.ratio,
      segments: overlaps.segments.map((s) => ({
        start_ms: s.startMs,
        end_ms: s.endMs,
        speakers: s.speakers,
      })),
    },
    transitions: transitions.map((t) => ({
      from: t.from,
      to: t.to,
      count: t.count,
      median_gap_ms: t.medianGapMs,
      gaps_ms: t.gaps,
    })),
    density_curve: densityPoints.map((p) => ({
      time_ms: p.timeMs,
      density: p.density,
    })),
    speech_rate_curves: rateSeries.map((s) => ({
      speaker: s.speaker,
      points: s.points.map((p) => ({
        time_ms: p.timeMs,
        words_per_min: p.wordsPerMin,
      })),
    })),
    quality: {
      score: qualityScore,
      global_mean_confidence: globalMeanConf,
      global_aligned_ratio: globalAlignedRatio,
    },
    per_speaker: stats.map((s) => ({
      speaker: s.speaker,
      speech: {
        total_ms: s.speechMs,
        ratio: s.speechRatio,
        n_turns: s.nTurns,
        mean_turn_ms: s.meanTurnDurMs,
      },
      words: {
        count: s.nWords,
        rate_words_per_sec: s.speechRateWordsPerSec,
        rate_words_per_min: s.speechRateWordsPerSec * 60,
        unique_tokens: s.nUniqueTokens,
        ttr: s.ttr,
      },
      ipus: {
        count: s.nIpus,
        mean_dur_ms: s.meanIpuDurMs,
        min_dur_ms: s.minIpuDurMs,
        max_dur_ms: s.maxIpuDurMs,
        top_3: s.topIpus.map((ti) => ({
          start_ms: ti.startMs,
          end_ms: ti.endMs,
          dur_ms: ti.durMs,
          n_words: ti.nWords,
          text: ti.text,
        })),
      },
      pauses: {
        count: s.nPauses,
        total_ms: s.totalPauseMs,
        mean_ms: s.meanPauseDurMs,
        median_ms: s.medianPauseDurMs,
        p90_ms: s.p90PauseDurMs,
        ratio: s.pauseRatio,
        by_type: Object.fromEntries(
          Object.entries(s.pausesByType).map(([k, v]) => [
            k,
            { count: v.count, total_ms: v.totalMs },
          ]),
        ),
        all_durations_ms: s.pauseDurationsMs,
      },
      quality: {
        mean_confidence: s.meanConfidence,
        low_confidence_pct: s.lowConfidencePct,
        alignment_distribution: s.alignmentDist,
      },
    })),
    raw_data: {
      turns: turns.map((t) => ({
        id: t.id,
        speaker: t.speaker,
        start_ms: t.startMs,
        end_ms: t.endMs,
        dur_ms: t.endMs - t.startMs,
      })),
      pauses: pauses.map((p) => ({
        id: p.id,
        speaker: p.speaker ?? null,
        start_ms: p.startMs,
        end_ms: p.endMs,
        dur_ms: p.durMs,
        type: p.type ?? null,
      })),
      ipus: ipus.map((i) => ({
        id: i.id,
        speaker: i.speaker ?? null,
        start_ms: i.startMs,
        end_ms: i.endMs,
        dur_ms: i.durMs,
        n_words: i.nWords,
        text: i.text ?? null,
      })),
      words: words.map((w) => ({
        id: w.id,
        speaker: w.speaker ?? null,
        start_ms: w.startMs,
        end_ms: w.endMs,
        token: w.token ?? null,
        confidence: w.confidence ?? null,
        alignment_status: w.alignmentStatus ?? null,
      })),
    },
  };
}

/**
 * Génère un export CSV exhaustif multi-sections.
 */
export function buildFullStatsCsv(exportData: FullStatsExport): string {
  const lines: string[] = [];
  const { meta, overlaps, quality, per_speaker, transitions, raw_data } = exportData;

  lines.push("# META");
  lines.push("key,value");
  lines.push(`exported_at,${meta.exported_at}`);
  lines.push(`duration_ms,${meta.duration_ms}`);
  lines.push(`total_speech_ms,${meta.total_speech_ms}`);
  lines.push(`silence_ms,${meta.silence_ms}`);
  lines.push(`speech_ratio,${meta.speech_ratio.toFixed(4)}`);
  lines.push(`n_speakers,${meta.n_speakers}`);
  lines.push(`n_turns,${meta.n_turns}`);
  lines.push(`n_words,${meta.n_words}`);
  lines.push(`global_rate_wpm,${meta.global_rate_wpm.toFixed(1)}`);
  lines.push(`quality_score,${quality.score ?? ""}`);
  lines.push(`global_mean_confidence,${quality.global_mean_confidence?.toFixed(4) ?? ""}`);
  lines.push(`global_aligned_ratio,${quality.global_aligned_ratio?.toFixed(4) ?? ""}`);
  lines.push(`overlaps_count,${overlaps.count}`);
  lines.push(`overlaps_total_ms,${overlaps.total_ms}`);
  lines.push(`overlaps_ratio,${overlaps.ratio.toFixed(4)}`);
  lines.push("");

  lines.push("# PER_SPEAKER");
  lines.push(
    "speaker,speech_ms,speech_ratio,n_turns,mean_turn_ms,n_words,rate_wps,rate_wpm,unique_tokens,ttr,n_ipus,mean_ipu_ms,min_ipu_ms,max_ipu_ms,n_pauses,total_pause_ms,mean_pause_ms,median_pause_ms,p90_pause_ms,pause_ratio,mean_confidence,low_confidence_pct",
  );
  for (const s of per_speaker) {
    lines.push(
      [
        s.speaker,
        s.speech.total_ms,
        s.speech.ratio.toFixed(4),
        s.speech.n_turns,
        Math.round(s.speech.mean_turn_ms),
        s.words.count,
        s.words.rate_words_per_sec.toFixed(2),
        s.words.rate_words_per_min.toFixed(1),
        s.words.unique_tokens ?? "",
        s.words.ttr?.toFixed(4) ?? "",
        s.ipus.count,
        Math.round(s.ipus.mean_dur_ms),
        Math.round(s.ipus.min_dur_ms),
        Math.round(s.ipus.max_dur_ms),
        s.pauses.count,
        s.pauses.total_ms,
        Math.round(s.pauses.mean_ms),
        Math.round(s.pauses.median_ms),
        Math.round(s.pauses.p90_ms),
        s.pauses.ratio.toFixed(4),
        s.quality.mean_confidence?.toFixed(4) ?? "",
        s.quality.low_confidence_pct?.toFixed(4) ?? "",
      ].join(","),
    );
  }
  lines.push("");

  lines.push("# PAUSES_BY_TYPE");
  lines.push("speaker,type,count,total_ms");
  for (const s of per_speaker) {
    for (const [type, val] of Object.entries(s.pauses.by_type)) {
      lines.push(`${s.speaker},${type},${val.count},${val.total_ms}`);
    }
  }
  lines.push("");

  lines.push("# ALIGNMENT_DISTRIBUTION");
  lines.push("speaker,status,count");
  for (const s of per_speaker) {
    for (const [status, count] of Object.entries(s.quality.alignment_distribution)) {
      lines.push(`${s.speaker},${status},${count}`);
    }
  }
  lines.push("");

  lines.push("# TOP_IPUS");
  lines.push("speaker,rank,start_ms,end_ms,dur_ms,n_words,text");
  for (const s of per_speaker) {
    s.ipus.top_3.forEach((ti, idx) => {
      const text = ti.text.replace(/,/g, ";").replace(/\n/g, " ");
      lines.push(
        `${s.speaker},${idx + 1},${ti.start_ms},${ti.end_ms},${ti.dur_ms},${ti.n_words},"${text}"`,
      );
    });
  }
  lines.push("");

  lines.push("# TRANSITIONS");
  lines.push("from,to,count,median_gap_ms");
  for (const t of transitions) {
    lines.push(`${t.from},${t.to},${t.count},${Math.round(t.median_gap_ms)}`);
  }
  lines.push("");

  lines.push("# OVERLAP_SEGMENTS");
  lines.push("start_ms,end_ms,speakers");
  for (const s of overlaps.segments) {
    lines.push(`${s.start_ms},${s.end_ms},"${s.speakers.join(";")}"`);
  }
  lines.push("");

  lines.push("# RAW_TURNS");
  lines.push("id,speaker,start_ms,end_ms,dur_ms");
  for (const t of raw_data.turns) {
    lines.push(`${t.id},${t.speaker},${t.start_ms},${t.end_ms},${t.dur_ms}`);
  }
  lines.push("");

  lines.push("# RAW_PAUSES");
  lines.push("id,speaker,start_ms,end_ms,dur_ms,type");
  for (const p of raw_data.pauses) {
    lines.push(`${p.id},${p.speaker ?? ""},${p.start_ms},${p.end_ms},${p.dur_ms},${p.type ?? ""}`);
  }
  lines.push("");

  lines.push("# RAW_IPUS");
  lines.push("id,speaker,start_ms,end_ms,dur_ms,n_words,text");
  for (const i of raw_data.ipus) {
    const text = (i.text ?? "").replace(/,/g, ";").replace(/\n/g, " ");
    lines.push(
      `${i.id},${i.speaker ?? ""},${i.start_ms},${i.end_ms},${i.dur_ms},${i.n_words},"${text}"`,
    );
  }
  lines.push("");

  lines.push("# RAW_WORDS");
  lines.push("id,speaker,start_ms,end_ms,token,confidence,alignment_status");
  for (const w of raw_data.words) {
    lines.push(
      `${w.id},${w.speaker ?? ""},${w.start_ms},${w.end_ms},${w.token ?? ""},${w.confidence ?? ""},${w.alignment_status ?? ""}`,
    );
  }

  return lines.join("\n");
}
