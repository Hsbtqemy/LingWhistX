import { describe, expect, it } from "vitest";
import type { EventIpuRow, EventPauseRow, EventTurnRow, EventWordRow } from "../types";
import {
  buildFullStatsCsv,
  buildFullStatsExport,
  buildPauseHistogram,
  buildSpeechTimeline,
  computeOverlaps,
  computeSpeakerStats,
  computeSpeechDensity,
  computeSpeechRate,
  computeTransitions,
} from "./playerSpeakerStats";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function turn(id: number, speaker: string, startMs: number, endMs: number): EventTurnRow {
  return { id, startMs, endMs, speaker };
}

function pause(
  id: number,
  startMs: number,
  endMs: number,
  speaker: string | null = null,
): EventPauseRow {
  return { id, startMs, endMs, durMs: endMs - startMs, speaker };
}

function ipu(
  id: number,
  speaker: string,
  startMs: number,
  endMs: number,
  nWords: number,
): EventIpuRow {
  return { id, startMs, endMs, durMs: endMs - startMs, nWords, speaker };
}

// ─── computeSpeakerStats ──────────────────────────────────────────────────────

describe("computeSpeakerStats", () => {
  it("retourne tableau vide si aucune donnée", () => {
    expect(computeSpeakerStats([], [], [])).toEqual([]);
  });

  it("un seul locuteur — speechMs correct", () => {
    const turns = [turn(1, "A", 0, 2000), turn(2, "A", 3000, 5000)];
    const [stats] = computeSpeakerStats(turns, [], []);
    expect(stats.speaker).toBe("A");
    expect(stats.speechMs).toBe(4000);
  });

  it("deux locuteurs triés par speechMs décroissant", () => {
    const turns = [
      turn(1, "A", 0, 1000),
      turn(2, "B", 1000, 5000),
    ];
    const stats = computeSpeakerStats(turns, [], []);
    expect(stats[0].speaker).toBe("B");
    expect(stats[1].speaker).toBe("A");
  });

  it("speechRatio calculé sur totalDurationMs fourni", () => {
    const turns = [turn(1, "A", 0, 2000)];
    const [stats] = computeSpeakerStats(turns, [], [], 8000);
    expect(stats.speechRatio).toBeCloseTo(0.25, 5);
  });

  it("speechRatio estimé depuis la dernière fin de tour si totalDurationMs absent", () => {
    const turns = [turn(1, "A", 0, 4000)];
    const [stats] = computeSpeakerStats(turns, [], []);
    expect(stats.speechRatio).toBeCloseTo(1.0, 5);
  });

  it("nWords agrégé depuis les IPU", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const ipus = [ipu(1, "A", 0, 2000, 10), ipu(2, "A", 2500, 5000, 7)];
    const [stats] = computeSpeakerStats(turns, [], ipus);
    expect(stats.nWords).toBe(17);
    expect(stats.nIpus).toBe(2);
  });

  it("speechRateWordsPerSec = 0 si speechMs = 0", () => {
    const ipus = [ipu(1, "A", 0, 1000, 5)];
    const stats = computeSpeakerStats([], [], ipus);
    const a = stats.find((s) => s.speaker === "A");
    expect(a?.speechRateWordsPerSec).toBe(0);
  });

  it("speechRateWordsPerSec calculé correctement", () => {
    const turns = [turn(1, "A", 0, 2000)];
    const ipus = [ipu(1, "A", 0, 2000, 6)];
    const [stats] = computeSpeakerStats(turns, [], ipus);
    // 6 mots / 2 s = 3 mots/s
    expect(stats.speechRateWordsPerSec).toBeCloseTo(3.0, 5);
  });

  it("pauses attribuées au bon locuteur", () => {
    const turns = [turn(1, "A", 0, 5000), turn(2, "B", 5000, 10000)];
    const pauses = [
      pause(1, 1000, 1500, "A"),
      pause(2, 2000, 2800, "A"),
      pause(3, 6000, 6300, "B"),
    ];
    const stats = computeSpeakerStats(turns, pauses, []);
    const a = stats.find((s) => s.speaker === "A")!;
    const b = stats.find((s) => s.speaker === "B")!;
    expect(a.nPauses).toBe(2);
    expect(a.totalPauseMs).toBe(1300);
    expect(a.meanPauseDurMs).toBeCloseTo(650, 0);
    expect(b.nPauses).toBe(1);
  });

  it("meanPauseDurMs = 0 si aucune pause", () => {
    const turns = [turn(1, "A", 0, 3000)];
    const [stats] = computeSpeakerStats(turns, [], []);
    expect(stats.meanPauseDurMs).toBe(0);
    expect(stats.nPauses).toBe(0);
    expect(stats.pauseDurationsMs).toEqual([]);
  });

  it("pauses sans locuteur ignorées", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const pauses = [pause(1, 1000, 2000, null)];
    const [stats] = computeSpeakerStats(turns, pauses, []);
    expect(stats.nPauses).toBe(0);
  });

  it("locuteur apparu seulement dans les pauses est inclus", () => {
    const pauses = [pause(1, 0, 500, "C")];
    const stats = computeSpeakerStats([], pauses, []);
    expect(stats.some((s) => s.speaker === "C")).toBe(true);
  });

  it("tours négatifs (endMs < startMs) donnent speechMs = 0 pour ce tour", () => {
    const turns = [turn(1, "A", 5000, 3000)]; // endMs < startMs
    const [stats] = computeSpeakerStats(turns, [], []);
    expect(stats.speechMs).toBe(0);
  });
});

