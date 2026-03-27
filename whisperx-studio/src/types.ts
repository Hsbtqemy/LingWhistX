export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type JobFormStep = "import" | "configure";

/** Vues principales de l’application (navigation par onglets) */
export type StudioView = "create" | "workspace" | "player" | "about";

export type WhisperxOptions = {
  model?: string;
  language?: string;
  device?: string;
  computeType?: string;
  batchSize?: number;
  pipelineChunkSeconds?: number;
  pipelineChunkOverlapSeconds?: number;
  diarize?: boolean;
  minSpeakers?: number;
  maxSpeakers?: number;
  forceNSpeakers?: number;
  analysisPauseMin?: number;
  analysisPauseIgnoreBelow?: number;
  analysisPauseMax?: number;
  analysisIncludeNonspeech?: boolean;
  analysisNonspeechMinDuration?: number;
  analysisIpuMinWords?: number;
  analysisIpuMinDuration?: number;
  analysisIpuBridgeShortGapsUnder?: number;
  hfToken?: string;
  outputFormat?: string;
  noAlign?: boolean;
  /** Chemin absolu vers un JSON v1 de timings mots (WX-607). */
  externalWordTimingsJson?: string;
  /** Exiger la correspondance token par token avec la transcription. */
  externalWordTimingsStrict?: boolean;
  vadMethod?: string;
  printProgress?: boolean;
  /** WX-605 — ex. `sport_duo` */
  analysisSpeakerTurnPostprocessPreset?: string;
  analysisSpeakerTurnMergeGapSecMax?: number;
  analysisSpeakerTurnSplitWordGapSec?: number;
  /** WX-606 — `detect` | `smooth` (omettre si off) */
  analysisWordTimestampStabilizeMode?: string;
  analysisWordTsNeighborRatioLow?: number;
  analysisWordTsNeighborRatioHigh?: number;
  analysisWordTsSmoothMaxSec?: number;
  /**
   * Modules pipeline audio optionnels (combinables). Clés canoniques : doc dans l’app
   * `/docs/pipeline-modules-multi-speaker.md` (copie de `audit/pipeline-modules-multi-speaker.md`).
   */
  audioPipelineModules?: Record<string, unknown>;
  /**
   * WX-623 — plages `{ startSec, endSec, audioPipelineModules? }[]` ; concat ffmpeg après traitement par plage.
   */
  audioPipelineSegments?: unknown[];
};

export type UiWhisperxOptions = {
  model: string;
  language: string;
  device: "auto" | "cpu" | "cuda";
  computeType: "default" | "float16" | "float32" | "int8";
  batchSize: string;
  pipelineChunkSeconds: string;
  pipelineChunkOverlapSeconds: string;
  diarize: boolean;
  minSpeakers: string;
  maxSpeakers: string;
  forceNSpeakers: string;
  analysisPauseMin: string;
  analysisPauseIgnoreBelow: string;
  analysisPauseMax: string;
  analysisIncludeNonspeech: boolean;
  analysisNonspeechMinDuration: string;
  analysisIpuMinWords: string;
  analysisIpuMinDuration: string;
  analysisIpuBridgeShortGapsUnder: string;
  hfToken: string;
  outputFormat: "all" | "json" | "srt" | "vtt" | "txt" | "tsv" | "aud";
  noAlign: boolean;
  externalWordTimingsJson: string;
  externalWordTimingsStrict: boolean;
  vadMethod: "pyannote" | "silero";
  printProgress: boolean;
  analysisSpeakerTurnPostprocessPreset: string;
  analysisSpeakerTurnMergeGapSecMax: string;
  analysisSpeakerTurnSplitWordGapSec: string;
  analysisWordTimestampStabilizeMode: "off" | "detect" | "smooth";
  analysisWordTsNeighborRatioLow: string;
  analysisWordTsNeighborRatioHigh: string;
  analysisWordTsSmoothMaxSec: string;
  /** Optionnel — pas de champ formulaire par défaut ; réservé API / extensions. */
  audioPipelineModules?: Record<string, unknown>;
  /**
   * Objet JSON texte (prioritaire sur `audioPipelineModules` si non vide et parse valide).
   * Voir `/docs/pipeline-modules-multi-speaker.md` dans l’app (source `audit/…` dans le dépôt).
   */
  audioPipelineModulesJson: string;
  /**
   * JSON tableau (prioritaire) : plages pipeline (WX-623) — même doc que ci-dessus.
   */
  audioPipelineSegmentsJson: string;
};

