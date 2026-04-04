import { describe, expect, it } from "vitest";
import {
  hasTranscriptSourcePath,
  isTranscriptEditorReadyForIo,
  runWithEditorSavingFlag,
  TRANSCRIPT_EDITOR_NOT_LOADED_ERROR,
} from "./transcriptEditorIoHelpers";

describe("transcriptEditorIoHelpers", () => {
  it("TRANSCRIPT_EDITOR_NOT_LOADED_ERROR est stable", () => {
    expect(TRANSCRIPT_EDITOR_NOT_LOADED_ERROR.length).toBeGreaterThan(10);
  });

  it("hasTranscriptSourcePath exige un chemin non vide", () => {
    expect(hasTranscriptSourcePath("")).toBe(false);
    expect(hasTranscriptSourcePath("  ")).toBe(false);
    expect(hasTranscriptSourcePath("/run/x.json")).toBe(true);
  });

  it("isTranscriptEditorReadyForIo exige chemin et au moins un segment (export / pack)", () => {
    expect(isTranscriptEditorReadyForIo("", 1)).toBe(false);
    expect(isTranscriptEditorReadyForIo("/a.json", 0)).toBe(false);
    expect(isTranscriptEditorReadyForIo("/a.json", 2)).toBe(true);
  });

  it("runWithEditorSavingFlag bascule isSaving", async () => {
    const flags: boolean[] = [];
    const setSaving = (v: boolean) => {
      flags.push(v);
    };
    const result = await runWithEditorSavingFlag(setSaving, async () => 42);
    expect(result).toBe(42);
    expect(flags).toEqual([true, false]);
  });
});
