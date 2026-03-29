import { describe, expect, it } from "vitest";
import { computeEditorDirtyFromBaseline } from "./computeEditorDirty";
import type { EditorSnapshot } from "../../types";

const empty: EditorSnapshot = { language: "", segments: [] };

describe("computeEditorDirtyFromBaseline", () => {
  it("sans baseline : dirty si langue ou segments", () => {
    expect(computeEditorDirtyFromBaseline(empty, null)).toBe(false);
    expect(computeEditorDirtyFromBaseline({ language: "fr", segments: [] }, null)).toBe(true);
    expect(
      computeEditorDirtyFromBaseline(
        { language: "", segments: [{ start: 0, end: 1, text: "a", speaker: null }] },
        null,
      ),
    ).toBe(true);
  });

  it("avec baseline : dirty si différent", () => {
    const b: EditorSnapshot = { language: "fr", segments: [] };
    expect(computeEditorDirtyFromBaseline(b, b)).toBe(false);
    expect(computeEditorDirtyFromBaseline({ language: "en", segments: [] }, b)).toBe(true);
  });
});