// ─── buildPauseHistogram ──────────────────────────────────────────────────────

describe("buildPauseHistogram", () => {
  it("retourne tableau vide si aucune durée", () => {
    expect(buildPauseHistogram([], 5)).toEqual([]);
  });

  it("retourne tableau vide si maxDur = 0", () => {
    expect(buildPauseHistogram([0, 0], 5)).toEqual([]);
  });

  it("nombre de bins respecté", () => {
    const hist = buildPauseHistogram([100, 200, 300, 400, 500], 5);
    expect(hist).toHaveLength(5);
  });

  it("somme des counts = nombre de durées", () => {
    const durations = [50, 150, 200, 400, 900];
    const hist = buildPauseHistogram(durations, 4);
    const total = hist.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(durations.length);
  });

  it("valeur max tombe dans le dernier bin", () => {
    const durations = [100, 200, 1000];
    const hist = buildPauseHistogram(durations, 4);
    const last = hist[hist.length - 1];
    expect(last.count).toBeGreaterThanOrEqual(1);
  });

  it("valeur unique → atterrit dans le dernier bin (Math.min clamp)", () => {
    // maxDur=500, binWidth=500/3≈166.7 → idx=Math.min(2, floor(500/166.7))=2
    const hist = buildPauseHistogram([500], 3);
    expect(hist[0].count).toBe(0);
    expect(hist[1].count).toBe(0);
    expect(hist[2].count).toBe(1);
  });

  it("binMs = centre de l'intervalle = (i+0.5)*binWidth", () => {
    // maxDur=300, nBins=1, binWidth=300 → centre = 0.5*300 = 150
    const hist = buildPauseHistogram([300], 1);
    expect(hist[0].binMs).toBeCloseTo(150, 0);
  });

  it("distribution uniforme répartie sur tous les bins", () => {
    // 4 valeurs réparties uniformément → chaque bin reçoit ~1
    const durations = [125, 375, 625, 875];
    const hist = buildPauseHistogram(durations, 4);
    for (const bin of hist) {
      expect(bin.count).toBe(1);
    }
  });
});

// ─── buildSpeechTimeline (WX-710) ────────────────────────────────────────────

describe("buildSpeechTimeline", () => {
  it("retourne tableau vide sans tours", () => {
    expect(buildSpeechTimeline([])).toEqual([]);
  });

  it("exclut les tours avec endMs <= startMs", () => {
    const turns = [turn(1, "A", 5000, 3000)];
    expect(buildSpeechTimeline(turns)).toEqual([]);
  });

  it("trie les segments chronologiquement", () => {
    const turns = [turn(1, "B", 3000, 5000), turn(2, "A", 0, 2000)];
    const tl = buildSpeechTimeline(turns);
    expect(tl[0].speaker).toBe("A");
    expect(tl[0].startMs).toBe(0);
    expect(tl[1].speaker).toBe("B");
    expect(tl[1].startMs).toBe(3000);
  });

  it("préserve tous les speakers", () => {
    const turns = [
      turn(1, "A", 0, 1000),
      turn(2, "B", 1000, 3000),
      turn(3, "A", 3000, 4000),
    ];
    const tl = buildSpeechTimeline(turns);
    expect(tl).toHaveLength(3);
    expect(tl.map((s) => s.speaker)).toEqual(["A", "B", "A"]);
  });
});

// ─── computeSpeechRate (WX-711) ──────────────────────────────────────────────