/** Segment ASR émis en direct (stage `wx_live_transcript`, message JSON côté worker). */
export type LiveTranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

/** Bannière « Restaurer la session précédente » (dernier job consulté, localStorage). */
export type SessionRestorePrompt = {
  jobId: string;
  label: string;
};

export type Job = {
  id: string;
  inputPath: string;
  outputDir: string;
  mode: "mock" | "whisperx" | "analyze_only";
  status: JobStatus;
  progress: number;
  message: string;
  createdAtMs: number;
  updatedAtMs: number;
  error?: string | null;
  outputFiles: string[];
  whisperxOptions?: WhisperxOptions | null;
  /** Segments ASR persistés (SQLite) — rechargés au démarrage / liste jobs. */
  liveTranscriptSegments?: LiveTranscriptSegment[];
};

export type JobsPaginationInfo = {
  hasMore: boolean;
  totalInDb: number;
  nextDbOffset: number;
};

export type LoadMoreJobsResult = {
  mergedCount: number;
  hasMore: boolean;
  nextDbOffset: number;
  totalInDb: number;
};

export type JobLogEvent = {
  jobId: string;
  tsMs: number;
  stream: string;
  level: string;
  stage?: string | null;
  message: string;
};

export type RuntimeStatus = {
  pythonCommand: string;
  pythonOk: boolean;
  whisperxOk: boolean;
  ffmpegOk: boolean;
  whisperxVersion?: string | null;
  details: string[];
  /** `sys.platform` côté Python (darwin, win32, linux, …). */
  pythonPlatform?: string | null;
  torchCudaAvailable?: boolean;
  torchMpsAvailable?: boolean;
  /** Défaut identique au CLI WhisperX : cuda ou cpu (faster-whisper n’utilise pas MPS). */
  whisperxDefaultDevice?: string | null;
};

export type RuntimeSetupStatus = {
  running: boolean;
};

export type RuntimeSetupLogEvent = {
  tsMs: number;
  stream: string;
  message: string;
};

export type RuntimeSetupFinishedEvent = {
  success: boolean;
  message: string;
};

export type WaveformPeaks = {
  sourcePath: string;
  durationSec: number;
  binsPerSecond: number;
  sampleRate: number;
  peaks: number[];
  generatedAtMs: number;
  cached: boolean;
};

export type WaveformTaskStarted = {
  taskId: string;
  path: string;
};

export type WaveformProgressEvent = {
  taskId: string;
  path: string;
  progress: number;
  message: string;
};

export type WaveformReadyEvent = {
  taskId: string;
  path: string;
  peaks: WaveformPeaks;
};

export type WaveformErrorEvent = {
  taskId: string;
  path: string;
  error: string;
};

export type WaveformCancelledEvent = {
  taskId: string;
  path: string;
  message: string;
};

export type ExportTimingRules = {
  minDurationSec: number;
  minGapSec: number;
  fixOverlaps: boolean;
};

export type ExportCorrectionReport = {
  inputSegments: number;
  outputSegments: number;
  minDurationSec: number;
  minGapSec: number;
  fixOverlaps: boolean;
  reorderedSegments: boolean;
  overlapsFixed: number;
  minGapAdjustments: number;
  minDurationAdjustments: number;
  totalAdjustments: number;
  notes: string[];
};

export type ExportTranscriptResponse = {
  outputPath: string;
  report: ExportCorrectionReport;
};

