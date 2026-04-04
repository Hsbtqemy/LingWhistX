export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type JobFormStep = "import" | "configure";

/** Vues principales de l’application (navigation par onglets) */
export type StudioView = "hub" | "import" | "editor" | "player" | "settings";

// ─── WX-655 : sous-interfaces sémantiques ────────────────────────────────────
// La shape JSON sérialisée reste identique (intersections plates) — aucun impact
// sur le bridge Tauri, les modèles Rust ou le worker Python.

/** Modèle ASR et ressources de calcul. */
export type WhisperxModelOptions = {
  model?: string;
  language?: string;
  device?: string;
  computeType?: string;
  batchSize?: number;
};

/** Découpage pipeline, VAD, alignement et format de sortie. */
export type WhisperxPipelineOptions = {
  pipelineChunkSeconds?: number;
  pipelineChunkOverlapSeconds?: number;
  vadMethod?: string;
  noAlign?: boolean;
  outputFormat?: string;
  printProgress?: boolean;
  /** Chemin absolu vers un JSON v1 de timings mots (WX-607). */
  externalWordTimingsJson?: string;
  /** Exiger la correspondance token par token avec la transcription. */
  externalWordTimingsStrict?: boolean;
  /**
   * Modules pipeline audio optionnels (combinables). Clés canoniques : doc dans l’app
   * `/docs/pipeline-modules-multi-speaker.md`.
   */
  audioPipelineModules?: Record<string, unknown>;
  /**
   * WX-623 — plages `{ startSec, endSec, audioPipelineModules? }[]` ; concat ffmpeg après traitement par plage.
   */
  audioPipelineSegments?: unknown[];
  /** WX-670 — exporter un .eaf (ELAN 3.0) avec un tier par locuteur. */
  exportAnnotationEaf?: boolean;
  /** WX-670 — exporter un .TextGrid (Praat) avec un tier par locuteur. */
  exportAnnotationTextgrid?: boolean;
};

/** Diarisation et token HuggingFace. */
export type WhisperxDiarizationOptions = {
  diarize?: boolean;
  minSpeakers?: number;
  maxSpeakers?: number;
  forceNSpeakers?: number;
  hfToken?: string;
};

/** Analyse prosodique : pauses, IPU, tours de parole, stabilisation timestamps. */
export type WhisperxAnalysisOptions = {
  analysisPauseMin?: number;
  analysisPauseIgnoreBelow?: number;
  analysisPauseMax?: number;
  analysisIncludeNonspeech?: boolean;
  analysisNonspeechMinDuration?: number;
  analysisIpuMinWords?: number;
  analysisIpuMinDuration?: number;
  analysisIpuBridgeShortGapsUnder?: number;
  /** WX-605 — ex. `sport_duo` */
  analysisSpeakerTurnPostprocessPreset?: string;
  analysisSpeakerTurnMergeGapSecMax?: number;
  analysisSpeakerTurnSplitWordGapSec?: number;
  /** WX-606 — `detect` | `smooth` (omettre si off) */
  analysisWordTimestampStabilizeMode?: string;
  analysisWordTsNeighborRatioLow?: number;
  analysisWordTsNeighborRatioHigh?: number;
  analysisWordTsSmoothMaxSec?: number;
};

/**
 * Options complètes WhisperX — intersection des quatre catégories sémantiques.
 * Utiliser les sous-types pour des patches typés partiels (ex. `Partial<WhisperxAnalysisOptions>`).
 */
export type WhisperxOptions = WhisperxModelOptions &
  WhisperxPipelineOptions &
  WhisperxDiarizationOptions &
  WhisperxAnalysisOptions;

// ─── Variantes UI (champs formulaire — toujours string sauf booléens) ─────────

/** Variante formulaire — modèle et calcul. */
export type UiWhisperxModelOptions = {
  model: string;
  language: string;
  device: "auto" | "cpu" | "cuda";
  computeType: "default" | "float16" | "float32" | "int8";
  batchSize: string;
};

/** Variante formulaire — pipeline, VAD, alignement, sorties. */
export type UiWhisperxPipelineOptions = {
  pipelineChunkSeconds: string;
  pipelineChunkOverlapSeconds: string;
  vadMethod: "pyannote" | "silero";
  noAlign: boolean;
  /** `all` ou liste séparée par des virgules (ex. `json,srt,vtt`). `json` est toujours produit pour Studio. */
  outputFormat: string;
  printProgress: boolean;
  externalWordTimingsJson: string;
  externalWordTimingsStrict: boolean;
  /** Optionnel — pas de champ formulaire par défaut ; réservé API / extensions. */
  audioPipelineModules?: Record<string, unknown>;
  /**
   * Objet JSON texte (prioritaire sur `audioPipelineModules` si non vide et parse valide).
   * Voir `/docs/pipeline-modules-multi-speaker.md` dans l’app.
   */
  audioPipelineModulesJson: string;
  /** JSON tableau (prioritaire) : plages pipeline (WX-623). */
  audioPipelineSegmentsJson: string;
  /** WX-670 — exporter .eaf (ELAN 3.0). */
  exportAnnotationEaf: boolean;
  /** WX-670 — exporter .TextGrid (Praat). */
  exportAnnotationTextgrid: boolean;
};

