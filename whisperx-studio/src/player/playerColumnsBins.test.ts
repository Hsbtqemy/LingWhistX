import { describe, expect, it } from "vitest";
import type { EventTurnRow } from "../types";
import {
  buildTimeBins,
  turnOverlapsBin,
  turnsForSpeakerInBin,
  uniqueSpeakersFromTurns,
} from "./playerColumnsBins";

describe("buildTimeBins", () => {
  it("60s fenêtre / pas 2s → ~30 bins", () => {
    const bins = buildTimeBins(0, 60_000, 2);
    expect(bins.length).toBe(30);
    expect(bins[0]).toEqual({ startMs: 0, endMs: 2000 });
    expect(bins[29]).toEqual({ startMs: 58_000, endMs: 60_000 });
  });

  it("aligne le premier bin sur t0 non multiple", () => {
    const bins = buildTimeBins(1500, 6500, 1);
    expect(bins[0].startMs).toBe(1000);
    expect(bins[bins.length - 1]?.endMs).toBe(6500);
  });
});

describe("turnOverlapsBin", () => {
  const t = (a: number, b: number): EventTurnRow => ({
    id: 1,
    startMs: a,
    endMs: b,
    speaker: "A",
  });

  it("chevauchement partiel", () => {
    expect(turnOverlapsBin(t(1000, 3000), 2000, 4000)).toBe(true);
  });

  it("pas de chevauchement", () => {
    expect(turnOverlapsBin(t(1000, 2000), 5000, 6000)).toBe(false);
  });
});

describe("turnsForSpeakerInBin", () => {
  const turns: EventTurnRow[] = [
    { id: 1, startMs: 500, endMs: 2500, speaker: "A" },
    { id: 2, startMs: 1000, endMs: 4000, speaker: "B" },
  ];

  it("filtre locuteur + bin", () => {
    const a = turnsForSpeakerInBin(turns, "A", 0, 2000);
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe(1);
  });
});

describe("uniqueSpeakersFromTurns", () => {
  it("tri et déduplication", () => {
    expect(
      uniqueSpeakersFromTurns([
        { id: 1, startMs: 0, endMs: 1, speaker: "Z" },
        { id: 2, startMs: 0, endMs: 1, speaker: "A" },
        { id: 3, startMs: 0, endMs: 1, speaker: "A" },
      ]),
    ).toEqual(["A", "Z"]);
  });
});
