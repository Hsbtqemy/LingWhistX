/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadTranscriptFromPath } from "./transcriptEditorLoad";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("loadTranscriptFromPath", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("retourne le document sans brouillon", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "load_transcript_document") {
        return { path: "/t.json", language: "fr", segments: [{ start: 0, end: 1, text: "a" }] };
      }
      if (cmd === "load_transcript_draft") {
        return null;
      }
      throw new Error(`unexpected ${cmd}`);
    });

    const r = await loadTranscriptFromPath("/t.json");
    expect(r.docPath).toBe("/t.json");
    expect(r.draftOnDisk).toBeNull();
    expect(r.recoveredFromDraft).toBe(false);
    expect(r.loadedSnapshot.segments).toHaveLength(1);
  });
});