/** Réponse `export_run_timing_pack` (Player / run — JSON + SRT + CSV). */
export type ExportRunTimingPackResponse = {
  sourcePath: string;
  lastOutputPath: string;
  report: ExportCorrectionReport;
};

export type SegmentEdge = "start" | "end";

export type SegmentDragState = {
  segmentIndex: number;
  edge: SegmentEdge;
};

export type EditableSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
};

/** Segment mis en avant pour l’alignement waveform / transcript */
export type FocusedSegmentInfo = {
  index: number;
  segment: EditableSegment;
  distanceSec: number;
};

export type TranscriptDocument = {
  path: string;
  language?: string | null;
  segments: EditableSegment[];
};

export type TranscriptDraftDocument = {
  sourcePath: string;
  draftPath: string;
  updatedAtMs: number;
  language?: string | null;
  segments: EditableSegment[];
};

export type SaveDraftRequest = {
  path: string;
  language?: string | null;
  segments: EditableSegment[];
};

export type SaveDraftResponse = {
  draftPath: string;
  updatedAtMs: number;
};

export type TranscriptQaIssueType =
  | "invalid_duration"
  | "overlap"
  | "gap"
  | "speech_rate_high"
  | "speech_rate_low"
  | "empty_text";

export type TranscriptQaIssue = {
  id: string;
  type: TranscriptQaIssueType;
  severity: "error" | "warning";
  segmentIndex: number;
  relatedSegmentIndex?: number;
  message: string;
  canAutoFix: boolean;
};

export type EditorSnapshot = {
  language: string;
  segments: EditableSegment[];
};

export type CreateJobRequest = {
  inputPath: string;
  outputDir?: string | null;
  mode?: "mock" | "whisperx" | "analyze_only";
  whisperxOptions?: WhisperxOptions;
};

export type ProfilePreset = {
  id: string;
  label: string;
  description: string;
  options: UiWhisperxOptions;
};

/** Résumé `run_manifest.json` (WX-611), aligné sur la commande Tauri `read_run_manifest_summary`. */
export type RunManifestSummary = {
  runDir: string;
  manifestPath: string;
  schemaVersion: number;
  runId: string;
  createdAt?: string | null;
  inputMediaPath?: string | null;
  inputMediaResolved?: string | null;
  durationSec?: number | null;
  artifactCount: number;
  artifactKeys: string[];
  warnings: string[];
  statsNSegments?: number | null;
  statsNWords?: number | null;
  statsNSpeakerTurns?: number | null;
  statsNPauses?: number | null;
  statsNIpus?: number | null;
};

export type RecentRunEntry = {
  runDir: string;
  runId: string;
  lastOpenedAtMs: number;
};

/** Résultat `import_run_events` (WX-612). */
export type RunEventsImportResult = {
  runDir: string;
  dbPath: string;
  schemaVersion: number;
  nWords: number;
  nTurns: number;
  nPauses: number;
  nIpus: number;
  sourceTimeline: string;
};

/** Plafonds par défaut alignés sur `run_events.rs` (WX-613). */
export const QUERY_WINDOW_DEFAULT_MAX = {
  words: 5000,
  turns: 2000,
  pauses: 2000,
  ipus: 2000,
} as const;

export type QueryWindowLayers = {
  words?: boolean;
  turns?: boolean;
  pauses?: boolean;
  ipus?: boolean;
};

export type QueryWindowLimits = {
  maxWords?: number;
  maxTurns?: number;
  maxPauses?: number;
  maxIpus?: number;
};

/** Requête `query_run_events_window` — fenêtre `[t0Ms, t1Ms)` en ms, overlap standard. */
export type QueryWindowRequest = {
  runDir: string;
  t0Ms: number;
  t1Ms: number;
  layers?: QueryWindowLayers;
  speakers?: string[];
  limits?: QueryWindowLimits;
};

