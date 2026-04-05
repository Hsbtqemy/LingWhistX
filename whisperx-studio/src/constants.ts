import type {
  AnnotationConvention,
  ExportTimingRules,
  ProfilePreset,
  UiWhisperxOptions,
} from "./types";

/**
 * Modèles ASR faster-whisper / WhisperX (`--model`).
 * Valeurs alignées sur le paquet faster-whisper (voir doc du projet).
 */
export const WHISPER_MODEL_CHOICES: readonly { value: string; label: string }[] = [
  { value: "tiny", label: "tiny — très rapide, précision limitée" },
  { value: "tiny.en", label: "tiny.en — idem, anglais uniquement" },
  { value: "base", label: "base — léger" },
  { value: "base.en", label: "base.en — idem, anglais uniquement" },
  { value: "small", label: "small — bon compromis (défaut Studio)" },
  { value: "small.en", label: "small.en — idem, anglais uniquement" },
  { value: "medium", label: "medium — plus précis, plus lent" },
  { value: "medium.en", label: "medium.en — idem, anglais uniquement" },
  { value: "large-v1", label: "large-v1 — grande taille (v1)" },
  { value: "large-v2", label: "large-v2 — grande taille (v2)" },
  { value: "large-v3", label: "large-v3 — grande taille (v3), souvent le meilleur" },
  { value: "large", label: "large — alias selon la version faster-whisper" },
  { value: "distil-large-v2", label: "distil-large-v2 — distillé, rapide" },
  { value: "distil-large-v3", label: "distil-large-v3 — distillé, rapide (v3)" },
];

export const defaultWhisperxOptions: UiWhisperxOptions = {
  model: "small",
  language: "",
  device: "auto",
  computeType: "default",
  batchSize: "8",
  pipelineChunkSeconds: "",
  pipelineChunkOverlapSeconds: "0",
  diarize: false,
  minSpeakers: "",
  maxSpeakers: "",
  forceNSpeakers: "",
  analysisPauseMin: "0.15",
  analysisPauseIgnoreBelow: "0.1",
  analysisPauseMax: "",
  analysisIncludeNonspeech: true,
  analysisNonspeechMinDuration: "0.15",
  analysisIpuMinWords: "1",
  analysisIpuMinDuration: "0",
  analysisIpuBridgeShortGapsUnder: "0",
  hfToken: "",
  outputFormat: "all",
  noAlign: false,
  externalWordTimingsJson: "",
  externalWordTimingsStrict: false,
  vadMethod: "pyannote",
  printProgress: false,
  analysisSpeakerTurnPostprocessPreset: "",
  analysisSpeakerTurnMergeGapSecMax: "",
  analysisSpeakerTurnSplitWordGapSec: "",
  analysisWordTimestampStabilizeMode: "off",
  analysisWordTsNeighborRatioLow: "",
  analysisWordTsNeighborRatioHigh: "",
  analysisWordTsSmoothMaxSec: "",
  audioPipelineModulesJson: "",
  audioPipelineSegmentsJson: "",
  exportAnnotationEaf: false,
  exportAnnotationTextgrid: false,
};

// WX-656 — presets définis comme surcharges partielles (Partial<UiWhisperxOptions>).
// applyProfileOverrides() dans profileCompose.ts les fusionne avec defaultWhisperxOptions.
export const profilePresets: ProfilePreset[] = [
  {
    id: "balanced",
    label: "Equilibre (recommande)",
    description: "Bon compromis vitesse/qualite pour la plupart des fichiers audio.",
    overrides: { model: "small", batchSize: "8", device: "auto" },
  },
  {
    id: "cpu_fast",
    label: "CPU rapide",
    description: "Pour machines sans GPU, priorite a la vitesse et a la stabilite.",
    overrides: {
      model: "base",
      device: "cpu",
      computeType: "int8",
      batchSize: "4",
      vadMethod: "silero",
    },
  },
  {
    id: "quality_gpu",
    label: "Qualite GPU",
    description: "Optimise precision (GPU requis, plus lent et plus gourmand).",
    overrides: { model: "large-v3", device: "cuda", computeType: "float16", batchSize: "8" },
  },
  {
    id: "meeting_diarize",
    label: "Reunion + speakers",
    description: "Active diarization, utile pour reunions/interviews multi-intervenants.",
    overrides: { model: "small", diarize: true, vadMethod: "pyannote", outputFormat: "all" },
  },
];

export const MIN_SEGMENT_DURATION_SEC = 0.02;
export const DEFAULT_INSERT_SEGMENT_DURATION_SEC = 3.0;
export const MIN_WAVEFORM_ZOOM = 1;
export const MAX_WAVEFORM_ZOOM = 200;
export const DEFAULT_KEYBOARD_SEEK_SEC = 1;
export const DEFAULT_EDITOR_HISTORY_LIMIT = 200;
export const MIN_EDITOR_HISTORY_LIMIT = 50;
export const MAX_EDITOR_HISTORY_LIMIT = 2000;
export const DEFAULT_DRAFT_AUTOSAVE_SEC = 8;
export const MIN_DRAFT_AUTOSAVE_SEC = 3;
export const MAX_DRAFT_AUTOSAVE_SEC = 120;
export const DEFAULT_QA_GAP_SEC = 1.2;
export const DEFAULT_QA_MIN_WPS = 1.2;
export const DEFAULT_QA_MAX_WPS = 5.5;

