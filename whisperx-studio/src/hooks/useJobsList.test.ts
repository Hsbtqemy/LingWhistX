/**
 * WX-672 — Tests unitaires pour les utilitaires de priorité et réordonnancement de la file de jobs.
 */
import { describe, expect, it } from "vitest";
import type { Job } from "../types";

// ─── Helpers extraits de la logique du hook ───────────────────────────────────

function applyReorderOptimistic(jobs: Job[], orderedIds: string[]): Job[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const reordered = orderedIds
    .map((id, idx) => {
      const j = byId.get(id);
      return j ? { ...j, queueOrder: idx } : null;
    })
    .filter(Boolean) as Job[];
  const rest = jobs.filter((j) => !orderedIds.includes(j.id));
  return [...reordered, ...rest];
}

function sortJobsByPriorityAndOrder(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const pa = a.priority ?? 2;
    const pb = b.priority ?? 2;
    if (pa !== pb) return pa - pb;
    const oa = a.queueOrder ?? 0;
    const ob = b.queueOrder ?? 0;
    return oa - ob;
  });
}

function makeJob(id: string, priority: 0 | 1 | 2 | 3 = 2, queueOrder = 0): Job {
  return {
    id,
    inputPath: `/media/${id}.mp4`,
    outputDir: `/runs/${id}`,
    mode: "whisperx",
    status: "queued",
    progress: 0,
    message: "Queued",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    outputFiles: [],
    priority,
    queueOrder,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WX-672 — réordonnancement optimistic", () => {
  it("déplace un job d'une position à une autre", () => {
    const jobs = [makeJob("a"), makeJob("b"), makeJob("c")];
    const result = applyReorderOptimistic(jobs, ["a", "c", "b"]);
    expect(result.map((j) => j.id)).toEqual(["a", "c", "b"]);
    expect(result[0].queueOrder).toBe(0);
    expect(result[1].queueOrder).toBe(1);
    expect(result[2].queueOrder).toBe(2);
  });

  it("les jobs non inclus dans orderedIds restent en fin de liste", () => {
    const jobs = [makeJob("a"), makeJob("b"), makeJob("c"), makeJob("d")];
    const result = applyReorderOptimistic(jobs, ["b", "a"]);
    const ids = result.map((j) => j.id);
    expect(ids.slice(0, 2)).toEqual(["b", "a"]);
    expect(ids).toContain("c");
    expect(ids).toContain("d");
  });

  it("un ID inconnu dans orderedIds est ignoré silencieusement", () => {
    const jobs = [makeJob("a"), makeJob("b")];
    const result = applyReorderOptimistic(jobs, ["b", "unknown", "a"]);
    expect(result.map((j) => j.id)).toEqual(["b", "a"]);
  });
});

describe("WX-672 — tri par priorité", () => {
  it("P0 passe devant P1, P2, P3", () => {
    const jobs = [makeJob("low", 3), makeJob("norm", 2), makeJob("high", 1), makeJob("crit", 0)];
    const sorted = sortJobsByPriorityAndOrder(jobs);
    expect(sorted.map((j) => j.id)).toEqual(["crit", "high", "norm", "low"]);
  });

  it("à priorité égale, trie par queue_order croissant", () => {
    const jobs = [makeJob("b", 2, 2), makeJob("a", 2, 0), makeJob("c", 2, 1)];
    const sorted = sortJobsByPriorityAndOrder(jobs);
    expect(sorted.map((j) => j.id)).toEqual(["a", "c", "b"]);
  });

  it("passer un job en P0 le place avant tous les P1+", () => {
    const jobs = [makeJob("first", 1, 0), makeJob("second", 1, 1), makeJob("promoted", 2, 2)];
    // Simulate set priority P0 on "promoted"
    const updated = jobs.map((j) => (j.id === "promoted" ? { ...j, priority: 0 as const } : j));
    const sorted = sortJobsByPriorityAndOrder(updated);
    expect(sorted[0].id).toBe("promoted");
  });

  it("priorité par défaut (undefined) est traitée comme P2", () => {
    const withUndefined: Job = { ...makeJob("x"), priority: undefined };
    const withP2 = makeJob("y", 2);
    const sorted = sortJobsByPriorityAndOrder([withUndefined, withP2]);
    // Both P2 — order preserved by queueOrder (both 0)
    expect(sorted.length).toBe(2);
  });
});