/** Variante formulaire — diarisation et token HF. */
export type UiWhisperxDiarizationOptions = {
  diarize: boolean;
  minSpeakers: string;
  maxSpeakers: string;
  forceNSpeakers: string;
  hfToken: string;
};

/** Variante formulaire — analyse prosodique. */
export type UiWhisperxAnalysisOptions = {
  analysisPauseMin: string;
  analysisPauseIgnoreBelow: string;
  analysisPauseMax: string;
  analysisIncludeNonspeech: boolean;
  analysisNonspeechMinDuration: string;
  analysisIpuMinWords: string;
  analysisIpuMinDuration: string;
  analysisIpuBridgeShortGapsUnder: string;
  analysisSpeakerTurnPostprocessPreset: string;
  analysisSpeakerTurnMergeGapSecMax: string;
  analysisSpeakerTurnSplitWordGapSec: string;
  analysisWordTimestampStabilizeMode: "off" | "detect" | "smooth";
  analysisWordTsNeighborRatioLow: string;
  analysisWordTsNeighborRatioHigh: string;
  analysisWordTsSmoothMaxSec: string;
};

/** Options UI complètes — intersection des quatre catégories. */
export type UiWhisperxOptions = UiWhisperxModelOptions &
  UiWhisperxPipelineOptions &
  UiWhisperxDiarizationOptions &
  UiWhisperxAnalysisOptions;

/**
 * WX-661 — rapport d'évaluation qualité audio émis avant la transcription (type=audio_quality).
 * Tous les champs numériques peuvent être null si le décodage a échoué.
 */