describe("computeSpeechRate", () => {
  it("retourne tableau vide sans IPU", () => {
    expect(computeSpeechRate([], 60000)).toEqual([]);
  });

  it("retourne tableau vide si totalDurationMs <= 0", () => {
    const ipus = [ipu(1, "A", 0, 2000, 10)];
    expect(computeSpeechRate(ipus, 0)).toEqual([]);
  });

  it("une série par speaker", () => {
    const ipus = [
      ipu(1, "A", 0, 10000, 30),
      ipu(2, "B", 10000, 20000, 20),
    ];
    const result = computeSpeechRate(ipus, 60000, 30000, 10000);
    expect(result).toHaveLength(2);
    const speakers = result.map((s) => s.speaker);
    expect(speakers).toContain("A");
    expect(speakers).toContain("B");
  });

  it("débit correct pour un speaker uniforme", () => {
    // 60 mots en 30s = 120 mots/min
    const ipus = [ipu(1, "A", 0, 30000, 60)];
    const result = computeSpeechRate(ipus, 30000, 30000, 5000);
    expect(result).toHaveLength(1);
    expect(result[0].points).toHaveLength(1);
    expect(result[0].points[0].wordsPerMin).toBeCloseTo(120, 0);
  });

  it("les points sont centrés sur la fenêtre", () => {
    const ipus = [ipu(1, "A", 0, 60000, 120)];
    const result = computeSpeechRate(ipus, 60000, 30000, 10000);
    expect(result[0].points[0].timeMs).toBe(15000);
    expect(result[0].points[1].timeMs).toBe(25000);
  });

  it("séries triées par débit max décroissant", () => {
    const ipus = [
      ipu(1, "A", 0, 30000, 10),
      ipu(2, "B", 0, 30000, 50),
    ];
    const result = computeSpeechRate(ipus, 30000, 30000, 5000);
    expect(result[0].speaker).toBe("B");
  });
});

// ─── computeSpeakerStats — nouveaux champs (Tier 1) ──────────────────────────

describe("computeSpeakerStats — champs étendus", () => {
  it("pauseRatio correct", () => {
    const turns = [turn(1, "A", 0, 4000)];
    const pauses = [pause(1, 1000, 2000, "A")];
    const [s] = computeSpeakerStats(turns, pauses, []);
    expect(s.pauseRatio).toBeCloseTo(1000 / (4000 + 1000), 3);
  });

  it("pausesByType ventile les pauses par type", () => {
    const turns = [turn(1, "A", 0, 10000)];
    const pauses = [
      { id: 1, startMs: 1000, endMs: 1500, durMs: 500, type: "lexical", speaker: "A" },
      { id: 2, startMs: 3000, endMs: 3800, durMs: 800, type: "lexical", speaker: "A" },
      { id: 3, startMs: 5000, endMs: 5300, durMs: 300, type: "transition_gap", speaker: "A" },
    ] as EventPauseRow[];
    const [s] = computeSpeakerStats(turns, pauses, []);
    expect(s.pausesByType["lexical"]).toEqual({ count: 2, totalMs: 1300 });
    expect(s.pausesByType["transition_gap"]).toEqual({ count: 1, totalMs: 300 });
  });

  it("durée IPU mean/min/max calculée", () => {
    const turns = [turn(1, "A", 0, 10000)];
    const ipus = [
      ipu(1, "A", 0, 2000, 5),
      ipu(2, "A", 3000, 4000, 3),
      ipu(3, "A", 5000, 8000, 8),
    ];
    const [s] = computeSpeakerStats(turns, [], ipus);
    expect(s.minIpuDurMs).toBe(1000);
    expect(s.maxIpuDurMs).toBe(3000);
    expect(s.meanIpuDurMs).toBeCloseTo(2000, 0);
  });

  it("topIpus : les 3 plus longs IPU triés par durée décroissante", () => {
    const turns = [turn(1, "A", 0, 20000)];
    const ipus = [
      { ...ipu(1, "A", 0, 1000, 2), text: "court" },
      { ...ipu(2, "A", 1000, 5000, 10), text: "moyen" },
      { ...ipu(3, "A", 5000, 12000, 20), text: "long" },
      { ...ipu(4, "A", 12000, 20000, 25), text: "tres long" },
    ] as EventIpuRow[];
    const [s] = computeSpeakerStats(turns, [], ipus);
    expect(s.topIpus).toHaveLength(3);
    expect(s.topIpus[0].text).toBe("tres long");
    expect(s.topIpus[1].text).toBe("long");
    expect(s.topIpus[2].text).toBe("moyen");
  });

  it("confiance moyenne et lowConfidencePct avec mots", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const words: EventWordRow[] = [
      { id: 1, startMs: 0, endMs: 500, speaker: "A", confidence: 0.9 },
      { id: 2, startMs: 500, endMs: 1000, speaker: "A", confidence: 0.5 },
      { id: 3, startMs: 1000, endMs: 1500, speaker: "A", confidence: 0.8 },
    ];
    const [s] = computeSpeakerStats(turns, [], [], undefined, words);
    expect(s.meanConfidence).toBeCloseTo((0.9 + 0.5 + 0.8) / 3, 3);
    expect(s.lowConfidencePct).toBeCloseTo(1 / 3, 3);
  });

  it("alignmentDist comptabilise par statut", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const words: EventWordRow[] = [
      { id: 1, startMs: 0, endMs: 500, speaker: "A", alignmentStatus: "aligned" },
      { id: 2, startMs: 500, endMs: 1000, speaker: "A", alignmentStatus: "interpolated" },
      { id: 3, startMs: 1000, endMs: 1500, speaker: "A", alignmentStatus: "aligned" },
      { id: 4, startMs: 1500, endMs: 2000, speaker: "A", alignmentStatus: null },
    ];
    const [s] = computeSpeakerStats(turns, [], [], undefined, words);
    expect(s.alignmentDist["aligned"]).toBe(3);
    expect(s.alignmentDist["interpolated"]).toBe(1);
  });

  it("sans mots, confiance et alignement sont null / vide", () => {
    const turns = [turn(1, "A", 0, 3000)];
    const [s] = computeSpeakerStats(turns, [], []);
    expect(s.meanConfidence).toBeNull();
    expect(s.lowConfidencePct).toBeNull();
    expect(s.alignmentDist).toEqual({});
  });
});

