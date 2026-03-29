import { describe, expect, it } from "vitest";
import {
  expectedWhisperxStemExtensions,
  hasStemExtensionFile,
  mediaStemFromInputPath,
} from "./expectedOutputFormats";

describe("expectedWhisperxStemExtensions", () => {
  it("all → les 5 writers standard", () => {
    expect(expectedWhisperxStemExtensions("all")).toEqual(["txt", "vtt", "srt", "tsv", "json"]);
  });

  it("liste comma + json implicite", () => {
    expect(expectedWhisperxStemExtensions("srt,vtt")).toEqual(["json", "srt", "vtt"]);
  });

  it("garde json en tête si déjà présent", () => {
    expect(expectedWhisperxStemExtensions("json,srt")).toEqual(["json", "srt"]);
  });
});

describe("mediaStemFromInputPath", () => {
  it("extrait le stem", () => {
    expect(mediaStemFromInputPath("/foo/bar/clip.wav")).toBe("clip");
    expect(mediaStemFromInputPath("C:\\a\\b\\x.m4a")).toBe("x");
  });
});

describe("hasStemExtensionFile", () => {
  it("détecte le fichier attendu", () => {
    expect(hasStemExtensionFile(["/out/clip.json", "/out/x.txt"], "clip", "json")).toBe(true);
    expect(hasStemExtensionFile(["/out/clip.json"], "clip", "srt")).toBe(false);
  });
});
