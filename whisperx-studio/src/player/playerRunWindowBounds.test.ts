import { describe, expect, it } from "vitest";
import {
  computePlayerWindowQueryBounds,
  PLAYER_WINDOW_QUERY_BUFFER_MS,
  PLAYER_WINDOW_TOTAL_MS,
  PLAYER_WINDOW_WORDS_MS,
} from "./playerRunWindowBounds";

describe("computePlayerWindowQueryBounds", () => {
  it("standard : 60s + buffer des deux côtés", () => {
    const center = 60_000;
    const half = PLAYER_WINDOW_TOTAL_MS / 2;
    const b = PLAYER_WINDOW_QUERY_BUFFER_MS;
    const { t0Ms, t1Ms } = computePlayerWindowQueryBounds(center, "standard");
    expect(t0Ms).toBe(center - half - b);
    expect(t1Ms).toBe(center + half + b);
  });

  it("words_detail : 30s + buffer", () => {
    const center = 15_000;
    const half = PLAYER_WINDOW_WORDS_MS / 2;
    const b = PLAYER_WINDOW_QUERY_BUFFER_MS;
    const { t0Ms, t1Ms } = computePlayerWindowQueryBounds(center, "words_detail");
    expect(t0Ms).toBe(Math.max(0, center - half - b));
    expect(t1Ms).toBe(center + half + b);
  });

  it("borde t0 à 0 si négatif", () => {
    const { t0Ms } = computePlayerWindowQueryBounds(1000, "standard");
    expect(t0Ms).toBe(0);
  });
});
