import type { Job, JobLogEvent } from "../types";

export type PipelineStep = {
  id: string;
  label: string;
  hint?: string;
};

const RUNTIME_STEP: PipelineStep = {
  id: "runtime",
  label: "Runtime",
  hint: "Worker, fichier",
};

function prependRuntime(steps: PipelineStep[]): PipelineStep[] {
  return [RUNTIME_STEP, ...steps];
}

/**
 * Étapes affichées dans le bandeau pipeline (cohérentes avec les options du job).
 * La première étape est toujours « Runtime » (file / démarrage worker).
 */
export function buildPipelineSteps(job: Job): PipelineStep[] {
  if (job.mode === "mock") {
    return prependRuntime([
      { id: "prep", label: "Préparation", hint: "Calibration mock" },
      { id: "transcribe", label: "Transcription" },
      { id: "align", label: "Alignement" },
      { id: "diarize", label: "Diarisation" },
      { id: "finalize", label: "Export" },
    ]);
  }
  if (job.mode === "analyze_only") {
    return prependRuntime([
      { id: "prep", label: "Préparation" },
      { id: "analyze", label: "Analyse", hint: "Métriques sur JSON" },
      { id: "finalize", label: "Écriture" },
    ]);
  }
  const o = job.whisperxOptions;
  const steps: PipelineStep[] = [
    { id: "prep", label: "Préparation", hint: "Commande, média" },
    { id: "transcribe", label: "Transcription", hint: "ASR" },
  ];
  if (!o?.noAlign) {
    steps.push({ id: "align", label: "Alignement", hint: "Mots" });
  }
  if (o?.diarize) {
    steps.push({ id: "diarize", label: "Diarisation", hint: "Locuteurs" });
  }
  steps.push({ id: "finalize", label: "Export", hint: "Fichiers" });
  return prependRuntime(steps);
}

function resolveWhisperxLikeFromLogs(logs: JobLogEvent[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const st = logs[i].stage;
    if (st === "wx_finalize") {
      return "finalize";
    }
    if (st === "wx_diarize") {
      return "diarize";
    }
    if (st === "wx_align") {
      return "align";
    }
    if (st === "wx_analyze") {
      return "analyze";
    }
    if (st === "wx_live_transcript") {
      return "transcribe";
    }
    if (st === "wx_transcribe") {
      return "transcribe";
    }
    if (st === "wx_prep") {
      return "prep";
    }
  }
  return null;
}

function clampStepIdToPipeline(steps: PipelineStep[], id: string): string {
  if (steps.some((s) => s.id === id)) {
    return id;
  }
  if (id === "align" && !steps.some((s) => s.id === "align")) {
    return "transcribe";
  }
  if (id === "diarize" && !steps.some((s) => s.id === "diarize")) {
    return "finalize";
  }
  if (id === "analyze" && !steps.some((s) => s.id === "analyze")) {
    return "prep";
  }
  return steps[0]?.id ?? "prep";
}

/**
 * Déduit l’étape courante à partir des logs (stages wx_*) et du statut job.
 */
export function resolveActivePipelineStepId(job: Job, logs: JobLogEvent[]): string {
  if (job.status === "queued") {
    return "runtime";
  }
  if (job.mode === "mock") {
    const last = [...logs].reverse().find((l) => l.stage);
    const s = last?.stage;
    if (s === "calibration") {
      return "prep";
    }
    if (s === "transcription") {
      return "transcribe";
    }
    if (s === "alignment") {
      return "align";
    }
    if (s === "diarization") {
      return "diarize";
    }
    if (s === "export" || (s === "mock" && job.progress >= 95)) {
      return "finalize";
    }
    if (job.progress >= 96) {
      return "finalize";
    }
    if (job.progress < 8) {
      return "runtime";
    }
    if (job.progress < 12) {
      return "prep";
    }
    return "transcribe";
  }

  if (job.mode === "analyze_only") {
    const fromLogs = resolveWhisperxLikeFromLogs(logs);
    if (fromLogs) {
      const steps = buildPipelineSteps(job);
      return clampStepIdToPipeline(steps, fromLogs);
    }
    if (job.progress >= 96) {
      return "finalize";
    }
    if (job.progress < 8) {
      return "runtime";
    }
    if (job.progress < 22) {
      return "prep";
    }
    return "analyze";
  }

  const fromLogs = resolveWhisperxLikeFromLogs(logs);
  if (fromLogs) {
    const steps = buildPipelineSteps(job);
    return clampStepIdToPipeline(steps, fromLogs);
  }
  if (job.status === "running") {
    if (job.progress >= 96) {
      return "finalize";
    }
    if (job.progress < 10) {
      return "runtime";
    }
    if (job.progress < 28) {
      return "prep";
    }
    return "transcribe";
  }

  if (job.status === "error" || job.status === "cancelled") {
    const steps = buildPipelineSteps(job);
    const guessed = resolveWhisperxLikeFromLogs(logs) ?? "transcribe";
    return clampStepIdToPipeline(steps, guessed);
  }

  return "prep";
}

/**
 * Index de l’étape active dans `steps`, ou -1 si terminé / file d’attente.
 */
export function resolveActiveStepIndex(
  job: Job,
  steps: PipelineStep[],
  activeId: string,
): { activeIndex: number; allComplete: boolean; isQueued: boolean } {
  if (job.status === "queued") {
    const runtimeIdx = steps.findIndex((s) => s.id === "runtime");
    return {
      activeIndex: runtimeIdx >= 0 ? runtimeIdx : 0,
      allComplete: false,
      isQueued: true,
    };
  }
  if (job.status === "done") {
    return { activeIndex: -1, allComplete: true, isQueued: false };
  }
  const activeIndex = steps.findIndex((s) => s.id === activeId);
  return {
    activeIndex: activeIndex >= 0 ? activeIndex : 0,
    allComplete: false,
    isQueued: false,
  };
}

export function jobModeLabel(mode: Job["mode"]): string {
  if (mode === "whisperx") {
    return "WhisperX";
  }
  if (mode === "analyze_only") {
    return "Analyse seule";
  }
  return "Mock";
}
