import { describe, expect, it } from "vitest";
import { buildEditorSnapshot } from "../../appUtils";
import type { EditableSegment } from "../../types";
import { mutateSegmentText, resizeSegmentBoundaryInSnapshot } from "./transcriptSegmentMutations";

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
});
