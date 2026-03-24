import { describe, expect, it } from "vitest";
import type { EditableSegment } from "../../types";
import {
  buildSplitPair,
  computeSplitAtCursor,
  mergeTwoEditableSegments,
} from "./transcriptEditorSplitMerge";

const seg = (start: number, end: number, text = "ab"): EditableSegment => ({ start, end, text });

describe("transcriptEditorSplitMerge", () => {
  it("computeSplitAtCursor refuse un segment trop court", () => {
    const s = seg(0, 0.03);
    const r = computeSplitAtCursor(s, 0.015, (x) => x);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("segment_too_short");
    }
  });

  it("computeSplitAtCursor accepte un split valide", () => {
    const s = seg(0, 10);
    const r = computeSplitAtCursor(s, 5, (x) => x);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.splitAt).toBeGreaterThan(s.start);
      expect(r.splitAt).toBeLessThan(s.end);
    }
  });

  it("buildSplitPair duplique le texte coupé", () => {
    const s = seg(0, 2, "hello world");
    const [left, right] = buildSplitPair(s, 1);
    expect(left.end).toBe(1);
    expect(right.start).toBe(1);
    expect(left.text.length + right.text.length).toBeGreaterThan(0);
  });

  it("mergeTwoEditableSegments fusionne bornes et texte", () => {
    const m = mergeTwoEditableSegments(seg(0, 1, "a"), seg(1, 2, "b"));
    expect(m.start).toBe(0);
    expect(m.end).toBe(2);
    expect(m.text).toContain("a");
  });
});
