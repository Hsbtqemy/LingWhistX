/**
 * WX-665 — Hook pour l'aperçu audio A/B (original vs prétraité).
 *
 * Génère un aperçu de 30 s en appliquant les modules pipeline configurés,
 * et permet de basculer entre l'audio original et l'audio traité.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type AudioPreviewSlot = "original" | "processed";

export type AudioPreviewState = {
  isGenerating: boolean;
  /** B64 WAV de l'extrait original (30 s). */
  originalB64: string | null;
  /** B64 WAV de l'extrait prétraité. Identique à originalB64 si is_processed=false. */
  processedB64: string | null;
  /** true si au moins un module a été appliqué. */
  isProcessed: boolean;
  /** Quel audio est actif dans le toggle A/B. */
  activeSlot: AudioPreviewSlot;
  error: string;
};

const INITIAL_STATE: AudioPreviewState = {
  isGenerating: false,
  originalB64: null,
  processedB64: null,
  isProcessed: false,
  activeSlot: "original",
  error: "",
};

type PreviewResult = {
  original_b64: string;
  processed_b64: string;
  is_processed: boolean;
};

export function useAudioPreview(inputPath: string, modulesJson: string) {
  const [state, setState] = useState<AudioPreviewState>(INITIAL_STATE);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /** Réinitialise quand le fichier source ou les modules changent. */
  useEffect(() => {
    setState(INITIAL_STATE);
  }, [inputPath, modulesJson]);

  const generate = useCallback(
    async (startSec: number) => {
      if (!inputPath.trim()) {
        setState((prev) => ({
          ...prev,
          error: "Aucun fichier média sélectionné.",
        }));
        return;
      }

      let parsedModules: unknown;
      try {
        parsedModules = modulesJson.trim() ? JSON.parse(modulesJson) : {};
      } catch {
        setState((prev) => ({
          ...prev,
          error: "JSON des modules invalide.",
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        isGenerating: true,
        error: "",
        originalB64: null,
        processedB64: null,
        isProcessed: false,
        activeSlot: "original",
      }));

      try {
        const result = await invoke<PreviewResult>("generate_preprocessed_audio_preview", {
          inputPath: inputPath.trim(),
          startSec,
          durationSec: 30,
          modulesJson: JSON.stringify(parsedModules),
        });
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          originalB64: result.original_b64,
          processedB64: result.processed_b64,
          isProcessed: result.is_processed,
          activeSlot: "original",
        }));
      } catch (e) {
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: String(e),
        }));
      }
    },
    [inputPath, modulesJson],
  );

  const toggleSlot = useCallback(() => {
    setState((prev) => {
      const next: AudioPreviewSlot = prev.activeSlot === "original" ? "processed" : "original";
      return { ...prev, activeSlot: next };
    });
  }, []);

  const setSlot = useCallback((slot: AudioPreviewSlot) => {
    setState((prev) => ({ ...prev, activeSlot: slot }));
  }, []);

  /** Src audio courant pour l'élément <audio>. */
  const activeAudioSrc = (() => {
    if (!state.originalB64) return null;
    const b64 = state.activeSlot === "processed" ? state.processedB64 : state.originalB64;
    return b64 ? `data:audio/wav;base64,${b64}` : null;
  })();

  return {
    state,
    audioRef,
    activeAudioSrc,
    generate,
    toggleSlot,
    setSlot,
  };
}
