import type { Job, JobLogEvent } from "../types";

/** Clé stable pour regrouper le journal (alignée sur le bandeau pipeline quand c’est possible). */
export type LogSectionId =
  | "system"
  | "prep"
  | "transcribe"
  | "align"
  | "diarize"
  | "analyze"
  | "finalize"
  | "mock_flow"
  | "other";

export type JobLogSection = {
  id: LogSectionId;
  /** Titre affiché (français). */
  label: string;
  /** Sous-texte optionnel (origine technique du stage). */
  hint?: string;
  /** Lignes de cette section, ordre chronologique (plus ancien en premier). */
  logs: JobLogEvent[];
};

const SECTION_LABELS: Record<LogSectionId, { label: string; hint?: string }> = {
  system: { label: "Système & lancement", hint: "Runtime, messages génériques" },
  prep: { label: "Préparation", hint: "Commande, environnement" },
  transcribe: { label: "Transcription", hint: "ASR Whisper" },
  align: { label: "Alignement", hint: "Timestamps mots" },
  diarize: { label: "Diarisation", hint: "Pyannote / locuteurs" },
  analyze: { label: "Analyse (fichier)", hint: "Analyze-only, métriques" },
  finalize: { label: "Finalisation", hint: "Écriture des sorties" },
  mock_flow: { label: "Simulation (mock)", hint: "Étapes factices" },
  other: { label: "Autres messages", hint: "Stage inconnu ou mixte" },
};

/** Mappe un `stage` émis par le worker / WhisperX vers une section. */
export function stageToSectionId(stage: string | null | undefined): LogSectionId {
  if (!stage || stage === "-") {
    return "other";
  }
  const s = stage.toLowerCase();
  if (s === "system" || s === "parser") {
    return "system";
  }
  if (s === "runtime" || s === "wx_prep" || s === "whisperx") {
    return "prep";
  }
  if (s === "wx_transcribe" || s === "wx_live_transcript") {
    return "transcribe";
  }
  if (s === "wx_align") {
    return "align";
  }
  if (s === "wx_diarize") {
    return "diarize";
  }
  if (s === "wx_analyze") {
    return "analyze";
  }
  if (s === "wx_finalize") {
    return "finalize";
  }
  if (s === "mock") {
    return "mock_flow";
  }
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
  if (s === "export") {
    return "finalize";
  }
  return "other";
}

/**
 * Heuristique sur le texte brut (logs WhisperX sans `stage` ou stage « other »).
 * Aligné sur `infer_whisperx_stdout_stage` côté worker (ordre : align → diarize → transcribe → …).
 */
export function inferSectionFromMessage(message: string): LogSectionId | null {
  const m = message.toLowerCase();

  if (m.includes("failed to align segment")) {
    return "align";
  }
  if (m.includes("performing alignment")) {
    return "align";
  }
  if (m.includes("new language found") && m.includes("alignment model")) {
    return "align";
  }
  if (m.includes("applied external word timings")) {
    return "align";
  }

  if (m.includes("loading diarization model")) {
    return "diarize";
  }
  if (m.includes("performing diarization")) {
    return "diarize";
  }
  if (m.includes("using model:") && m.includes("pyannote")) {
    return "diarize";
  }

  if (m.includes("performing voice activity detection")) {
    return "transcribe";
  }
  if (m.includes("performing transcription")) {
    return "transcribe";
  }
  if (m.includes("using media chunking")) {
    return "transcribe";
  }
  if (m.includes("transcribed chunk #")) {
    return "transcribe";
  }
  if (m.includes("resuming chunk #")) {
    return "transcribe";
  }
  if (m.includes("transcript:") && message.includes("-->")) {
    return "transcribe";
  }
  if (m.includes("detected language:") && m.includes("first 30s")) {
    return "transcribe";
  }
  if (m.includes("compute type not specified")) {
    return "transcribe";
  }
  if (m.includes("no language specified, language will be detected")) {
    return "transcribe";
  }
  if (m.includes("suppressing numeral and symbol tokens")) {
    return "transcribe";
  }
  if (m.includes("use manually assigned vad_model")) {
    return "transcribe";
  }

  if (m.includes("analyze-only completed")) {
    return "analyze";
  }

  return null;
}

function resolveSectionForLog(log: JobLogEvent): LogSectionId {
  const fromStage = stageToSectionId(log.stage ?? undefined);
  if (fromStage !== "other") {
    return fromStage;
  }
  const fromMsg = inferSectionFromMessage(log.message);
  return fromMsg ?? "other";
}

/**
 * Regroupe les événements par grande étape, en conservant l’ordre chronologique dans chaque groupe.
 * Les sections sont ordonnées selon la première apparition d’un log dans cette section.
 */
export function groupJobLogsIntoSections(logs: JobLogEvent[], _job: Job): JobLogSection[] {
  void _job;
  if (logs.length === 0) {
    return [];
  }

  const chronological = [...logs].sort((a, b) => a.tsMs - b.tsMs);
  const sections: JobLogSection[] = [];
  let currentId: LogSectionId | null = null;
  let currentLogs: JobLogEvent[] = [];

  const flush = () => {
    if (currentId === null || currentLogs.length === 0) {
      return;
    }
    const meta = SECTION_LABELS[currentId];
    sections.push({
      id: currentId,
      label: meta.label,
      hint: meta.hint,
      logs: currentLogs,
    });
    currentLogs = [];
  };

  for (const log of chronological) {
    const sid = resolveSectionForLog(log);
    if (currentId !== sid) {
      flush();
      currentId = sid;
    }
    currentLogs.push(log);
  }
  flush();

  return sections;
}
