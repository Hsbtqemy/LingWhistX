import { describe, expect, it } from "vitest";
import { buildEditorSnapshot } from "../../appUtils";
import type { EditableSegment } from "../../types";
import {
  createSegmentFromRangeInSnapshot,
  mutateSegmentText,
  resizeSegmentBoundaryInSnapshot,
} from "./transcriptSegmentMutations";

const seg = (start: number, end: number, text = "x"): EditableSegment => ({ start, end, text });

describe("transcriptSegmentMutations", () => {
  it("resizeSegmentBoundaryInSnapshot ajuste le bord sans React", () => {
    const current = buildEditorSnapshot("fr", [seg(0, 5)]);
    const next = resizeSegmentBoundaryInSnapshot(
      current,
      0,
      "end",
      4.2,
      100,
      (s) => Math.round(s * 1000) / 1000,
    );
    expect(next.segments[0]?.end).toBeLessThanOrEqual(5);
    expect(next.segments[0]?.end).toBeGreaterThanOrEqual(next.segments[0]!.start + 0.05);
  });

  it("mutateSegmentText remplace le texte", () => {
    const current = buildEditorSnapshot("fr", [seg(0, 1, "a")]);
    const next = mutateSegmentText(current, 0, "b");
    expect(next.segments[0]?.text).toBe("b");
  });

  it("createSegmentFromRangeInSnapshot crée un segment à partir d'une plage", () => {
    const current = buildEditorSnapshot("fr", [seg(0, 2), seg(5, 8)]);
    const result = createSegmentFromRangeInSnapshot(current, 3, 4.5, 10);
    expect(result).not.toBeNull();
    expect(result!.insertedIndex).toBe(1);
    expect(result!.segment.start).toBeCloseTo(3, 2);
    expect(result!.segment.end).toBeCloseTo(4.5, 2);
    expect(result!.segment.text).toBe("");
    expect(result!.snapshot.segments).toHaveLength(3);
  });

  it("createSegmentFromRangeInSnapshot clamp pour éviter les chevauchements", () => {
    const current = buildEditorSnapshot("fr", [seg(0, 3), seg(5, 8)]);
    const result = createSegmentFromRangeInSnapshot(current, 2, 6, 10);
    expect(result).not.toBeNull();
    expect(result!.segment.start).toBeGreaterThanOrEqual(3);
    expect(result!.segment.end).toBeLessThanOrEqual(5);
  });

  it("createSegmentFromRangeInSnapshot retourne null si plage trop courte", () => {
    const current = buildEditorSnapshot("fr", [seg(0, 5)]);
    const result = createSegmentFromRangeInSnapshot(current, 2, 2.001, 10);
    expect(result).toBeNull();
  });
});
