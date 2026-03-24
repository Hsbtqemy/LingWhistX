import type { ExportTimingRules, ProfilePreset, UiWhisperxOptions } from "./types";

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
};

export const profilePresets: ProfilePreset[] = [
  {
    id: "balanced",
    label: "Equilibre (recommande)",
    description: "Bon compromis vitesse/qualite pour la plupart des fichiers audio.",
    options: { ...defaultWhisperxOptions, model: "small", batchSize: "8", device: "auto" },
  },
  {
    id: "cpu_fast",
    label: "CPU rapide",
    description: "Pour machines sans GPU, priorite a la vitesse et a la stabilite.",
    options: {
      ...defaultWhisperxOptions,
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
    options: {
      ...defaultWhisperxOptions,
      model: "large-v3",
      device: "cuda",
      computeType: "float16",
      batchSize: "8",
    },
  },
  {
    id: "meeting_diarize",
    label: "Reunion + speakers",
    description: "Active diarization, utile pour reunions/interviews multi-intervenants.",
    options: {
      ...defaultWhisperxOptions,
      model: "small",
      diarize: true,
      vadMethod: "pyannote",
      outputFormat: "all",
    },
  },
];

export const MIN_SEGMENT_DURATION_SEC = 0.02;
export const MIN_WAVEFORM_ZOOM = 1;
export const MAX_WAVEFORM_ZOOM = 20;
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