export type QueryWindowTruncated = {
  words: boolean;
  turns: boolean;
  pauses: boolean;
  ipus: boolean;
};

export type EventWordRow = {
  id: number;
  startMs: number;
  endMs: number;
  speaker?: string | null;
  token?: string | null;
  flagsJson?: string | null;
  confidence?: number | null;
  wordId?: string | null;
  chunkId?: string | null;
  alignmentStatus?: string | null;
};

export type EventTurnRow = {
  id: number;
  startMs: number;
  endMs: number;
  speaker: string;
  turnId?: string | null;
  flagsJson?: string | null;
  confidence?: number | null;
};

export type EventPauseRow = {
  id: number;
  startMs: number;
  endMs: number;
  durMs: number;
  type?: string | null;
  speaker?: string | null;
  flagsJson?: string | null;
};

export type EventIpuRow = {
  id: number;
  startMs: number;
  endMs: number;
  durMs: number;
  nWords: number;
  speaker?: string | null;
  text?: string | null;
  flagsJson?: string | null;
};

export type QueryWindowResult = {
  runDir: string;
  t0Ms: number;
  t1Ms: number;
  words: EventWordRow[];
  turns: EventTurnRow[];
  pauses: EventPauseRow[];
  ipus: EventIpuRow[];
  truncated: QueryWindowTruncated;
};

/** Résultat `build_waveform_pyramid` (WX-614, format WXENV1). */
export type WaveformPyramidBuilt = {
  sourcePath: string;
  sampleRate: number;
  durationSec: number;
  totalSamples: number;
  cacheDir: string;
  levelPaths: string[];
  schema: string;
  generatedAtMs: number;
};

/** Métadonnées `read_wxenv_meta`. */
export type WxenvMeta = {
  sampleRate: number;
  blockSize: number;
  nBlocks: number;
};

/** Tranche `read_wxenv_slice` pour le canvas détail (WX-615). */
export type WxenvSliceRead = {
  sampleRate: number;
  blockSize: number;
  nBlocks: number;
  startBlock: number;
  returnedBlocks: number;
  minMax: number[];
};

/** Enveloppe chargée pour une fenêtre visible (un niveau Lk). */
export type WaveformDetailEnvelope = {
  level: number;
  path: string;
  sampleRate: number;
  blockSize: number;
  startBlock: number;
  returnedBlocks: number;
  nBlocks: number;
  minMax: number[];
};

/** Données agrégées pour la bande overview (L3 ou L4). */
export type WaveformOverviewEnvelope = {
  minMax: number[];
  sampleRate: number;
  blockSize: number;
  nBlocks: number;
  levelIndex: 3 | 4;
};

/**
 * Toggles calques Explorer — persistés session (`studioExplorerLayers`).
 * `query_run_events_window` ne filtre que words / turns / pauses / ipus ; les autres clés sont
 * réservées (UI masquée tant que non branchées, WX-631).
 */
export type ExplorerLayerToggles = {
  turns: boolean;
  pauses: boolean;
  ipus: boolean;
  /** Réservé — pas de couche overlap dans la requête fenêtre pour l’instant. */
  overlap: boolean;
  words: boolean;
  /** Réservé — zoom auto mots sur la timeline Explorer. */
  wordsAutoZoom: boolean;
  /** Réservé — segments comme couche distincte dans la requête fenêtre. */
  segments: boolean;
};

/** Config `recalc_pauses_ipu` (WX-617). */
export type RecalcPausesIpuConfig = {
  minPauseSec: number;
  ignoreBelowSec: number;
  pauseMaxSec?: number | null;
  ipuMinWords: number;
  ipuMinDurationSec: number;
};

export type RecalcPausesIpuStats = {
  nPauses: number;
  pauseDurationMeanMs: number;
  pauseDurationP95Ms: number;
  nIpus: number;
  overlapTotalMs: number;
};

export type RecalcPausesIpuResult = {
  runDir: string;
  stats: RecalcPausesIpuStats;
  persisted: boolean;
};
