import { profilePresets } from "./constants";
import type { ProfilePreset, RuntimeStatus, UiWhisperxOptions } from "./types";

/** Device recommandé pour les préréglages : CUDA si dispo, sinon CPU explicite (pas « auto » sur Mac). */
export function recommendedWhisperDevice(
  rs: RuntimeStatus | null | undefined,
): UiWhisperxOptions["device"] {
  if (!rs?.pythonOk || !rs.whisperxOk) {
    return "auto";
  }
  if (rs.torchCudaAvailable === true || rs.whisperxDefaultDevice === "cuda") {
    return "cuda";
  }
  return "cpu";
}

/**
 * Préréglages profil avec `device` / `computeType` / descriptions adaptés au runtime détecté
 * (sonde PyTorch dans « Vérifier le runtime »).
 */
export function adaptiveProfilePresets(rs: RuntimeStatus | null): ProfilePreset[] {
  const dev = recommendedWhisperDevice(rs);
  const cuda = rs?.torchCudaAvailable === true || rs?.whisperxDefaultDevice === "cuda";
  const platform = rs?.pythonPlatform ?? "";
  const isMac = platform === "darwin";

  const macCpuHint =
    !cuda && isMac
      ? " Sur ce Mac (pas de CUDA), tout le pipeline reste sur CPU ; la diarisation peut être longue."
      : "";
  const genericCpuHint =
    !cuda && !isMac ? " Pas de GPU NVIDIA détecté : exécution CPU." : "";

  return profilePresets.map((p) => {
    const o = { ...p.options };
    switch (p.id) {
      case "balanced":
        return {
          ...p,
          description: `${p.description}${macCpuHint || genericCpuHint}`,
          options: { ...o, device: dev },
        };
      case "cpu_fast":
        return {
          ...p,
          options: { ...o, device: "cpu" },
        };
      case "quality_gpu":
        return {
          ...p,
          description: `${p.description}${
            cuda ? "" : " GPU indisponible : passage en CPU (float32) pour la stabilité."
          }`,
          options: {
            ...o,
            device: cuda ? "cuda" : "cpu",
            computeType: cuda ? "float16" : "float32",
          },
        };
      case "meeting_diarize":
        return {
          ...p,
          description: `${p.description}${macCpuHint || genericCpuHint}`,
          options: { ...o, device: dev },
        };
      default:
        return { ...p, options: { ...o, device: dev } };
    }
  });
}