export const defaultExportRules: ExportTimingRules = {
  minDurationSec: 0.02,
  minGapSec: 0,
  fixOverlaps: true,
};

// ─── WX-719 : conventions d'annotation prédéfinies ───────────────────────────

export const BUILTIN_ANNOTATION_CONVENTIONS: readonly AnnotationConvention[] = [
  {
    id: "icor",
    label: "ICOR (ICAR Lyon)",
    description:
      "Convention de transcription de l'interaction orale ICOR (ICAR, Université Lyon 2). Pauses chronométrées, chevauchements, allongements, intonation.",
    isBuiltin: true,
    marks: [
      {
        id: "pause_0_2",
        label: "(0.2)",
        symbol: "(0.2)",
        category: "pause",
        shortcut: "1",
        description: "Pause 200 ms",
      },
      {
        id: "pause_0_5",
        label: "(0.5)",
        symbol: "(0.5)",
        category: "pause",
        shortcut: "2",
        description: "Pause 500 ms",
      },
      {
        id: "pause_1_0",
        label: "(1.0)",
        symbol: "(1.0)",
        category: "pause",
        shortcut: "3",
        description: "Pause 1 s",
      },
      {
        id: "micro_pause",
        label: "(°)",
        symbol: "(°)",
        category: "pause",
        description: "Micro-pause non mesurée",
      },
      {
        id: "overlap_open",
        label: "[",
        symbol: "[",
        category: "overlap",
        shortcut: "[",
        description: "Début chevauchement",
      },
      {
        id: "overlap_close",
        label: "]",
        symbol: "]",
        category: "overlap",
        shortcut: "]",
        description: "Fin chevauchement",
      },
      {
        id: "lengthening",
        label: "::",
        symbol: "::",
        category: "lengthening",
        shortcut: ":",
        description: "Allongement vocalique",
      },
      {
        id: "rising",
        label: "/",
        symbol: "/",
        category: "intonation",
        description: "Montée intonative",
      },
      {
        id: "falling",
        label: "\\",
        symbol: "\\",
        category: "intonation",
        description: "Descente intonative",
      },
      {
        id: "truncation",
        label: "mot-",
        symbol: "-",
        category: "truncation",
        description: "Troncation (à coller au mot tronqué)",
      },
      {
        id: "breath",
        label: "(h)",
        symbol: "(h)",
        category: "breath",
        description: "Aspiration / rire",
      },
    ],
  },
  {
    id: "chat",
    label: "CHAT (CHILDES / TalkBank)",
    description:
      "Convention CHAT du projet CHILDES / TalkBank. Marqueurs de reformulation, allongements, pauses, non-mots.",
    isBuiltin: true,
    marks: [
      {
        id: "pause_short",
        label: "(.)",
        symbol: "(.)",
        category: "pause",
        shortcut: "1",
        description: "Pause courte",
      },
      {
        id: "pause_medium",
        label: "(..)",
        symbol: "(..)",
        category: "pause",
        shortcut: "2",
        description: "Pause moyenne",
      },
      {
        id: "pause_long",
        label: "(...)",
        symbol: "(...)",
        category: "pause",
        shortcut: "3",
        description: "Pause longue",
      },
      {
        id: "retracing",
        label: "<mot> [/]",
        symbol: " [/]",
        category: "custom",
        description: "Reformulation simple (retracing)",
      },
      {
        id: "repetition",
        label: "<mot> [//]",
        symbol: " [//]",
        category: "custom",
        description: "Répétition (retracing with correction)",
      },
      {
        id: "lengthening",
        label: ":",
        symbol: ":",
        category: "lengthening",
        shortcut: ":",
        description: "Allongement (CHAT)",
      },
      {
        id: "overlap_open",
        label: "<",
        symbol: "<",
        category: "overlap",
        shortcut: "[",
        description: "Début recouvrement",
      },
      {
        id: "overlap_close",
        label: ">",
        symbol: ">",
        category: "overlap",
        shortcut: "]",
        description: "Fin recouvrement",
      },
      {
        id: "unintelligible",
        label: "xxx",
        symbol: "xxx",
        category: "custom",
        description: "Inaudible / inintelligible",
      },
      {
        id: "phono",
        label: "yyy",
        symbol: "yyy",
        category: "custom",
        description: "Phonologique non déchiffrable",
      },
    ],
  },
  {
    id: "minimal",
    label: "Minimaliste",
    description:
      "Jeu de marqueurs minimal pour annoter pauses, chevauchements et troncations sans convention formelle.",
    isBuiltin: true,
    marks: [
      {
        id: "pause",
        label: "(pause)",
        symbol: "(pause)",
        category: "pause",
        shortcut: "p",
        description: "Pause non chronométrée",
      },
      {
        id: "overlap",
        label: "//",
        symbol: "//",
        category: "overlap",
        shortcut: "/",
        description: "Chevauchement",
      },
      {
        id: "truncation",
        label: "-",
        symbol: "-",
        category: "truncation",
        shortcut: "-",
        description: "Troncation",
      },
      {
        id: "unintelligible",
        label: "[?]",
        symbol: "[?]",
        category: "custom",
        shortcut: "?",
        description: "Inaudible",
      },
    ],
  },
];

export const DEFAULT_ANNOTATION_CONVENTION_ID = "icor";
export const ANNOTATION_CONVENTION_STORAGE_KEY = "lx-active-convention";
