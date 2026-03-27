/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { readWebAudioDefault, writeWebAudioDefault } from "./studioPreferences";

const KEY = "lx-studio-pref-web-audio-default";

describe("studioPreferences web audio default", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  });

  it("sans clé : true par défaut", () => {
    expect(readWebAudioDefault()).toBe(true);
  });

  it("persiste 0 / 1", () => {
    writeWebAudioDefault(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(readWebAudioDefault()).toBe(false);
    writeWebAudioDefault(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(readWebAudioDefault()).toBe(true);
  });
});
