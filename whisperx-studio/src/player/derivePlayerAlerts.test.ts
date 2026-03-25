import { describe, expect, it } from "vitest";
import type { QueryWindowResult } from "../types";
import { derivePlayerAlerts } from "./derivePlayerAlerts";

function sliceStub(
  partial: Partial<QueryWindowResult> & Pick<QueryWindowResult, "turns" | "pauses">,
): QueryWindowResult {
  return {
    runDir: "/tmp/run",
    t0Ms: 0,
    t1Ms: 60_000,
    words: [],
    ipus: [],
    truncated: { words: false, turns: false, pauses: false, ipus: false },
    ...partial,
  };
}

describe("derivePlayerAlerts", () => {
  it("détecte un chevauchement entre deux tours consécutifs (tri par startMs)", () => {
    const s = sliceStub({
      turns: [
        { id: 1, startMs: 1000, endMs: 5000, speaker: "A" },
        { id: 2, startMs: 4000, endMs: 8000, speaker: "B" },
      ],
      pauses: [],
    });
    const a = derivePlayerAlerts(s);
    expect(a.some((x) => x.kind === "overlap_turn")).toBe(true);
    expect(a.find((x) => x.kind === "overlap_turn")?.startMs).toBe(4000);
  });

  it("ignore l’ordre initial des tours (tri interne)", () => {
    const s = sliceStub({
      turns: [
        { id: 2, startMs: 4000, endMs: 8000, speaker: "B" },
        { id: 1, startMs: 1000, endMs: 5000, speaker: "A" },
      ],
      pauses: [],
    });
    expect(derivePlayerAlerts(s).some((x) => x.kind === "overlap_turn")).toBe(true);
  });

  it("signale une pause longue ≥ 3 s", () => {
    const s = sliceStub({
      turns: [],
      pauses: [{ id: 1, startMs: 0, endMs: 5000, durMs: 5000 }],
    });
    const a = derivePlayerAlerts(s);
    expect(a.some((x) => x.kind === "long_pause")).toBe(true);
  });

  it("ne signale pas une pause courte", () => {
    const s = sliceStub({
      turns: [],
      pauses: [{ id: 1, startMs: 0, endMs: 2000, durMs: 2000 }],
    });
    expect(derivePlayerAlerts(s).every((x) => x.kind !== "long_pause")).toBe(true);
  });
});
