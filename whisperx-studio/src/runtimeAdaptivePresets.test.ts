import { describe, expect, it } from "vitest";
import { adaptiveProfilePresets, recommendedWhisperDevice } from "./runtimeAdaptivePresets";
import type { RuntimeStatus } from "./types";

const baseRs = (over: Partial<RuntimeStatus>): RuntimeStatus => ({
  pythonCommand: "python3",
  pythonOk: true,
  whisperxOk: true,
  ffmpegOk: true,
  whisperxVersion: "3.0.0",
  details: [],
  ...over,
});

describe("recommendedWhisperDevice", () => {
  it("retourne auto si runtime inconnu", () => {
    expect(recommendedWhisperDevice(null)).toBe("auto");
  });

  it("retourne cuda si CUDA dispo", () => {
    expect(
      recommendedWhisperDevice(
        baseRs({
          torchCudaAvailable: true,
          whisperxDefaultDevice: "cuda",
          pythonPlatform: "linux",
        }),
      ),
    ).toBe("cuda");
  });

  it("retourne cpu sur Mac sans CUDA", () => {
    expect(
      recommendedWhisperDevice(
        baseRs({
          torchCudaAvailable: false,
          torchMpsAvailable: true,
          whisperxDefaultDevice: "cpu",
          pythonPlatform: "darwin",
        }),
      ),
    ).toBe("cpu");
  });
});

describe("adaptiveProfilePresets", () => {
  it("qualité GPU retombe en CPU + float32 sans CUDA", () => {
    const presets = adaptiveProfilePresets(
      baseRs({
        torchCudaAvailable: false,
        whisperxDefaultDevice: "cpu",
        pythonPlatform: "linux",
      }),
    );
    const q = presets.find((p) => p.id === "quality_gpu");
    expect(q?.overrides.device).toBe("cpu");
    expect(q?.overrides.computeType).toBe("float32");
  });

  it("équilibre utilise cuda si CUDA dispo", () => {
    const presets = adaptiveProfilePresets(
      baseRs({ torchCudaAvailable: true, whisperxDefaultDevice: "cuda" }),
    );
    const b = presets.find((p) => p.id === "balanced");
    expect(b?.overrides.device).toBe("cuda");
  });
});
