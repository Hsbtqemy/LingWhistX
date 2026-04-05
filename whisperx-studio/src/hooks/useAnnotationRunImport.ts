import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { CreateAnnotationRunResponse } from "../types";

type Step = "idle" | "running" | "done";

function parseRunDir(res: CreateAnnotationRunResponse): string {
  return (
    (typeof res.runDir === "string" && res.runDir.trim()) ||
    (res as unknown as { run_dir?: string }).run_dir?.trim() ||
    ""
  );
}

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

  /** WX-733 — run vide : Rust uniquement (pas de Python). */
  const runBlankAnnotation = useCallback(
    async (audioPath: string, outputDir: string): Promise<string | null> => {
      setStep("running");
      setError("");
      try {
        const res = await invoke<CreateAnnotationRunResponse>("create_blank_annotation_run", {
          audioPath,
          outputDir,
        });
        const runDir = parseRunDir(res);
        if (!runDir) {
          setError("Réponse invalide : chemin du run (runDir) absent.");
          setStep("idle");
          return null;
        }
        setStep("done");
        return runDir;
      } catch (e) {
        setError(String(e));
        setStep("idle");
        return null;
      }
    },
    [],
  );

  const runWithPython = useCallback(
    async (
      audioPath: string,
      transcriptPath: string,
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
        const runDir = parseRunDir(res);
        if (!runDir) {
          setError("Réponse invalide : chemin du run (runDir) absent.");
          setStep("idle");
          return null;
        }
        setStep("done");
        return runDir;
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
      title: "Dossier parent du run — un sous-dossier runs/<id>/ y sera créé",
      multiple: false,
      directory: true,
    });
    if (!outputDir || typeof outputDir !== "string") return null;

    return runBlankAnnotation(audio, outputDir);
  }, [runBlankAnnotation]);

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
      title:
        "Dossier parent du run — le dossier du run y sera créé (pas un fichier « transcript » à enregistrer)",
      multiple: false,
      directory: true,
    });
    if (!outputDir || typeof outputDir !== "string") return null;

    return runWithPython(audio, transcript, outputDir);
  }, [runWithPython]);

  const importDirect = useCallback(
    (
      audioPath: string,
      transcriptPath: string | null,
      outputDir: string,
    ): Promise<string | null> => {
      const hasTranscript = transcriptPath != null && transcriptPath.trim().length > 0;
      if (!hasTranscript) {
        return runBlankAnnotation(audioPath, outputDir);
      }
      return runWithPython(audioPath, transcriptPath, outputDir);
    },
    [runBlankAnnotation, runWithPython],
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError("");
  }, []);

  return { step, error, importAudioOnly, importWithTranscript, importDirect, reset };
}