export type AudioQualityReport = {
  /** Estimation SNR en dB (approche spectrale). null si non disponible. */
  snr_db: number | null;
  /** Proportion d'échantillons saturés [0, 1]. null si non disponible. */
  clipping_ratio: number | null;
  /** Proportion d'énergie identifiée comme parole [0, 1]. null si non disponible. */
  speech_ratio: number | null;
  /** Durée totale du fichier (secondes). */
  duration_sec: number | null;
  /** Durée estimée de parole (secondes). */
  speech_sec: number | null;
  /**
   * Codes d'avertissement :
   *   CLIPPING       — clipping_ratio > 0.001
   *   HIGH_NOISE     — snr_db < 15 dB
   *   LOW_SPEECH     — speech_ratio < 0.15
   *   DECODE_FAILED  — impossible de décoder l'audio
   *   ASSESS_UNAVAILABLE — module audio_assessment absent
   */
  warnings: string[];
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

// ─── WX-675/676 : Import annotations EAF / TextGrid ─────────────────────────

export type AnnotationSegment = {
  start: number;
  end: number;
  text: string;
};

export type AnnotationTier = {
  tierId: string;
  segments: AnnotationSegment[];
};

export type ImportAnnotationResult = {
  tiers: AnnotationTier[];
  mediaPath: string | null;
  durationS: number;
  sourceFormat: "eaf" | "textgrid";
  warnings: string[];
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
  /** WX-672 — Priorité P0 (highest) à P3 (lowest). Défaut P2. */
  priority?: 0 | 1 | 2 | 3;
  /** WX-672 — Position dans la file pour DnD (même priorité). */
  queueOrder?: number;
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
  /** WX-666 — Demucs disponible pour séparation sources. */
  demucsOk?: boolean;
  /** Version de Demucs détectée (undefined/null si absent). */
  demucsVersion?: string | null;
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

export type WordTimestamp = {
  word: string;
  start: number;
  end: number;
  score?: number | null;
};

export type EditableSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  words?: WordTimestamp[] | null;
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

// ─── WX-658 : patches structurés pour l'historique undo/redo ─────────────────
// Remplace les snapshots complets par des opérations inversibles.
// Mémoire : ~50 bytes par patch (text_change) vs ~25 KB par snapshot (500 segments).

export type TextChangePatch = {
  kind: "text_change";
  index: number;
  prevText: string;
  nextText: string;
};

export type TimingChangePatch = {
  kind: "timing_change";
  index: number;
  prevStart: number;
  prevEnd: number;
  nextStart: number;
  nextEnd: number;
};

export type SplitPatch = {
  kind: "split";
  /** Index du segment avant le split. */
  index: number;
  original: EditableSegment;
  left: EditableSegment;
  right: EditableSegment;
};

export type MergePatch = {
  kind: "merge";
  firstIndex: number;
  secondIndex: number;
  seg1: EditableSegment;
  seg2: EditableSegment;
  merged: EditableSegment;
};

export type LanguageChangePatch = {
  kind: "language_change";
  prevLanguage: string;
  nextLanguage: string;
};

export type SpeakerChangePatch = {
  kind: "speaker_change";
  index: number;
  prevSpeaker: string | null | undefined;
  nextSpeaker: string | null | undefined;
};

export type InsertSegmentPatch = {
  kind: "insert_segment";
  /** Index où le segment est inséré (0 = début). */
  index: number;
  segment: EditableSegment;
};

export type DeleteSegmentPatch = {
  kind: "delete_segment";
  index: number;
  segment: EditableSegment;
};

/** Union de toutes les mutations atomiques inversibles sur un `EditorSnapshot`. */
export type SegmentPatch =
  | TextChangePatch
  | TimingChangePatch
  | SplitPatch
  | MergePatch
  | LanguageChangePatch
  | SpeakerChangePatch
  | InsertSegmentPatch
  | DeleteSegmentPatch;

/**
 * Entrée d'historique undo/redo.
 * - `patch` : l'opération à appliquer pour aller vers l'état cible (économique en mémoire).
 * - `snapshot` : fallback pour les opérations non modélisées par un patch (multi-segment delete, etc.).
 */
export type HistoryEntry =
  | { kind: "patch"; patch: SegmentPatch }
  | { kind: "snapshot"; snapshot: EditorSnapshot };

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
  /**
   * WX-656 — surcharges partielles appliquées par-dessus `defaultWhisperxOptions`.
   * Seuls les champs définis ici remplacent le défaut ; les champs absents restent au défaut.
   */
  overrides: Partial<UiWhisperxOptions>;
  /** true pour les profils créés par l'utilisateur (persistés sur disque). */
  isUserProfile?: boolean;
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
  artifactFiles: string[];
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

/** Requête / réponse IPC `recompute_player_alerts` (WX-652). */
export type RecomputePlayerAlertsRequest = {
  runDir: string;
  t0Ms: number;
  t1Ms: number;
  longPauseMs: number;
  queryPreset: "standard" | "words_detail";
  speakers: string[];
};

export type RecomputePlayerAlertsStats = {
  nOverlapTurn: number;
  nLongPause: number;
  nTurnsInWindow: number;
  nPausesInWindow: number;
};

export type RecomputePlayerAlertsResponse = {
  alerts: Array<{
    id: string;
    kind: "overlap_turn" | "long_pause";
    startMs: number;
    message: string;
  }>;
  stats: RecomputePlayerAlertsStats;
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

// ─── WX-718 : import transcript direct (sans ASR) ────────────────────────────

export type CreateAnnotationRunRequest = {
  audioPath: string;
  /** Chemin vers un fichier SRT, VTT ou JSON de transcript. Null = run vide (annotations manuelles). */
  transcriptPath: string | null;
  outputDir: string;
  analysisOptions?: Partial<WhisperxAnalysisOptions>;
};

export type CreateAnnotationRunResponse = {
  runDir: string;
  runId: string;
  warnings: string[];
};

// ─── WX-719 : conventions d'annotation ───────────────────────────────────────

export type AnnotationMarkCategory =
  | "pause"
  | "overlap"
  | "lengthening"
  | "breath"
  | "intonation"
  | "truncation"
  | "custom";

export type AnnotationMark = {
  id: string;
  label: string;
  /** Symbole inséré dans le texte du segment. */
  symbol: string;
  /** Raccourci clavier optionnel (caractère unique ou combinaison). */
  shortcut?: string;
  category: AnnotationMarkCategory;
  description?: string;
};

export type AnnotationConvention = {
  id: string;
  label: string;
  description: string;
  isBuiltin?: boolean;
  marks: AnnotationMark[];
};

// ─── WX-726/727 : superpositions waveform (marqueurs + lanes + sélection) ────

export type WaveformMarkerToggles = {
  longPauses: boolean;
  overlaps: boolean;
  speakerChanges: boolean;
  lowConfWords: boolean;
};

export type WaveformLaneToggles = {
  speechRate: boolean;
  density: boolean;
  confidence: boolean;
};

/** Données événements passées au canvas pour dessiner marqueurs et lanes. */
export type WaveformOverlayData = {
  pauses: EventPauseRow[];
  turns: EventTurnRow[];
  words: EventWordRow[];
  ipus: EventIpuRow[];
  longPauseMs: number;
  durationMs: number;
};