// ─── computeOverlaps ────────────────────────────────────────────────────────

describe("computeOverlaps", () => {
  it("pas d'overlap si un seul speaker", () => {
    const turns = [turn(1, "A", 0, 2000), turn(2, "A", 3000, 5000)];
    const result = computeOverlaps(turns, 5000);
    expect(result.count).toBe(0);
    expect(result.totalMs).toBe(0);
  });

  it("pas d'overlap si tours ne se chevauchent pas", () => {
    const turns = [turn(1, "A", 0, 2000), turn(2, "B", 3000, 5000)];
    const result = computeOverlaps(turns, 5000);
    expect(result.count).toBe(0);
  });

  it("détecte un overlap entre deux speakers", () => {
    const turns = [turn(1, "A", 0, 3000), turn(2, "B", 2000, 5000)];
    const result = computeOverlaps(turns, 5000);
    expect(result.count).toBe(1);
    expect(result.segments[0].startMs).toBe(2000);
    expect(result.segments[0].endMs).toBe(3000);
    expect(result.totalMs).toBe(1000);
    expect(result.ratio).toBeCloseTo(0.2, 3);
  });

  it("fusionne les overlaps adjacents", () => {
    const turns = [
      turn(1, "A", 0, 4000),
      turn(2, "B", 1000, 3000),
      turn(3, "B", 2500, 3500),
    ];
    const result = computeOverlaps(turns, 5000);
    expect(result.count).toBe(1);
    expect(result.segments[0].startMs).toBe(1000);
    expect(result.segments[0].endMs).toBe(3500);
  });

  it("ratio = 0 si totalDurationMs = 0", () => {
    const turns = [turn(1, "A", 0, 3000), turn(2, "B", 2000, 5000)];
    const result = computeOverlaps(turns, 0);
    expect(result.ratio).toBe(0);
  });
});

// ─── computeSpeakerStats — B.7 médiane + P90 pauses ─────────────────────────

describe("computeSpeakerStats — médiane et P90 pauses", () => {
  it("médiane et P90 avec plusieurs pauses", () => {
    const turns = [turn(1, "A", 0, 20000)];
    const pauses = [
      pause(1, 1000, 1100, "A"),
      pause(2, 2000, 2200, "A"),
      pause(3, 3000, 3500, "A"),
      pause(4, 4000, 4800, "A"),
      pause(5, 5000, 6500, "A"),
    ] as EventPauseRow[];
    const [s] = computeSpeakerStats(turns, pauses, []);
    expect(s.medianPauseDurMs).toBe(500);
    expect(s.p90PauseDurMs).toBeGreaterThan(s.medianPauseDurMs);
  });

  it("médiane = 0 sans pauses", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const [s] = computeSpeakerStats(turns, [], []);
    expect(s.medianPauseDurMs).toBe(0);
    expect(s.p90PauseDurMs).toBe(0);
  });
});

