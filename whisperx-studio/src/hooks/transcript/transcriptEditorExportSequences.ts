import type { EditableSegment, ExportCorrectionReport, ExportTimingRules } from "../../types";
import { tauriExportTranscript } from "./transcriptEditorTauri";

const TIMING_PACK_FORMATS = ["json", "srt", "csv"] as const;

/**
 * Enchaîne JSON + SRT + CSV (même règles) pour le pack timing éditeur.
 */
export async function exportTimingPackSequential(params: {
  path: string;
  language: string | null;
  segments: EditableSegment[];
  rules: ExportTimingRules;
}): Promise<{ lastPath: string; lastReport: ExportCorrectionReport }> {
  let lastPath = "";
  let lastReport: ExportCorrectionReport | undefined;
  for (const format of TIMING_PACK_FORMATS) {
    const result = await tauriExportTranscript({
      path: params.path,
      language: params.language,
      segments: params.segments,
      format,
      rules: params.rules,
    });
    lastPath = result.outputPath;
    lastReport = result.report;
  }
  if (!lastReport) {
    throw new Error("export_timing_pack: aucun rapport");
  }
  return { lastPath, lastReport };
}
