import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { CreateAnnotationRunResponse } from "../types";

type Step = "idle" | "running" | "done";

export type UseAnnotationRunImportReturn = {
  step: Step;
  error: string;
  /** Ouvre les dialogs audio + dossier de sortie, puis lance l'import sans transcript. */
  importAudioOnly: () => Promise<string | null>;
  /** Ouvre les dialogs audio + transcript + dossier de sortie, puis lance l'import. */
  importWithTranscript: () => Promise<string | null>;
  /** Import direct avec chemins déjà connus (appelé depuis le Player en drop). */
  importDirect: (
    audioPath: string,
    transcriptPath: string | null,
    outputDir: string,
  ) => Promise<string | null>;
  reset: () => void;
};

export function useAnnotationRunImport(): UseAnnotationRunImportReturn {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");

  const run = useCallback(
    async (
      audioPath: string,
      transcriptPath: string | null,
      outputDir: string,
    ): Promise<string | null> => {
      setStep("running");
      setError("");
      try {
        const res = await invoke<CreateAnnotationRunResponse>("create_annotation_run", {
          audioPath,
          transcriptPath,
          outputDir,
        });
        setStep("done");
        return res.runDir;
      } catch (e) {
        setError(String(e));
        setStep("idle");
        return null;
      }
    },
    [],
  );

  const importAudioOnly = useCallback(async (): Promise<string | null> => {
    const audio = await openDialog({
      title: "Choisir un fichier audio",
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "m4a", "ogg", "opus", "aac"] }],
      multiple: false,
      directory: false,
    });
    if (!audio || typeof audio !== "string") return null;

    const outputDir = await openDialog({
      title: "Choisir le dossier de destination pour le run",
      multiple: false,
      directory: true,
    });
    if (!outputDir || typeof outputDir !== "string") return null;

    return run(audio, null, outputDir);
  }, [run]);

  const importWithTranscript = useCallback(async (): Promise<string | null> => {
    const audio = await openDialog({
      title: "Choisir un fichier audio",
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "m4a", "ogg", "opus", "aac"] }],
      multiple: false,
      directory: false,
    });
    if (!audio || typeof audio !== "string") return null;

    const transcript = await openDialog({
      title: "Choisir un transcript (SRT, VTT ou JSON)",
      filters: [{ name: "Transcript", extensions: ["srt", "vtt", "json"] }],
      multiple: false,
      directory: false,
    });
    if (!transcript || typeof transcript !== "string") return null;

    const outputDir = await openDialog({
      title: "Choisir le dossier de destination pour le run",
      multiple: false,
      directory: true,
    });
    if (!outputDir || typeof outputDir !== "string") return null;

    return run(audio, transcript, outputDir);
  }, [run]);

  const importDirect = useCallback(
    (audioPath: string, transcriptPath: string | null, outputDir: string) =>
      run(audioPath, transcriptPath, outputDir),
    [run],
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError("");
  }, []);

  return { step, error, importAudioOnly, importWithTranscript, importDirect, reset };
}
