import { describe, expect, it } from "vitest";
import type { EditableSegment } from "../../types";
import { relativeSegmentIndex } from "./transcriptEditorNavigation";

const s = (a: number, b: number): EditableSegment => ({ start: a, end: b, text: "x" });

describe("transcriptEditorNavigation", () => {
  it("retourne null si aucun segment", () => {
    expect(relativeSegmentIndex([], null, 0, 1)).toBeNull();
  });

  it("navigue avec delta", () => {
    const segments = [s(0, 1), s(1, 2), s(2, 3)];
    expect(relativeSegmentIndex(segments, 1, 0.5, 1)).toBe(2);
    expect(relativeSegmentIndex(segments, 1, 0.5, -1)).toBe(0);
  });
});
