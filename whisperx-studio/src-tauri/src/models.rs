use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WhisperxOptions {
    pub(crate) model: Option<String>,
    pub(crate) language: Option<String>,
    pub(crate) device: Option<String>,
    pub(crate) compute_type: Option<String>,
    pub(crate) batch_size: Option<u32>,
    pub(crate) pipeline_chunk_seconds: Option<f64>,
    pub(crate) pipeline_chunk_overlap_seconds: Option<f64>,
    pub(crate) diarize: Option<bool>,
    pub(crate) min_speakers: Option<u32>,
    pub(crate) max_speakers: Option<u32>,
    pub(crate) force_n_speakers: Option<u32>,
    pub(crate) analysis_pause_min: Option<f64>,
    pub(crate) analysis_pause_ignore_below: Option<f64>,
    pub(crate) analysis_pause_max: Option<f64>,
    pub(crate) analysis_include_nonspeech: Option<bool>,
    pub(crate) analysis_nonspeech_min_duration: Option<f64>,
    pub(crate) analysis_ipu_min_words: Option<u32>,
    pub(crate) analysis_ipu_min_duration: Option<f64>,
    pub(crate) analysis_ipu_bridge_short_gaps_under: Option<f64>,
    pub(crate) hf_token: Option<String>,
    pub(crate) output_format: Option<String>,
    pub(crate) no_align: Option<bool>,
    pub(crate) external_word_timings_json: Option<String>,
    pub(crate) external_word_timings_strict: Option<bool>,
    pub(crate) vad_method: Option<String>,
    pub(crate) print_progress: Option<bool>,
    /// WX-605 — post-traitement `speaker_turns` (preset CLI).
    pub(crate) analysis_speaker_turn_postprocess_preset: Option<String>,
    pub(crate) analysis_speaker_turn_merge_gap_sec_max: Option<f64>,
    pub(crate) analysis_speaker_turn_split_word_gap_sec: Option<f64>,
    /// WX-606 — stabilisation timestamps mots : off | detect | smooth.
    pub(crate) analysis_word_timestamp_stabilize_mode: Option<String>,
    pub(crate) analysis_word_ts_neighbor_ratio_low: Option<f64>,
    pub(crate) analysis_word_ts_neighbor_ratio_high: Option<f64>,
    pub(crate) analysis_word_ts_smooth_max_sec: Option<f64>,
    /// Modules pipeline audio optionnels (prétraitement, VAD, QC, …) — JSON libre, voir `audit/pipeline-modules-multi-speaker.md`.
    #[serde(default)]
    pub(crate) audio_pipeline_modules: Option<serde_json::Value>,
    /// WX-623 — plages temporelles `{ startSec, endSec, audioPipelineModules? }[]` ; extraction ffmpeg puis pipeline par plage puis concat.
    #[serde(default)]
    pub(crate) audio_pipeline_segments: Option<serde_json::Value>,
}

/// Segment ASR temps-réel (type `live_transcript`, persisté en SQLite pour rechargement UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveTranscriptSegment {
    pub(crate) start: f64,
    pub(crate) end: f64,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Job {
    pub(crate) id: String,
    pub(crate) input_path: String,
    pub(crate) output_dir: String,
    pub(crate) mode: String,
    pub(crate) status: String,
    pub(crate) progress: u8,
    pub(crate) message: String,
    pub(crate) created_at_ms: u64,
    pub(crate) updated_at_ms: u64,
    pub(crate) error: Option<String>,
    pub(crate) output_files: Vec<String>,
    pub(crate) whisperx_options: Option<WhisperxOptions>,
    #[serde(default)]
    pub(crate) live_transcript_segments: Vec<LiveTranscriptSegment>,
    /// WX-672 — Priorité P0 (highest) à P3 (lowest). Défaut P2.
    #[serde(default = "default_job_priority")]
    pub(crate) priority: u8,
    /// WX-672 — Ordre dans la file pour DnD à priorité égale.
    #[serde(default)]
    pub(crate) queue_order: i64,
}