// ─── computeSpeakerStats — B.8 durée moyenne des tours ──────────────────────

describe("computeSpeakerStats — durée moyenne des tours", () => {
  it("calcule nTurns et meanTurnDurMs", () => {
    const turns = [
      turn(1, "A", 0, 2000),
      turn(2, "A", 3000, 5000),
      turn(3, "A", 6000, 10000),
    ];
    const [s] = computeSpeakerStats(turns, [], []);
    expect(s.nTurns).toBe(3);
    expect(s.meanTurnDurMs).toBeCloseTo((2000 + 2000 + 4000) / 3, 0);
  });
});

// ─── computeSpeakerStats — B.5 TTR diversité lexicale ───────────────────────

describe("computeSpeakerStats — TTR", () => {
  it("calcule TTR et nUniqueTokens avec words", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const words: EventWordRow[] = [
      { id: 1, startMs: 0, endMs: 500, speaker: "A", token: "bonjour" },
      { id: 2, startMs: 500, endMs: 1000, speaker: "A", token: "le" },
      { id: 3, startMs: 1000, endMs: 1500, speaker: "A", token: "monde" },
      { id: 4, startMs: 1500, endMs: 2000, speaker: "A", token: "bonjour" },
      { id: 5, startMs: 2000, endMs: 2500, speaker: "A", token: "le" },
    ];
    const [s] = computeSpeakerStats(turns, [], [], undefined, words);
    expect(s.nUniqueTokens).toBe(3);
    expect(s.ttr).toBeCloseTo(3 / 5, 3);
  });

  it("ttr null sans words", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const [s] = computeSpeakerStats(turns, [], []);
    expect(s.ttr).toBeNull();
    expect(s.nUniqueTokens).toBeNull();
  });

  it("TTR insensible à la casse", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const words: EventWordRow[] = [
      { id: 1, startMs: 0, endMs: 500, speaker: "A", token: "Bonjour" },
      { id: 2, startMs: 500, endMs: 1000, speaker: "A", token: "bonjour" },
    ];
    const [s] = computeSpeakerStats(turns, [], [], undefined, words);
    expect(s.nUniqueTokens).toBe(1);
    expect(s.ttr).toBeCloseTo(0.5, 3);
  });
});

// ─── computeTransitions ─────────────────────────────────────────────────────

describe("computeTransitions", () => {
  it("pas de transitions avec un seul speaker", () => {
    const turns = [turn(1, "A", 0, 2000), turn(2, "A", 3000, 5000)];
    expect(computeTransitions(turns)).toEqual([]);
  });

  it("calcule le gap entre tours de speakers différents", () => {
    const turns = [
      turn(1, "A", 0, 2000),
      turn(2, "B", 3000, 5000),
    ];
    const result = computeTransitions(turns);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe("A");
    expect(result[0].to).toBe("B");
    expect(result[0].medianGapMs).toBe(1000);
    expect(result[0].count).toBe(1);
  });

  it("détecte un overlap (gap négatif)", () => {
    const turns = [
      turn(1, "A", 0, 3000),
      turn(2, "B", 2000, 5000),
    ];
    const result = computeTransitions(turns);
    expect(result[0].medianGapMs).toBe(-1000);
  });

  it("agrège plusieurs transitions A→B", () => {
    const turns = [
      turn(1, "A", 0, 1000),
      turn(2, "B", 1500, 2500),
      turn(3, "A", 3000, 4000),
      turn(4, "B", 4200, 5000),
    ];
    const result = computeTransitions(turns);
    const ab = result.find((r) => r.from === "A" && r.to === "B");
    expect(ab).toBeDefined();
    expect(ab!.count).toBe(2);
    expect(ab!.medianGapMs).toBe(350);
  });

  it("trié par count décroissant", () => {
    const turns = [
      turn(1, "A", 0, 1000),
      turn(2, "B", 1000, 2000),
      turn(3, "A", 2000, 3000),
      turn(4, "B", 3000, 4000),
      turn(5, "A", 4000, 5000),
      turn(6, "C", 5000, 6000),
    ];
    const result = computeTransitions(turns);
    expect(result[0].count).toBeGreaterThanOrEqual(result[result.length - 1].count);
  });
});

