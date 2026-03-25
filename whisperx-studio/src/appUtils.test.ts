import { describe, expect, it } from "vitest";
import { defaultWhisperxOptions } from "./constants";
import {
  clampNumber,
  fileBasename,
  formatTimestamp,
  parsePlayerTimecodeToSeconds,
  normalizeWhisperxOptions,
  parseAudioPipelineModulesFromUi,
  parseAudioPipelineSegmentsFromUi,
  parseFiniteNumberInput,
  pathsEqualNormalized,
  upsertJobInList,
} from "./appUtils";
import type { Job } from "./types";

describe("clampNumber", () => {
  it("borne la valeur entre min et max", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(99, 0, 10)).toBe(10);
  });
});

describe("fileBasename", () => {
  it("retourne le dernier segment unix ou windows", () => {
    expect(fileBasename("/a/b/c.wav")).toBe("c.wav");
    expect(fileBasename("C:\\foo\\bar.mp3")).toBe("bar.mp3");
    expect(fileBasename("solo")).toBe("solo");
  });
});

describe("parsePlayerTimecodeToSeconds", () => {
  it("parse secondes seules et décimales", () => {
    expect(parsePlayerTimecodeToSeconds("0")).toBe(0);
    expect(parsePlayerTimecodeToSeconds("42.5")).toBe(42.5);
    expect(parsePlayerTimecodeToSeconds("1,25")).toBe(1.25);
  });

  it("parse mm:ss", () => {
    expect(parsePlayerTimecodeToSeconds("1:30")).toBe(90);
    expect(parsePlayerTimecodeToSeconds("0:00.5")).toBe(0.5);
  });

  it("parse hh:mm:ss", () => {
    expect(parsePlayerTimecodeToSeconds("1:01:01")).toBe(3661);
  });

  it("retourne null si invalide", () => {
    expect(parsePlayerTimecodeToSeconds("")).toBeNull();
    expect(parsePlayerTimecodeToSeconds("  ")).toBeNull();
    expect(parsePlayerTimecodeToSeconds("abc")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("accepte 0 ms (epoch) sans retourner « - »", () => {
    expect(formatTimestamp(0)).not.toBe("-");
    expect(formatTimestamp(0)).toMatch(/\d/);
  });

  it("retourne « - » pour NaN / Infinity", () => {
    expect(formatTimestamp(Number.NaN)).toBe("-");
    expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("parseFiniteNumberInput", () => {
  it("retourne null pour chaîne vide ou blanche", () => {
    expect(parseFiniteNumberInput("")).toBeNull();
    expect(parseFiniteNumberInput("   ")).toBeNull();
  });

  it("parse un nombre fini", () => {
    expect(parseFiniteNumberInput("3.5")).toBe(3.5);
    expect(parseFiniteNumberInput("-2")).toBe(-2);
  });

  it("retourne null si non fini", () => {
    expect(parseFiniteNumberInput("nan")).toBeNull();
    expect(parseFiniteNumberInput("1e400")).toBeNull();
  });
});

function jobStub(partial: Partial<Job> & Pick<Job, "id" | "createdAtMs">): Job {
  return {
    inputPath: "",
    outputDir: "",
    mode: "mock",
    status: "done",
    progress: 100,
    message: "",
    updatedAtMs: partial.createdAtMs,
    outputFiles: [],
    ...partial,
  };
}

describe("pathsEqualNormalized", () => {
  it("ignore trailing slashes", () => {
    expect(pathsEqualNormalized("/tmp/run", "/tmp/run/")).toBe(true);
  });

  it("distingue deux dossiers", () => {
    expect(pathsEqualNormalized("/tmp/a", "/tmp/b")).toBe(false);
  });
});

describe("normalizeWhisperxOptions", () => {
  it("par défaut : WX-605/606 absents (undefined) sauf champs toujours envoyés", () => {
    const out = normalizeWhisperxOptions(defaultWhisperxOptions);
    expect(out.analysisSpeakerTurnPostprocessPreset).toBeUndefined();
    expect(out.analysisSpeakerTurnMergeGapSecMax).toBeUndefined();
    expect(out.analysisSpeakerTurnSplitWordGapSec).toBeUndefined();
    expect(out.analysisWordTimestampStabilizeMode).toBeUndefined();
    expect(out.analysisWordTsNeighborRatioLow).toBeUndefined();
    expect(out.analysisWordTsNeighborRatioHigh).toBeUndefined();
    expect(out.analysisWordTsSmoothMaxSec).toBeUndefined();
    expect(out.audioPipelineSegments).toBeUndefined();
  });

  it("WX-605 : preset + gaps numériques", () => {
    const out = normalizeWhisperxOptions({
      ...defaultWhisperxOptions,
      analysisSpeakerTurnPostprocessPreset: "  sport_duo  ",
      analysisSpeakerTurnMergeGapSecMax: "0.08",
      analysisSpeakerTurnSplitWordGapSec: "0.45",
    });
    expect(out.analysisSpeakerTurnPostprocessPreset).toBe("sport_duo");
    expect(out.analysisSpeakerTurnMergeGapSecMax).toBe(0.08);
    expect(out.analysisSpeakerTurnSplitWordGapSec).toBe(0.45);
  });

  it("WX-606 : mode detect et seuils", () => {
    const out = normalizeWhisperxOptions({
      ...defaultWhisperxOptions,
      analysisWordTimestampStabilizeMode: "detect",
      analysisWordTsNeighborRatioLow: "0.25",
      analysisWordTsNeighborRatioHigh: "4",
      analysisWordTsSmoothMaxSec: "0.02",
    });
    expect(out.analysisWordTimestampStabilizeMode).toBe("detect");
    expect(out.analysisWordTsNeighborRatioLow).toBe(0.25);
    expect(out.analysisWordTsNeighborRatioHigh).toBe(4);
    expect(out.analysisWordTsSmoothMaxSec).toBe(0.02);
  });

  it("WX-606 : rejette ratio haut ≤ 1 et ratio bas ≤ 0", () => {
    const out = normalizeWhisperxOptions({
      ...defaultWhisperxOptions,
      analysisWordTsNeighborRatioLow: "0",
      analysisWordTsNeighborRatioHigh: "1",
    });
    expect(out.analysisWordTsNeighborRatioLow).toBeUndefined();
    expect(out.analysisWordTsNeighborRatioHigh).toBeUndefined();
  });

  it("WX-605 : scission gap ≤ 0 ignorée", () => {
    const out = normalizeWhisperxOptions({
      ...defaultWhisperxOptions,
      analysisSpeakerTurnSplitWordGapSec: "0",
    });
    expect(out.analysisSpeakerTurnSplitWordGapSec).toBeUndefined();
  });

  it("propage audioPipelineModules lorsque défini", () => {
    const out = normalizeWhisperxOptions({
      ...defaultWhisperxOptions,
      audioPipelineModules: { preNormalize: true, vadModel: true },
    });
    expect(out.audioPipelineModules).toEqual({ preNormalize: true, vadModel: true });
  });

  it("audioPipelineModulesJson prioritaire sur audioPipelineModules objet", () => {
    const out = normalizeWhisperxOptions({
      ...defaultWhisperxOptions,
      audioPipelineModules: { preNormalize: true },
      audioPipelineModulesJson: '{"qcSpectral": true}',
    });
    expect(out.audioPipelineModules).toEqual({ qcSpectral: true });
  });

  it("JSON vide ou {} retombe sur audioPipelineModules objet", () => {
    const base = {
      ...defaultWhisperxOptions,
      audioPipelineModules: { vadEnergy: true },
    };
    expect(
      normalizeWhisperxOptions({ ...base, audioPipelineModulesJson: "" }).audioPipelineModules,
    ).toEqual({ vadEnergy: true });
    expect(
      normalizeWhisperxOptions({ ...base, audioPipelineModulesJson: "  " }).audioPipelineModules,
    ).toEqual({ vadEnergy: true });
    expect(
      normalizeWhisperxOptions({ ...base, audioPipelineModulesJson: "{}" }).audioPipelineModules,
    ).toEqual({ vadEnergy: true });
  });

  it("WX-623 : audioPipelineSegments depuis JSON tableau", () => {
    const out = normalizeWhisperxOptions({
      ...defaultWhisperxOptions,
      audioPipelineSegmentsJson:
        '[{"startSec":0,"endSec":1.2,"audioPipelineModules":{"preNormalize":true}}]',
    });
    expect(out.audioPipelineSegments).toEqual([
      { startSec: 0, endSec: 1.2, audioPipelineModules: { preNormalize: true } },
    ]);
  });
});

describe("parseAudioPipelineSegmentsFromUi", () => {
  it("retourne undefined si vide, tableau vide ou JSON invalide", () => {
    expect(
      parseAudioPipelineSegmentsFromUi({
        ...defaultWhisperxOptions,
        audioPipelineSegmentsJson: "",
      }),
    ).toBeUndefined();
    expect(
      parseAudioPipelineSegmentsFromUi({
        ...defaultWhisperxOptions,
        audioPipelineSegmentsJson: "[]",
      }),
    ).toBeUndefined();
    expect(
      parseAudioPipelineSegmentsFromUi({
        ...defaultWhisperxOptions,
        audioPipelineSegmentsJson: "[",
      }),
    ).toBeUndefined();
  });

  it("retourne le tableau parse", () => {
    const raw = '[{"startSec":0,"endSec":2}]';
    expect(
      parseAudioPipelineSegmentsFromUi({
        ...defaultWhisperxOptions,
        audioPipelineSegmentsJson: raw,
      }),
    ).toEqual([{ startSec: 0, endSec: 2 }]);
  });
});

describe("parseAudioPipelineModulesFromUi", () => {
  it("retourne undefined si JSON non vide mais invalide", () => {
    expect(
      parseAudioPipelineModulesFromUi({
        ...defaultWhisperxOptions,
        audioPipelineModules: { a: true },
        audioPipelineModulesJson: "{",
      }),
    ).toBeUndefined();
  });
});

describe("upsertJobInList", () => {
  it("insère un nouveau job et trie par createdAtMs décroissant", () => {
    const a = jobStub({ id: "a", createdAtMs: 100 });
    const b = jobStub({ id: "b", createdAtMs: 200 });
    expect(upsertJobInList([a], b).map((j) => j.id)).toEqual(["b", "a"]);
  });

  it("remplace un job existant par id", () => {
    const j1 = jobStub({ id: "x", createdAtMs: 100, message: "old" });
    const j2 = jobStub({ id: "x", createdAtMs: 100, message: "new" });
    const next = upsertJobInList([j1], j2);
    expect(next).toHaveLength(1);
    expect(next[0].message).toBe("new");
  });
});