fn default_job_priority() -> u8 {
    2
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateJobRequest {
    pub(crate) input_path: String,
    pub(crate) output_dir: Option<String>,
    pub(crate) mode: Option<String>,
    pub(crate) whisperx_options: Option<WhisperxOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerResult {
    pub(crate) message: Option<String>,
    #[serde(default, alias = "output_files")]
    pub(crate) output_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerLog {
    pub(crate) level: Option<String>,
    pub(crate) stage: Option<String>,
    pub(crate) message: String,
    pub(crate) progress: Option<u8>,
}

/// WX-657 — erreur structurée émise par le worker avec code machine-readable.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerErrorMsg {
    /// Code machine-readable : OOM, HF_GATED, HF_AUTH, SSL, NETWORK, …
    pub(crate) code: Option<String>,
    pub(crate) message: String,
}

/// WX-661 — rapport d'évaluation qualité audio émis avant la transcription.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct AudioQualityReport {
    pub(crate) snr_db: Option<f64>,
    pub(crate) clipping_ratio: Option<f64>,
    pub(crate) speech_ratio: Option<f64>,
    pub(crate) duration_sec: Option<f64>,
    pub(crate) speech_sec: Option<f64>,
    pub(crate) warnings: Vec<String>,
}

/// Message JSON-lines structuré émis par le worker Python (champ `type` discriminant).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum WorkerMessage {
    /// Progression / log de pipeline.
    Progress(WorkerLog),
    /// Résultat final avec fichiers de sortie.
    Result(WorkerResult),
    /// Erreur structurée avec code machine-readable.
    Error(WorkerErrorMsg),
    /// Segment de transcription en direct.
    LiveTranscript(LiveTranscriptSegment),
    /// WX-661 — rapport qualité audio avant transcription.
    AudioQuality(AudioQualityReport),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobLogEvent {
    pub(crate) job_id: String,
    pub(crate) ts_ms: u64,
    pub(crate) stream: String,
    pub(crate) level: String,
    pub(crate) stage: Option<String>,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTimestamp {
    pub(crate) word: String,
    pub(crate) start: f64,
    pub(crate) end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditableSegment {
    pub(crate) start: f64,
    pub(crate) end: f64,
    pub(crate) text: String,
    pub(crate) speaker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) words: Option<Vec<WordTimestamp>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscriptDocument {
    pub(crate) path: String,
    pub(crate) language: Option<String>,
    pub(crate) segments: Vec<EditableSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscriptDraftDocument {
    pub(crate) source_path: String,
    pub(crate) draft_path: String,
    pub(crate) updated_at_ms: u64,
    pub(crate) language: Option<String>,
    pub(crate) segments: Vec<EditableSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveTranscriptRequest {
    pub(crate) path: String,
    pub(crate) language: Option<String>,
    pub(crate) segments: Vec<EditableSegment>,
    pub(crate) overwrite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveTranscriptDraftRequest {
    pub(crate) path: String,
    pub(crate) language: Option<String>,
    pub(crate) segments: Vec<EditableSegment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveTranscriptDraftResponse {
    pub(crate) draft_path: String,
    pub(crate) updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportTranscriptRequest {
    pub(crate) path: String,
    pub(crate) language: Option<String>,
    pub(crate) segments: Vec<EditableSegment>,
    pub(crate) format: String,
    pub(crate) rules: Option<ExportTimingRules>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportTimingRules {
    pub(crate) min_duration_sec: Option<f64>,
    pub(crate) min_gap_sec: Option<f64>,
    pub(crate) fix_overlaps: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportCorrectionReport {
    pub(crate) input_segments: usize,
    pub(crate) output_segments: usize,
    pub(crate) min_duration_sec: f64,
    pub(crate) min_gap_sec: f64,
    pub(crate) fix_overlaps: bool,
    pub(crate) reordered_segments: bool,
    pub(crate) overlaps_fixed: u32,
    pub(crate) min_gap_adjustments: u32,
    pub(crate) min_duration_adjustments: u32,
    pub(crate) total_adjustments: u32,
    pub(crate) notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportTranscriptResponse {
    pub(crate) output_path: String,
    pub(crate) report: ExportCorrectionReport,
}

/// Export JSON + SRT + CSV depuis un dossier de run (manifest → `timeline_json` ou `run_json`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportRunTimingPackRequest {
    pub(crate) run_dir: String,
    pub(crate) rules: Option<ExportTimingRules>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportRunTimingPackResponse {
    pub(crate) source_path: String,
    pub(crate) last_output_path: String,
    pub(crate) report: ExportCorrectionReport,
}

#[derive(Default)]
pub(crate) struct JobsState {
    pub(crate) jobs: Arc<Mutex<HashMap<String, Job>>>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct JobsPaginationMeta {
    pub(crate) next_db_offset: i64,
    pub(crate) total_in_db: i64,
}

pub(crate) struct JobsPaginationState {
    pub(crate) inner: Mutex<JobsPaginationMeta>,
}

impl Default for JobsPaginationState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(JobsPaginationMeta::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobsPaginationInfo {
    pub(crate) has_more: bool,
    pub(crate) total_in_db: i64,
    pub(crate) next_db_offset: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadMoreJobsResult {
    pub(crate) merged_count: usize,
    pub(crate) has_more: bool,
    pub(crate) next_db_offset: i64,
    pub(crate) total_in_db: i64,
}

pub(crate) struct DbState {
    pub(crate) path: Arc<PathBuf>,
}

#[derive(Default)]
pub(crate) struct RuntimeState {
    pub(crate) running_pids: Arc<Mutex<HashMap<String, u32>>>,
}

#[derive(Default)]
pub(crate) struct RuntimeSetupState {
    pub(crate) running: Arc<Mutex<bool>>,
}

#[derive(Default)]
pub(crate) struct FfmpegInstallState {
    pub(crate) running: Arc<Mutex<bool>>,
}

#[derive(Default)]
pub(crate) struct WaveformTaskState {
    pub(crate) running_pids: Arc<Mutex<HashMap<String, u32>>>,
    pub(crate) cancelled_task_ids: Arc<Mutex<HashSet<String>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TorchProbeResult {
    pub(crate) platform: String,
    pub(crate) torch_cuda: bool,
    pub(crate) torch_mps: bool,
    pub(crate) whisperx_default_device: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeStatus {
    pub(crate) python_command: String,
    pub(crate) python_ok: bool,
    pub(crate) whisperx_ok: bool,
    pub(crate) ffmpeg_ok: bool,
    pub(crate) whisperx_version: Option<String>,
    pub(crate) details: Vec<String>,
    /// `sys.platform` côté Python (ex. darwin, win32, linux).
    pub(crate) python_platform: Option<String>,
    pub(crate) torch_cuda_available: bool,
    pub(crate) torch_mps_available: bool,
    /// Comme le défaut CLI WhisperX : `cuda` si CUDA dispo, sinon `cpu` (faster-whisper n’utilise pas MPS).
    pub(crate) whisperx_default_device: Option<String>,
    /// WX-666 — Demucs disponible pour séparation sources.
    pub(crate) demucs_ok: bool,
    /// Version de Demucs détectée (None si absent).
    pub(crate) demucs_version: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedFfmpegTools {
    pub(crate) ffmpeg_command: String,
    pub(crate) ffprobe_command: String,
    pub(crate) ffmpeg_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WaveformPeaks {
    pub(crate) source_path: String,
    pub(crate) duration_sec: f64,
    pub(crate) bins_per_second: u32,
    pub(crate) sample_rate: u32,
    pub(crate) peaks: Vec<f32>,
    pub(crate) generated_at_ms: u64,
    pub(crate) cached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WaveformTaskStarted {
    pub(crate) task_id: String,
    pub(crate) path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WaveformProgressEvent {
    pub(crate) task_id: String,
    pub(crate) path: String,
    pub(crate) progress: u8,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WaveformReadyEvent {
    pub(crate) task_id: String,
    pub(crate) path: String,
    pub(crate) peaks: WaveformPeaks,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WaveformErrorEvent {
    pub(crate) task_id: String,
    pub(crate) path: String,
    pub(crate) error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WaveformCancelledEvent {
    pub(crate) task_id: String,
    pub(crate) path: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeSetupLogEvent {
    pub(crate) ts_ms: u64,
    pub(crate) stream: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeSetupFinishedEvent {
    pub(crate) success: bool,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeSetupStatus {
    pub(crate) running: bool,
}