// ─── computeSpeechDensity ───────────────────────────────────────────────────

describe("computeSpeechDensity", () => {
  it("retourne vide sans tours", () => {
    expect(computeSpeechDensity([], 10000)).toEqual([]);
  });

  it("retourne vide si durée <= 0", () => {
    expect(computeSpeechDensity([turn(1, "A", 0, 5000)], 0)).toEqual([]);
  });

  it("densité = 1 quand parole continue sur toute la fenêtre", () => {
    const turns = [turn(1, "A", 0, 60000)];
    const points = computeSpeechDensity(turns, 60000, 30000, 10000);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.density).toBeCloseTo(1, 1);
    }
  });

  it("densité entre 0 et 1 quand parole partielle", () => {
    const turns = [turn(1, "A", 0, 15000)];
    const points = computeSpeechDensity(turns, 60000, 30000, 10000);
    expect(points[0].density).toBe(0.5);
    expect(points[1].density).toBeLessThan(0.5);
  });

  it("les points sont centrés sur la fenêtre", () => {
    const turns = [turn(1, "A", 0, 60000)];
    const points = computeSpeechDensity(turns, 60000, 30000, 10000);
    expect(points[0].timeMs).toBe(15000);
  });
});

// ─── buildFullStatsExport / buildFullStatsCsv ───────────────────────────────

describe("buildFullStatsExport", () => {
  it("produit un objet complet avec toutes les sections", () => {
    const turns = [turn(1, "A", 0, 5000), turn(2, "B", 5500, 10000)];
    const pauses = [pause(1, 5000, 5500, "A")] as EventPauseRow[];
    const ipus = [ipu(1, "A", 0, 5000, 10), ipu(2, "B", 5500, 10000, 15)];
    const words: EventWordRow[] = [
      { id: 1, startMs: 0, endMs: 500, speaker: "A", token: "test", confidence: 0.9, alignmentStatus: "aligned" },
    ];

    const stats = computeSpeakerStats(turns, pauses, ipus, 10000, words);
    const overlaps = computeOverlaps(turns, 10000);
    const transitions = computeTransitions(turns);
    const density = computeSpeechDensity(turns, 10000);
    const rate = computeSpeechRate(ipus, 10000);

    const result = buildFullStatsExport(
      stats, overlaps, transitions, density, rate, 85,
      10000, 9500, 25,
      turns, pauses, ipus, words,
    );

    expect(result.meta.duration_ms).toBe(10000);
    expect(result.meta.n_speakers).toBe(2);
    expect(result.meta.n_words).toBe(25);
    expect(result.quality.score).toBe(85);
    expect(result.per_speaker).toHaveLength(2);
    expect(result.raw_data.turns).toHaveLength(2);
    expect(result.raw_data.pauses).toHaveLength(1);
    expect(result.raw_data.ipus).toHaveLength(2);
    expect(result.raw_data.words).toHaveLength(1);
    expect(result.per_speaker[0].pauses.by_type).toBeDefined();
  });
});

describe("buildFullStatsCsv", () => {
  it("produit un CSV multi-sections non vide", () => {
    const turns = [turn(1, "A", 0, 5000)];
    const pauses = [pause(1, 2000, 2500, "A")] as EventPauseRow[];
    const ipus = [ipu(1, "A", 0, 5000, 10)];

    const stats = computeSpeakerStats(turns, pauses, ipus, 5000);
    const overlaps = computeOverlaps(turns, 5000);
    const transitions = computeTransitions(turns);
    const density = computeSpeechDensity(turns, 5000);
    const rate = computeSpeechRate(ipus, 5000);

    const fullExport = buildFullStatsExport(
      stats, overlaps, transitions, density, rate, null,
      5000, 5000, 10,
      turns, pauses, ipus, [],
    );
    const csv = buildFullStatsCsv(fullExport);

    expect(csv).toContain("# META");
    expect(csv).toContain("# PER_SPEAKER");
    expect(csv).toContain("# PAUSES_BY_TYPE");
    expect(csv).toContain("# RAW_TURNS");
    expect(csv).toContain("# RAW_PAUSES");
    expect(csv).toContain("# RAW_IPUS");
    expect(csv).toContain("# RAW_WORDS");
    expect(csv).toContain("# TRANSITIONS");
    expect(csv).toContain("# OVERLAP_SEGMENTS");
    expect(csv.split("\n").length).toBeGreaterThan(30);
  });
});
