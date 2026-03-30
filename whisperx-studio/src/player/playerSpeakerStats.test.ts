import { describe, expect, it } from "vitest";
import type { EventIpuRow, EventPauseRow, EventTurnRow } from "../types";
import { buildPauseHistogram, computeSpeakerStats } from "./playerSpeakerStats";

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
