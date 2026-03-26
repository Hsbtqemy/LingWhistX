import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultWhisperxOptions, profilePresets } from "../constants";
import { normalizeWhisperxOptions } from "../appUtils";
import { readStoredHfToken, writeStoredHfToken } from "../hfTokenStorage";
import type { CreateJobRequest, Job, JobFormStep, UiWhisperxOptions } from "../types";

export type UseNewJobFormOptions = {
  setError: (message: string) => void;
  setSelectedJobId: (id: string) => void;
  refreshJobs: () => Promise<void>;
  runtimeReady: boolean;
  runtimeCoreReady: boolean;
  /** Après création réussie d’un job (ex. basculer vers l’onglet Studio). */
  onJobCreated?: () => void;
};

export function useNewJobForm({
  setError,
  setSelectedJobId,
  refreshJobs,
  runtimeReady,
  runtimeCoreReady,
  onJobCreated,
}: UseNewJobFormOptions) {
  const [inputPath, setInputPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [mode, setMode] = useState<"mock" | "whisperx" | "analyze_only">("mock");
  const [whisperxOptions, setWhisperxOptions] = useState<UiWhisperxOptions>(() => ({
    ...defaultWhisperxOptions,
    hfToken: readStoredHfToken(),
  }));
  const [selectedProfileId, setSelectedProfileId] = useState("balanced");

  useEffect(() => {
    writeStoredHfToken(whisperxOptions.hfToken);
  }, [whisperxOptions.hfToken]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobFormStep, setJobFormStep] = useState<JobFormStep>("import");

  const selectedProfile = useMemo(
    () => profilePresets.find((preset) => preset.id === selectedProfileId),
    [selectedProfileId],
  );

  async function pickInputPath() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Selectionner un media",
    });
    if (typeof selected === "string") {
      setInputPath(selected);
      setError("");
      setJobFormStep("configure");
    }
  }

  async function pickOutputDir() {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Selectionner un dossier de sortie",
    });
    if (typeof selected === "string") {
      setOutputDir(selected);
    }
  }

  function continueToConfigurationPanel() {
    setError("");
    setJobFormStep("configure");
  }

  async function submitJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (jobFormStep === "import") {
      continueToConfigurationPanel();
      return;
    }

    if (!inputPath.trim()) {
      setError("Le chemin du media est requis.");
      return;
    }

    if (mode === "analyze_only" && !inputPath.trim().toLowerCase().endsWith(".json")) {
      setError("En mode analyze-only, selectionne un fichier JSON de run existant.");
      return;
    }

    if (mode === "whisperx") {
      const chunkSecondsRaw = whisperxOptions.pipelineChunkSeconds.trim();
      const overlapRaw = whisperxOptions.pipelineChunkOverlapSeconds.trim();
      const chunkSeconds = chunkSecondsRaw ? Number(chunkSecondsRaw) : Number.NaN;
      const overlapSeconds = overlapRaw ? Number(overlapRaw) : 0;
      if (chunkSecondsRaw && (!Number.isFinite(chunkSeconds) || chunkSeconds <= 0)) {
        setError("Chunk media (s) doit etre un nombre > 0.");
        return;
      }
      if (!Number.isFinite(overlapSeconds) || overlapSeconds < 0) {
        setError("Overlap chunk (s) doit etre un nombre >= 0.");
        return;
      }
      if (chunkSecondsRaw && overlapSeconds >= chunkSeconds) {
        setError("Overlap chunk (s) doit etre strictement inferieur a Chunk media (s).");
        return;
      }

      if (whisperxOptions.externalWordTimingsJson.trim() && whisperxOptions.noAlign) {
        setError(
          "Timings mots externes (JSON): desactive 'No Align' — l'alignement WhisperX est requis pour appliquer les horodatages.",
        );
        return;
      }

      if (whisperxOptions.diarize && !whisperxOptions.hfToken.trim()) {
        setError("Le HF Token est requis pour activer la diarization pyannote.");
        return;
      }

      if (whisperxOptions.diarize) {
        const minRaw = whisperxOptions.minSpeakers.trim();
        const maxRaw = whisperxOptions.maxSpeakers.trim();
        const forceRaw = whisperxOptions.forceNSpeakers.trim();
        const parsePositiveInt = (raw: string, label: string): number | null => {
          if (!raw) {
            return null;
          }
          const parsed = Number(raw);
          if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
            setError(`${label} doit etre un entier strictement positif.`);
            return Number.NaN;
          }
          return parsed;
        };
        const minSpeakers = parsePositiveInt(minRaw, "Min speakers");
        if (Number.isNaN(minSpeakers)) {
          return;
        }
        const maxSpeakers = parsePositiveInt(maxRaw, "Max speakers");
        if (Number.isNaN(maxSpeakers)) {
          return;
        }
        const forceNSpeakers = parsePositiveInt(forceRaw, "Force N speakers");
        if (Number.isNaN(forceNSpeakers)) {
          return;
        }
        if (forceNSpeakers !== null && (minSpeakers !== null || maxSpeakers !== null)) {
          setError("Force N speakers est exclusif avec Min/Max speakers.");
          return;
        }
        if (minSpeakers !== null && maxSpeakers !== null && minSpeakers > maxSpeakers) {
          setError("Min speakers doit etre inferieur ou egal a Max speakers.");
          return;
        }
      }

      const apmJsonTrim = whisperxOptions.audioPipelineModulesJson.trim();
      if (apmJsonTrim) {
        try {
          const parsed = JSON.parse(apmJsonTrim) as unknown;
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            setError("Modules audio (JSON) : un objet est attendu (pas tableau ni null).");
            return;
          }
        } catch {
          setError("Modules audio (JSON) : JSON invalide.");
          return;
        }
      }

      const apsTrim = whisperxOptions.audioPipelineSegmentsJson.trim();
      if (apsTrim) {
        try {
          const parsed = JSON.parse(apsTrim) as unknown;
          if (!Array.isArray(parsed) || parsed.length === 0) {
            setError("Plages pipeline (JSON) : un tableau non vide est attendu.");
            return;
          }
        } catch {
          setError("Plages pipeline (JSON) : JSON invalide.");
          return;
        }
      }
    }

    if (mode === "whisperx" || mode === "analyze_only") {
      const parseNonNegative = (raw: string, label: string): number | null => {
        if (!raw.trim()) {
          return null;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setError(`${label} doit etre un nombre >= 0.`);
          return Number.NaN;
        }
        return parsed;
      };
      const parsePositiveInt = (raw: string, label: string): number | null => {
        if (!raw.trim()) {
          return null;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
          setError(`${label} doit etre un entier >= 1.`);
          return Number.NaN;
        }
        return parsed;
      };

      const pauseMin = parseNonNegative(whisperxOptions.analysisPauseMin, "Pause min");
      if (Number.isNaN(pauseMin)) {
        return;
      }
      const pauseIgnoreBelow = parseNonNegative(
        whisperxOptions.analysisPauseIgnoreBelow,
        "Pause ignore below",
      );
      if (Number.isNaN(pauseIgnoreBelow)) {
        return;
      }
      const pauseMaxRaw = whisperxOptions.analysisPauseMax.trim();
      const pauseMaxValue = pauseMaxRaw ? Number(pauseMaxRaw) : Number.NaN;
      if (pauseMaxRaw && (!Number.isFinite(pauseMaxValue) || pauseMaxValue <= 0)) {
        setError("Pause max doit etre un nombre > 0.");
        return;
      }
      const pauseMax = pauseMaxRaw ? pauseMaxValue : null;
      if (
        pauseMax !== null &&
        pauseMin !== null &&
        pauseIgnoreBelow !== null &&
        pauseMax < Math.max(pauseMin, pauseIgnoreBelow)
      ) {
        setError("Pause max doit etre >= max(Pause min, Pause ignore below).");
        return;
      }
      const ipuMinWords = parsePositiveInt(whisperxOptions.analysisIpuMinWords, "IPU min words");
      if (Number.isNaN(ipuMinWords)) {
        return;
      }
      const ipuMinDuration = parseNonNegative(
        whisperxOptions.analysisIpuMinDuration,
        "IPU min duration",
      );
      if (Number.isNaN(ipuMinDuration)) {
        return;
      }
      const ipuBridge = parseNonNegative(
        whisperxOptions.analysisIpuBridgeShortGapsUnder,
        "IPU bridge short gaps",
      );
      if (Number.isNaN(ipuBridge)) {
        return;
      }
    }

    if (mode === "whisperx" && !runtimeReady) {
      setError(
        "Runtime WhisperX incomplet. Clique sur 'Verifier runtime' puis corrige Python/WhisperX/ffmpeg.",
      );
      return;
    }
    if (mode === "analyze_only" && !runtimeCoreReady) {
      setError("Runtime analyze-only incomplet. Python + WhisperX doivent etre disponibles.");
      return;
    }

    if (mode === "whisperx") {
      const ok = window.confirm(
        "Lancer WhisperX : execution locale lourde (CPU/GPU), duree potentiellement longue, fichiers ecrits sur disque. Confirmer ?",
      );
      if (!ok) {
        return;
      }
    } else if (mode === "analyze_only") {
      const ok = window.confirm(
        "Analyze-only : relit un JSON de run et recalcule metriques (pauses/IPU) sans nouvelle transcription. Confirmer ?",
      );
      if (!ok) {
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const request: CreateJobRequest = {
        inputPath: inputPath.trim(),
        outputDir: outputDir.trim() || null,
        mode,
        whisperxOptions: mode !== "mock" ? normalizeWhisperxOptions(whisperxOptions) : undefined,
      };
      const created = await invoke<Job>("create_job", { request });
      setSelectedJobId(created.id);
      await refreshJobs();
      onJobCreated?.();
      setInputPath("");
      setJobFormStep("import");
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  function applyProfile(profileId: string) {
    setSelectedProfileId(profileId);
    const profile = profilePresets.find((preset) => preset.id === profileId);
    if (profile) {
      setWhisperxOptions((prev) => ({ ...profile.options, hfToken: prev.hfToken }));
    }
  }

  function applyAdvancedPreset(
    preset: "whisperx_no_diarize" | "whisperx_diarize" | "analyze_only",
  ) {
    setError("");
    if (preset === "analyze_only") {
      setMode("analyze_only");
    } else {
      setMode("whisperx");
      setWhisperxOptions((prev) => ({
        ...prev,
        diarize: preset === "whisperx_diarize",
      }));
    }
    setJobFormStep("configure");
  }

  return {
    inputPath,
    setInputPath,
    outputDir,
    setOutputDir,
    mode,
    setMode,
    whisperxOptions,
    setWhisperxOptions,
    selectedProfileId,
    setSelectedProfileId,
    isSubmitting,
    jobFormStep,
    setJobFormStep,
    selectedProfile,
    pickInputPath,
    pickOutputDir,
    continueToConfigurationPanel,
    submitJob,
    applyProfile,
    applyAdvancedPreset,
  };
}

export type NewJobFormApi = ReturnType<typeof useNewJobForm>;
