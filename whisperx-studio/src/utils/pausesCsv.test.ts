import { describe, expect, it } from "vitest";
import { parsePausesCsv, splitCsvLine } from "./pausesCsv";

describe("splitCsvLine", () => {
  it("gère des champs simples", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
});

describe("parsePausesCsv", () => {
  it("lit start/end depuis l’en-tête WhisperX", () => {
    const csv = `speaker,start,end,dur,type
,0.1,0.35,0.25,speech_gap
SPEAKER_00,1.0,1.5,0.5,`;
    const r = parsePausesCsv(csv);
    expect(r).toEqual([
      { start: 0.1, end: 0.35 },
      { start: 1, end: 1.5 },
    ]);
  });

  it("ignore les lignes invalides", () => {
    const csv = `speaker,start,end,dur,type
,1,1,bad,`;
    expect(parsePausesCsv(csv)).toEqual([]);
  });
});
