import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ExportCorrectionReport, ExportTimingRules } from "../../types";
import {
  tauriExportTranscript,
  tauriLoadTranscriptDocument,
  tauriLoadTranscriptDraft,
  tauriSaveTranscriptJson,
} from "./transcriptEditorTauri";

const emptyReport = (): ExportCorrectionReport => ({
  inputSegments: 0,
  outputSegments: 0,
  minDurationSec: 0,
  minGapSec: 0,
  fixOverlaps: false,
  reorderedSegments: false,
  overlapsFixed: 0,
  minGapAdjustments: 0,
  minDurationAdjustments: 0,
  totalAdjustments: 0,
  notes: [],
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("transcriptEditorTauri", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("tauriLoadTranscriptDocument appelle la commande attendue", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: "/t.json", language: null, segments: [] });
    await tauriLoadTranscriptDocument("/t.json");
    expect(vi.mocked(invoke).mock.calls[0]?.[0]).toBe("load_transcript_document");
    expect(vi.mocked(invoke).mock.calls[0]?.[1]).toEqual({ path: "/t.json" });
  });

  it("tauriLoadTranscriptDraft passe le chemin document", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await tauriLoadTranscriptDraft("/run/x.json");
    expect(vi.mocked(invoke).mock.calls[0]?.[0]).toBe("load_transcript_draft");
    expect(vi.mocked(invoke).mock.calls[0]?.[1]).toEqual({ path: "/run/x.json" });
  });

  it("tauriSaveTranscriptJson enveloppe request", async () => {
    vi.mocked(invoke).mockResolvedValue("/out.json");
    await tauriSaveTranscriptJson({
      path: "/src.json",
      language: "fr",
      segments: [],
      overwrite: false,
    });
    expect(vi.mocked(invoke).mock.calls[0]?.[0]).toBe("save_transcript_json");
    expect(vi.mocked(invoke).mock.calls[0]?.[1]).toEqual({
      request: {
        path: "/src.json",
        language: "fr",
        segments: [],
        overwrite: false,
      },
    });
  });

  it("tauriExportTranscript enveloppe request", async () => {
    vi.mocked(invoke).mockResolvedValue({
      outputPath: "/o.srt",
      report: emptyReport(),
    });
    const rules: ExportTimingRules = {
      minDurationSec: 0.2,
      minGapSec: 0.05,
      fixOverlaps: true,
    };
    await tauriExportTranscript({
      path: "/src.json",
      language: null,
      segments: [],
      format: "srt",
      rules,
    });
    expect(vi.mocked(invoke).mock.calls[0]?.[0]).toBe("export_transcript");
    expect(vi.mocked(invoke).mock.calls[0]?.[1]).toEqual({
      request: {
        path: "/src.json",
        language: null,
        segments: [],
        format: "srt",
        rules,
      },
    });
  });
});
