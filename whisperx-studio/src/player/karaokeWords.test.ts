import { describe, expect, it } from "vitest";
import type { EventWordRow } from "../types";
import { findActiveWordIndex, isWordAligned, karaokeVisibleRange } from "./karaokeWords";

function w(id: number, startMs: number, endMs: number, speaker = "A"): EventWordRow {
  return { id, startMs, endMs, speaker, token: `t${id}` };
}

describe("findActiveWordIndex", () => {
  it("retourne -1 si aucun mot", () => {
    expect(findActiveWordIndex([], 1000)).toBe(-1);
  });

  it("retourne l’index du mot contenant la tête", () => {
    const words = [w(1, 0, 500), w(2, 500, 1000)];
    expect(findActiveWordIndex(words, 100)).toBe(0);
    expect(findActiveWordIndex(words, 700)).toBe(1);
  });

  it("dans un silence entre deux mots, retourne le dernier mot commencé", () => {
    const words = [w(1, 0, 500), w(2, 800, 1200)];
    expect(findActiveWordIndex(words, 600)).toBe(0);
  });

  it("avant le premier mot, retourne -1", () => {
    const words = [w(1, 1000, 2000)];
    expect(findActiveWordIndex(words, 100)).toBe(-1);
  });

  it("après le dernier mot, retourne le dernier index", () => {
    const words = [w(1, 0, 500), w(2, 500, 1000)];
    expect(findActiveWordIndex(words, 5000)).toBe(1);
  });
});

describe("karaokeVisibleRange", () => {
  it("fenêtre vide si len 0", () => {
    expect(karaokeVisibleRange(0, 0, 40)).toEqual({ from: 0, to: 0 });
  });

  it("centre sur activeIdx avec rayon", () => {
    expect(karaokeVisibleRange(100, 50, 5)).toEqual({ from: 45, to: 56 });
  });

  it("borne au début / fin", () => {
    expect(karaokeVisibleRange(10, 2, 40)).toEqual({ from: 0, to: 10 });
    expect(karaokeVisibleRange(10, 8, 40)).toEqual({ from: 0, to: 10 });
  });

  it("activeIdx -1 centre sur 0", () => {
    expect(karaokeVisibleRange(20, -1, 5)).toEqual({ from: 0, to: 6 });
  });
});

describe("isWordAligned (WX-668)", () => {
  function word(alignmentStatus?: string | null): EventWordRow {
    return { id: 1, startMs: 0, endMs: 100, speaker: "A", token: "t", alignmentStatus };
  }

  it("retourne true si alignmentStatus absent", () => {
    expect(isWordAligned(word(undefined))).toBe(true);
  });

  it("retourne true si alignmentStatus null", () => {
    expect(isWordAligned(word(null))).toBe(true);
  });

  it("retourne true si alignmentStatus = 'aligned'", () => {
    expect(isWordAligned(word("aligned"))).toBe(true);
  });

  it("retourne false si alignmentStatus = 'failed'", () => {
    expect(isWordAligned(word("failed"))).toBe(false);
  });

  it("retourne false si alignmentStatus = 'interpolated'", () => {
    expect(isWordAligned(word("interpolated"))).toBe(false);
  });
});
