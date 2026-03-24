import { describe, expect, it } from "vitest";
import { buildRecalcPausesIpuConfig } from "./studioExplorerRecalcConfig";

describe("buildRecalcPausesIpuConfig", () => {
  it("retourne null si minPause ou ignoreBelow non finis", () => {
    expect(
      buildRecalcPausesIpuConfig({
        minPauseInput: "x",
        ignoreBelowInput: "0.1",
        pauseMaxInput: "",
        ipuMinWordsInput: "1",
        ipuMinDurInput: "0",
      }),
    ).toBeNull();
    expect(
      buildRecalcPausesIpuConfig({
        minPauseInput: "0.15",
        ignoreBelowInput: "oops",
        pauseMaxInput: "",
        ipuMinWordsInput: "1",
        ipuMinDurInput: "0",
      }),
    ).toBeNull();
  });

  it("construit la config avec pauseMax optionnel et IPU par défaut", () => {
    const cfg = buildRecalcPausesIpuConfig({
      minPauseInput: "0.15",
      ignoreBelowInput: "0.1",
      pauseMaxInput: "",
      ipuMinWordsInput: "1",
      ipuMinDurInput: "0",
    });
    expect(cfg).toEqual({
      minPauseSec: 0.15,
      ignoreBelowSec: 0.1,
      pauseMaxSec: null,
      ipuMinWords: 1,
      ipuMinDurationSec: 0,
    });
  });

  it("parse pauseMax et borne ipuMinWords à au moins 1", () => {
    const cfg = buildRecalcPausesIpuConfig({
      minPauseInput: "0.2",
      ignoreBelowInput: "0.05",
      pauseMaxInput: "3.5",
      ipuMinWordsInput: "0",
      ipuMinDurInput: "0.5",
    });
    expect(cfg?.pauseMaxSec).toBe(3.5);
    expect(cfg?.ipuMinWords).toBe(1);
    expect(cfg?.ipuMinDurationSec).toBe(0.5);
  });
});
