import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ExportCorrectionReport, ExportTimingRules } from "../../types";
import { exportTimingPackSequential } from "./transcriptEditorExportSequences";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

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

describe("exportTimingPackSequential", () => {
  it("enchaîne json, srt, vtt, csv", async () => {
    let n = 0;
    vi.mocked(invoke).mockImplementation(async () => {
      n += 1;
      return { outputPath: `/out-${n}.x`, report: emptyReport() };
    });

    const rules: ExportTimingRules = { minDurationSec: 0.1, minGapSec: 0.05, fixOverlaps: true };
    const r = await exportTimingPackSequential({
      path: "/src.json",
      language: null,
      segments: [],
      rules,
    });

    expect(n).toBe(4);
    expect(r.lastPath).toBe("/out-4.x");
    expect(vi.mocked(invoke).mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ format: "json" }) }),
      expect.objectContaining({ request: expect.objectContaining({ format: "srt" }) }),
      expect.objectContaining({ request: expect.objectContaining({ format: "vtt" }) }),
      expect.objectContaining({ request: expect.objectContaining({ format: "csv" }) }),
    ]);
  });
});
