use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};

const LOG_PREFIX: &str = "__WXLOG__";
const RESULT_PREFIX: &str = "__WXRESULT__";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WhisperxOptions {
    model: Option<String>,
    language: Option<String>,
    device: Option<String>,
    compute_type: Option<String>,
    batch_size: Option<u32>,
    diarize: Option<bool>,
    hf_token: Option<String>,
    output_format: Option<String>,
    no_align: Option<bool>,
    vad_method: Option<String>,
    print_progress: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    input_path: String,
    output_dir: String,
    mode: String,
    status: String,
    progress: u8,
    message: String,
    created_at_ms: u64,
    updated_at_ms: u64,
    error: Option<String>,
    output_files: Vec<String>,
    whisperx_options: Option<WhisperxOptions>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateJobRequest {
    input_path: String,
    output_dir: Option<String>,
    mode: Option<String>,
    whisperx_options: Option<WhisperxOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResult {
    message: Option<String>,
    output_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerLog {
    level: Option<String>,
    stage: Option<String>,
    message: String,
    progress: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobLogEvent {
    job_id: String,
    ts_ms: u64,
    stream: String,
    level: String,
    stage: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditableSegment {
    start: f64,
    end: f64,
    text: String,
    speaker: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptDocument {
    path: String,
    language: Option<String>,
    segments: Vec<EditableSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptDraftDocument {
    source_path: String,
    draft_path: String,
    updated_at_ms: u64,
    language: Option<String>,
    segments: Vec<EditableSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptRequest {
    path: String,
    language: Option<String>,
    segments: Vec<EditableSegment>,
    overwrite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptDraftRequest {
    path: String,
    language: Option<String>,
    segments: Vec<EditableSegment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptDraftResponse {
    draft_path: String,
    updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportTranscriptRequest {
    path: String,
    language: Option<String>,
    segments: Vec<EditableSegment>,
    format: String,
    rules: Option<ExportTimingRules>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportTimingRules {
    min_duration_sec: Option<f64>,
    min_gap_sec: Option<f64>,
    fix_overlaps: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportCorrectionReport {
    input_segments: usize,
    output_segments: usize,
    min_duration_sec: f64,
    min_gap_sec: f64,
    fix_overlaps: bool,
    reordered_segments: bool,
    overlaps_fixed: u32,
    min_gap_adjustments: u32,
    min_duration_adjustments: u32,
    total_adjustments: u32,
    notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportTranscriptResponse {
    output_path: String,
    report: ExportCorrectionReport,
}

#[derive(Default)]
struct JobsState {
    jobs: Arc<Mutex<HashMap<String, Job>>>,
}

struct DbState {
    path: Arc<PathBuf>,
}

#[derive(Default)]
struct RuntimeState {
    running_pids: Arc<Mutex<HashMap<String, u32>>>,
}

#[derive(Default)]
struct RuntimeSetupState {
    running: Arc<Mutex<bool>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    python_command: String,
    python_ok: bool,
    whisperx_ok: bool,
    ffmpeg_ok: bool,
    whisperx_version: Option<String>,
    details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaveformPeaks {
    source_path: String,
    duration_sec: f64,
    bins_per_second: u32,
    sample_rate: u32,
    peaks: Vec<f32>,
    generated_at_ms: u64,
    cached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSetupLogEvent {
    ts_ms: u64,
    stream: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSetupFinishedEvent {
    success: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSetupStatus {
    running: bool,
}

fn now_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Unable to create app local data dir: {err}"))?;
    Ok(data_dir.join("whisperx-studio-jobs.sqlite3"))
}

fn init_database(path: &Path) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|err| format!("DB open failed: {err}"))?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          input_path TEXT NOT NULL,
          output_dir TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL,
          message TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          error TEXT,
          output_files TEXT NOT NULL,
          whisperx_options TEXT
        );
        ",
    )
    .map_err(|err| format!("DB init failed: {err}"))?;
    Ok(())
}

fn persist_job(db_path: &Path, job: &Job) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|err| format!("DB open failed: {err}"))?;
    let output_files_json = serde_json::to_string(&job.output_files)
        .map_err(|err| format!("Serialize output_files failed: {err}"))?;
    let whisperx_options_json = job
        .whisperx_options
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| format!("Serialize whisperx_options failed: {err}"))?;

    conn.execute(
        "
        INSERT INTO jobs (
          id, input_path, output_dir, mode, status, progress,
          message, created_at_ms, updated_at_ms, error,
          output_files, whisperx_options
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6,
          ?7, ?8, ?9, ?10,
          ?11, ?12
        )
        ON CONFLICT(id) DO UPDATE SET
          input_path = excluded.input_path,
          output_dir = excluded.output_dir,
          mode = excluded.mode,
          status = excluded.status,
          progress = excluded.progress,
          message = excluded.message,
          created_at_ms = excluded.created_at_ms,
          updated_at_ms = excluded.updated_at_ms,
          error = excluded.error,
          output_files = excluded.output_files,
          whisperx_options = excluded.whisperx_options
        ",
        params![
            job.id,
            job.input_path,
            job.output_dir,
            job.mode,
            job.status,
            i64::from(job.progress),
            job.message,
            job.created_at_ms as i64,
            job.updated_at_ms as i64,
            job.error,
            output_files_json,
            whisperx_options_json
        ],
    )
    .map_err(|err| format!("Persist job failed: {err}"))?;

    Ok(())
}

fn load_jobs(db_path: &Path) -> Result<Vec<Job>, String> {
    let conn = Connection::open(db_path).map_err(|err| format!("DB open failed: {err}"))?;
    let mut statement = conn
        .prepare(
            "
            SELECT id, input_path, output_dir, mode, status, progress,
                   message, created_at_ms, updated_at_ms, error,
                   output_files, whisperx_options
            FROM jobs
            ORDER BY created_at_ms DESC
            ",
        )
        .map_err(|err| format!("Prepare load query failed: {err}"))?;

    let rows = statement
        .query_map([], |row| {
            let progress_raw: i64 = row.get(5)?;
            let progress = progress_raw.clamp(0, 100) as u8;

            let output_files_json: String = row.get(10)?;
            let output_files =
                serde_json::from_str::<Vec<String>>(&output_files_json).unwrap_or_default();

            let whisperx_options_json: Option<String> = row.get(11)?;
            let whisperx_options =
                whisperx_options_json.and_then(|json| serde_json::from_str::<WhisperxOptions>(&json).ok());

            Ok(Job {
                id: row.get(0)?,
                input_path: row.get(1)?,
                output_dir: row.get(2)?,
                mode: row.get(3)?,
                status: row.get(4)?,
                progress,
                message: row.get(6)?,
                created_at_ms: row.get::<_, i64>(7)? as u64,
                updated_at_ms: row.get::<_, i64>(8)? as u64,
                error: row.get(9)?,
                output_files,
                whisperx_options,
            })
        })
        .map_err(|err| format!("Load query failed: {err}"))?;

    let mut jobs = Vec::new();
    for row in rows {
        jobs.push(row.map_err(|err| format!("Load row failed: {err}"))?);
    }
    Ok(jobs)
}

fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
}

fn load_segments_from_json(value: &serde_json::Value) -> Vec<EditableSegment> {
    let Some(segments) = value.get("segments").and_then(|segments| segments.as_array()) else {
        return vec![];
    };

    segments
        .iter()
        .filter_map(|segment| {
            let start = segment.get("start").and_then(parse_f64)?;
            let end = segment.get("end").and_then(parse_f64)?;
            let text = segment
                .get("text")
                .and_then(|text| text.as_str())
                .unwrap_or_default()
                .to_string();
            let speaker = segment
                .get("speaker")
                .and_then(|speaker| speaker.as_str())
                .map(ToOwned::to_owned);

            Some(EditableSegment {
                start,
                end,
                text,
                speaker,
            })
        })
        .collect()
}

fn normalize_segments(segments: &[EditableSegment]) -> Vec<EditableSegment> {
    segments
        .iter()
        .map(|segment| {
            let mut start = segment.start;
            let mut end = segment.end;
            if start.is_nan() || !start.is_finite() {
                start = 0.0;
            }
            if end.is_nan() || !end.is_finite() {
                end = start;
            }
            if end < start {
                std::mem::swap(&mut start, &mut end);
            }
            EditableSegment {
                start: (start * 1000.0).round() / 1000.0,
                end: (end * 1000.0).round() / 1000.0,
                text: segment.text.clone(),
                speaker: segment.speaker.clone(),
            }
        })
        .collect()
}

fn normalized_export_rules(rules: Option<&ExportTimingRules>) -> (f64, f64, bool) {
    let min_duration_sec = rules
        .and_then(|r| r.min_duration_sec)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(0.001, 10.0))
        .unwrap_or(0.02);
    let min_gap_sec = rules
        .and_then(|r| r.min_gap_sec)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value.clamp(0.0, 10.0))
        .unwrap_or(0.0);
    let fix_overlaps = rules
        .and_then(|r| r.fix_overlaps)
        .unwrap_or(true);
    (min_duration_sec, min_gap_sec, fix_overlaps)
}

fn apply_export_timing_rules(
    segments: &[EditableSegment],
    rules: Option<&ExportTimingRules>,
) -> (Vec<EditableSegment>, ExportCorrectionReport) {
    let (min_duration_sec, min_gap_sec, fix_overlaps) = normalized_export_rules(rules);
    let mut normalized = normalize_segments(segments);
    let input_segments = segments.len();

    let was_sorted = normalized.windows(2).all(|pair| {
        let left = &pair[0];
        let right = &pair[1];
        (left.start < right.start)
            || ((left.start - right.start).abs() < f64::EPSILON && left.end <= right.end)
    });
    if !was_sorted {
        normalized.sort_by(|a, b| {
            a.start
                .partial_cmp(&b.start)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    a.end
                        .partial_cmp(&b.end)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
        });
    }

    let mut overlaps_fixed: u32 = 0;
    let mut min_gap_adjustments: u32 = 0;
    let mut min_duration_adjustments: u32 = 0;

    let mut adjusted: Vec<EditableSegment> = Vec::with_capacity(normalized.len());
    let mut previous_end = 0.0f64;
    for (idx, mut segment) in normalized.into_iter().enumerate() {
        if idx == 0 {
            if segment.start < 0.0 {
                segment.start = 0.0;
            }
        } else {
            if fix_overlaps && segment.start < previous_end {
                segment.start = previous_end;
                overlaps_fixed += 1;
            }
            let required_start = previous_end + min_gap_sec;
            if segment.start < required_start {
                segment.start = required_start;
                min_gap_adjustments += 1;
            }
        }

        let min_end = segment.start + min_duration_sec;
        if segment.end < min_end {
            segment.end = min_end;
            min_duration_adjustments += 1;
        }

        segment.start = (segment.start * 1000.0).round() / 1000.0;
        segment.end = (segment.end * 1000.0).round() / 1000.0;
        previous_end = segment.end;
        adjusted.push(segment);
    }

    let mut notes: Vec<String> = Vec::new();
    if !was_sorted {
        notes.push("Segments were reordered by timestamp before export.".into());
    }
    if overlaps_fixed > 0 {
        notes.push(format!("Fixed {overlaps_fixed} overlap(s)."));
    }
    if min_gap_adjustments > 0 {
        notes.push(format!(
            "Applied min-gap adjustments to {min_gap_adjustments} segment(s)."
        ));
    }
    if min_duration_adjustments > 0 {
        notes.push(format!(
            "Extended {min_duration_adjustments} segment(s) to min duration."
        ));
    }
    if notes.is_empty() {
        notes.push("No timing correction needed.".into());
    }

    let report = ExportCorrectionReport {
        input_segments,
        output_segments: adjusted.len(),
        min_duration_sec,
        min_gap_sec,
        fix_overlaps,
        reordered_segments: !was_sorted,
        overlaps_fixed,
        min_gap_adjustments,
        min_duration_adjustments,
        total_adjustments: overlaps_fixed + min_gap_adjustments + min_duration_adjustments,
        notes,
    };
    (adjusted, report)
}

fn build_transcript_json(language: Option<String>, segments: &[EditableSegment]) -> serde_json::Value {
    let normalized_segments = normalize_segments(segments);
    let segment_values = normalized_segments
        .iter()
        .map(|segment| {
            let mut map = serde_json::Map::new();
            map.insert("start".into(), serde_json::json!(segment.start));
            map.insert("end".into(), serde_json::json!(segment.end));
            map.insert("text".into(), serde_json::json!(segment.text));
            if let Some(speaker) = &segment.speaker {
                if !speaker.trim().is_empty() {
                    map.insert("speaker".into(), serde_json::json!(speaker));
                }
            }
            serde_json::Value::Object(map)
        })
        .collect::<Vec<serde_json::Value>>();

    let mut root = serde_json::Map::new();
    if let Some(lang) = language {
        if !lang.trim().is_empty() {
            root.insert("language".into(), serde_json::json!(lang.trim()));
        }
    }
    root.insert("segments".into(), serde_json::Value::Array(segment_values));
    root.insert("editedBy".into(), serde_json::json!("whisperx-studio"));
    serde_json::Value::Object(root)
}

fn edited_path_with_ext(source_path: &Path, extension_without_dot: &str) -> PathBuf {
    let parent = source_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = source_path
        .file_stem()
        .and_then(|raw| raw.to_str())
        .unwrap_or("transcript");
    let base = if stem.ends_with(".edited") {
        stem.to_string()
    } else {
        format!("{stem}.edited")
    };
    parent.join(format!("{base}.{extension_without_dot}"))
}

fn draft_path_for_source(source_path: &Path) -> PathBuf {
    let parent = source_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = source_path
        .file_stem()
        .and_then(|raw| raw.to_str())
        .unwrap_or("transcript");
    let base = if stem.ends_with(".draft") {
        stem.to_string()
    } else {
        format!("{stem}.draft")
    };
    parent.join(format!("{base}.json"))
}

fn system_time_to_ms(value: SystemTime) -> u64 {
    match value.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

fn build_transcript_draft_json(
    source_path: &Path,
    language: Option<String>,
    segments: &[EditableSegment],
) -> serde_json::Value {
    let mut payload = build_transcript_json(language, segments);
    if let serde_json::Value::Object(ref mut root) = payload {
        root.insert("draft".into(), serde_json::json!(true));
        root.insert(
            "sourcePath".into(),
            serde_json::json!(source_path.to_string_lossy().to_string()),
        );
        root.insert("autosavedAtMs".into(), serde_json::json!(now_ms()));
    }
    payload
}

fn format_timestamp(seconds: f64, decimal_marker: char) -> String {
    let mut total_ms = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = total_ms / 3_600_000;
    total_ms -= hours * 3_600_000;
    let minutes = total_ms / 60_000;
    total_ms -= minutes * 60_000;
    let secs = total_ms / 1_000;
    total_ms -= secs * 1_000;
    format!(
        "{hours:02}:{minutes:02}:{secs:02}{decimal_marker}{total_ms:03}"
    )
}

fn to_srt_text(segments: &[EditableSegment]) -> String {
    let normalized = normalize_segments(segments);
    let mut out = String::new();
    for (index, segment) in normalized.iter().enumerate() {
        let start = format_timestamp(segment.start, ',');
        let end = format_timestamp(segment.end, ',');
        let text = if let Some(speaker) = &segment.speaker {
            if speaker.trim().is_empty() {
                segment.text.clone()
            } else {
                format!("[{speaker}] {}", segment.text)
            }
        } else {
            segment.text.clone()
        };

        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            index + 1,
            start,
            end,
            text.replace("-->", "->")
        ));
    }
    out
}

fn to_vtt_text(segments: &[EditableSegment]) -> String {
    let normalized = normalize_segments(segments);
    let mut out = String::from("WEBVTT\n\n");
    for segment in &normalized {
        let start = format_timestamp(segment.start, '.');
        let end = format_timestamp(segment.end, '.');
        let text = if let Some(speaker) = &segment.speaker {
            if speaker.trim().is_empty() {
                segment.text.clone()
            } else {
                format!("[{speaker}] {}", segment.text)
            }
        } else {
            segment.text.clone()
        };
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            start,
            end,
            text.replace("-->", "->")
        ));
    }
    out
}

fn to_txt_text(segments: &[EditableSegment]) -> String {
    let normalized = normalize_segments(segments);
    let mut out = String::new();
    for segment in &normalized {
        let line = if let Some(speaker) = &segment.speaker {
            if speaker.trim().is_empty() {
                segment.text.clone()
            } else {
                format!("[{speaker}] {}", segment.text)
            }
        } else {
            segment.text.clone()
        };
        out.push_str(line.trim());
        out.push('\n');
    }
    out
}

fn emit_job_update(app: &AppHandle, job: &Job) {
    let _ = app.emit("job-updated", job);
}

fn emit_job_log(app: &AppHandle, log_event: &JobLogEvent) {
    let _ = app.emit("job-log", log_event);
}

fn current_job_status(jobs: &Arc<Mutex<HashMap<String, Job>>>, job_id: &str) -> Option<String> {
    jobs.lock()
        .ok()
        .and_then(|lock| lock.get(job_id).map(|job| job.status.clone()))
}

fn mutate_job<F>(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    job_id: &str,
    mutate: F,
) where
    F: FnOnce(&mut Job),
{
    let mut updated_job = None;

    if let Ok(mut lock) = jobs.lock() {
        if let Some(job) = lock.get_mut(job_id) {
            mutate(job);
            job.updated_at_ms = now_ms();
            updated_job = Some(job.clone());
        }
    }

    if let Some(job) = updated_job {
        if let Err(err) = persist_job(db_path, &job) {
            eprintln!("[persist] {err}");
        }
        emit_job_update(app, &job);
    }
}

fn set_job_error(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    job_id: &str,
    message: &str,
    details: &str,
) {
    if current_job_status(jobs, job_id).as_deref() == Some("cancelled") {
        return;
    }

    mutate_job(app, db_path, jobs, job_id, |job| {
        job.status = "error".into();
        job.progress = 100;
        job.message = message.into();
        job.error = Some(details.into());
    });
}

fn resolve_worker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let try_paths = [
        app.path().resolve("python/worker.py", BaseDirectory::Resource),
        app.path().resolve("worker.py", BaseDirectory::Resource),
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "Unable to resolve project root".to_string())?
            .join("python")
            .join("worker.py")),
    ];

    for candidate in try_paths {
        match candidate {
            Ok(path) if path.exists() => return Ok(path),
            _ => continue,
        }
    }

    Err("Python worker script not found. Expected python/worker.py.".into())
}

fn resolve_runtime_setup_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let try_paths = [
        app.path().resolve("setup-local-runtime.ps1", BaseDirectory::Resource),
        app.path()
            .resolve("scripts/setup-local-runtime.ps1", BaseDirectory::Resource),
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "Unable to resolve project root".to_string())?
            .join("scripts")
            .join("setup-local-runtime.ps1")),
    ];

    for candidate in try_paths {
        match candidate {
            Ok(path) if path.exists() => return Ok(path),
            _ => continue,
        }
    }

    Err("Runtime setup script not found (setup-local-runtime.ps1).".into())
}

fn runtime_setup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?
        .join("python-runtime");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create runtime parent directory: {err}"))?;
    }
    Ok(path)
}

fn emit_runtime_setup_log(app: &AppHandle, stream: &str, message: &str) {
    let event = RuntimeSetupLogEvent {
        ts_ms: now_ms(),
        stream: stream.into(),
        message: message.into(),
    };
    let _ = app.emit("runtime-setup-log", event);
}

fn emit_runtime_setup_finished(app: &AppHandle, success: bool, message: String) {
    let event = RuntimeSetupFinishedEvent { success, message };
    let _ = app.emit("runtime-setup-finished", event);
}

fn run_runtime_setup_process(app: &AppHandle) -> Result<(), String> {
    let script_path = resolve_runtime_setup_script_path(app)?;
    let runtime_dir = runtime_setup_dir(app)?;
    let runtime_dir_raw = runtime_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("powershell");
        cmd.arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script_path)
            .arg("-RuntimeDir")
            .arg(&runtime_dir_raw)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut cmd = Command::new("pwsh");
        cmd.arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script_path)
            .arg("-RuntimeDir")
            .arg(&runtime_dir_raw)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    };

    emit_runtime_setup_log(
        app,
        "system",
        &format!("Starting runtime setup script: {}", script_path.to_string_lossy()),
    );

    let mut child = command.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            #[cfg(target_os = "windows")]
            {
                return "powershell not found to execute runtime setup script.".to_string();
            }
            #[cfg(not(target_os = "windows"))]
            {
                return "pwsh not found to execute runtime setup script.".to_string();
            }
        }
        format!("Unable to start runtime setup process: {err}")
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to capture setup stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Unable to capture setup stderr".to_string())?;

    let stderr_acc = Arc::new(Mutex::new(Vec::<String>::new()));

    let stdout_app = app.clone();
    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                emit_runtime_setup_log(&stdout_app, "stdout", trimmed);
            }
        }
    });

    let stderr_app = app.clone();
    let stderr_acc_clone = stderr_acc.clone();
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            emit_runtime_setup_log(&stderr_app, "stderr", trimmed);
            if let Ok(mut lock) = stderr_acc_clone.lock() {
                lock.push(trimmed.to_string());
            }
        }
    });

    let status = child
        .wait()
        .map_err(|err| format!("Unable to wait runtime setup process: {err}"))?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if !status.success() {
        let details = stderr_acc
            .lock()
            .ok()
            .and_then(|lock| lock.last().cloned())
            .unwrap_or_else(|| "Runtime setup failed without stderr details.".into());
        return Err(format!("Runtime setup failed: {details}"));
    }

    Ok(())
}

fn resolve_python_command(app: &AppHandle) -> String {
    if let Ok(raw) = std::env::var("WHISPERX_STUDIO_PYTHON") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(data_dir) = app.path().app_local_data_dir() {
        #[cfg(target_os = "windows")]
        candidates.push(data_dir.join("python-runtime").join("Scripts").join("python.exe"));
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(data_dir.join("python-runtime").join("bin").join("python3"));
            candidates.push(data_dir.join("python-runtime").join("bin").join("python"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(path) = app.path().resolve("python-runtime/python.exe", BaseDirectory::Resource) {
            candidates.push(path);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(path) = app
            .path()
            .resolve("python-runtime/bin/python3", BaseDirectory::Resource)
        {
            candidates.push(path);
        }
        if let Ok(path) = app
            .path()
            .resolve("python-runtime/bin/python", BaseDirectory::Resource)
        {
            candidates.push(path);
        }
    }

    if let Some(project_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf())
    {
        #[cfg(target_os = "windows")]
        candidates.push(project_root.join(".venv").join("Scripts").join("python.exe"));
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(project_root.join(".venv").join("bin").join("python3"));
            candidates.push(project_root.join(".venv").join("bin").join("python"));
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    "python".into()
}

fn run_probe(command: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stderr.is_empty() {
            return Err(stderr);
        }
        if !stdout.is_empty() {
            return Err(stdout);
        }
        return Err(format!(
            "Command failed with status {}",
            output.status
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        Ok(stdout)
    } else {
        Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn probe_duration_seconds(path: &str) -> Option<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    text.parse::<f64>().ok().filter(|value| value.is_finite() && *value > 0.0)
}

fn waveform_cache_file(
    app: &AppHandle,
    source_path: &Path,
    bins_per_second: u32,
    sample_rate: u32,
) -> Result<PathBuf, String> {
    let metadata = source_path
        .metadata()
        .map_err(|err| format!("Unable to read source metadata: {err}"))?;
    let modified_secs = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source_path.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified_secs.hash(&mut hasher);
    bins_per_second.hash(&mut hasher);
    sample_rate.hash(&mut hasher);
    let key = format!("{:016x}", hasher.finish());

    let cache_root = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?
        .join("waveforms");
    std::fs::create_dir_all(&cache_root)
        .map_err(|err| format!("Unable to create waveform cache dir: {err}"))?;

    Ok(cache_root.join(format!("{key}.json")))
}

#[tauri::command]
fn build_waveform_peaks(
    app: AppHandle,
    path: String,
    bins_per_second: Option<u32>,
    sample_rate: Option<u32>,
) -> Result<WaveformPeaks, String> {
    let source = PathBuf::from(path.trim());
    if !source.exists() {
        return Err("Source media path does not exist".into());
    }
    if !source.is_file() {
        return Err("Source media path is not a file".into());
    }

    let bins_per_second = bins_per_second.unwrap_or(50).clamp(10, 200);
    let sample_rate = sample_rate.unwrap_or(16_000).clamp(8_000, 48_000);

    let cache_file = waveform_cache_file(&app, &source, bins_per_second, sample_rate)?;
    if cache_file.exists() {
        let raw = std::fs::read_to_string(&cache_file)
            .map_err(|err| format!("Unable to read waveform cache file: {err}"))?;
        let mut cached: WaveformPeaks =
            serde_json::from_str(&raw).map_err(|err| format!("Invalid waveform cache: {err}"))?;
        cached.cached = true;
        return Ok(cached);
    }

    let input_path = source.to_string_lossy().to_string();
    let mut ffmpeg = Command::new("ffmpeg");
    ffmpeg
        .args([
            "-v",
            "error",
            "-i",
            &input_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            &sample_rate.to_string(),
            "-f",
            "f32le",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = ffmpeg.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "ffmpeg not found in PATH. Install ffmpeg to enable waveform generation.".to_string()
        } else {
            format!("Unable to launch ffmpeg: {err}")
        }
    })?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to capture ffmpeg stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Unable to capture ffmpeg stderr".to_string())?;

    let stderr_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut buf);
        buf
    });

    let samples_per_bin = (sample_rate / bins_per_second).max(1);
    let mut peaks: Vec<f32> = Vec::new();
    let mut current_peak = 0.0f32;
    let mut current_count: u32 = 0;
    let mut total_samples: u64 = 0;

    let mut carry: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 64 * 1024];

    loop {
        let read = stdout
            .read(&mut chunk)
            .map_err(|err| format!("Unable to read ffmpeg stream: {err}"))?;
        if read == 0 {
            break;
        }

        carry.extend_from_slice(&chunk[..read]);
        let complete_len = carry.len() - (carry.len() % 4);
        let mut offset = 0usize;
        while offset + 4 <= complete_len {
            let sample = f32::from_le_bytes([
                carry[offset],
                carry[offset + 1],
                carry[offset + 2],
                carry[offset + 3],
            ]);
            let amp = sample.abs().min(1.0);
            if amp > current_peak {
                current_peak = amp;
            }
            current_count += 1;
            total_samples += 1;
            if current_count >= samples_per_bin {
                peaks.push(current_peak);
                current_peak = 0.0;
                current_count = 0;
                if peaks.len() > 2_500_000 {
                    return Err(
                        "Waveform too large to render safely. Reduce bins-per-second.".into(),
                    );
                }
            }
            offset += 4;
        }

        if complete_len > 0 {
            carry.drain(..complete_len);
        }
    }

    if current_count > 0 {
        peaks.push(current_peak);
    }

    let status = child
        .wait()
        .map_err(|err| format!("Unable to wait ffmpeg process: {err}"))?;
    let stderr_output = stderr_handle
        .join()
        .unwrap_or_else(|_| "Unable to read ffmpeg stderr".into());

    if !status.success() {
        let err = stderr_output.trim().to_string();
        return Err(if err.is_empty() {
            format!("ffmpeg failed with status: {status}")
        } else {
            format!("ffmpeg failed: {err}")
        });
    }

    if peaks.is_empty() {
        return Err("No audio data decoded for waveform".into());
    }

    let duration_from_decode = total_samples as f64 / sample_rate as f64;
    let duration_sec = probe_duration_seconds(&input_path).unwrap_or(duration_from_decode);

    let mut result = WaveformPeaks {
        source_path: input_path,
        duration_sec,
        bins_per_second,
        sample_rate,
        peaks,
        generated_at_ms: now_ms(),
        cached: false,
    };

    let serialized = serde_json::to_string(&result)
        .map_err(|err| format!("Unable to serialize waveform cache: {err}"))?;
    std::fs::write(&cache_file, serialized)
        .map_err(|err| format!("Unable to write waveform cache file: {err}"))?;

    result.cached = false;
    Ok(result)
}

fn process_worker_line(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    result_holder: &Arc<Mutex<Option<WorkerResult>>>,
    job_id: &str,
    stream: &str,
    line: &str,
) {
    if let Some(json_payload) = line.strip_prefix(LOG_PREFIX) {
        match serde_json::from_str::<WorkerLog>(json_payload) {
            Ok(worker_log) => {
                let level = worker_log.level.unwrap_or_else(|| {
                    if stream == "stderr" {
                        "error".into()
                    } else {
                        "info".into()
                    }
                });

                let event = JobLogEvent {
                    job_id: job_id.into(),
                    ts_ms: now_ms(),
                    stream: stream.into(),
                    level,
                    stage: worker_log.stage.clone(),
                    message: worker_log.message.clone(),
                };
                emit_job_log(app, &event);

                if let Some(progress) = worker_log.progress {
                    mutate_job(app, db_path, jobs, job_id, |job| {
                        if progress > job.progress {
                            job.progress = progress;
                        }
                        job.message = worker_log.message;
                    });
                }
            }
            Err(err) => {
                let event = JobLogEvent {
                    job_id: job_id.into(),
                    ts_ms: now_ms(),
                    stream: stream.into(),
                    level: "warning".into(),
                    stage: Some("parser".into()),
                    message: format!("Unable to parse worker log payload: {err}"),
                };
                emit_job_log(app, &event);
            }
        }
        return;
    }

    if let Some(json_payload) = line.strip_prefix(RESULT_PREFIX) {
        if let Ok(result) = serde_json::from_str::<WorkerResult>(json_payload) {
            if let Ok(mut lock) = result_holder.lock() {
                *lock = Some(result);
            }
        }
        return;
    }

    let level = if stream == "stderr" { "error" } else { "info" };
    let event = JobLogEvent {
        job_id: job_id.into(),
        ts_ms: now_ms(),
        stream: stream.into(),
        level: level.into(),
        stage: None,
        message: line.into(),
    };
    emit_job_log(app, &event);
}

fn run_worker(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    runtime_state: &Arc<Mutex<HashMap<String, u32>>>,
    python_command: &str,
    worker_path: &Path,
    job_id: &str,
    input_path: &str,
    output_dir: &str,
    mode: &str,
    whisperx_options: Option<&WhisperxOptions>,
) -> Result<WorkerResult, String> {
    let mut command = Command::new(python_command);
    command
        .arg(worker_path)
        .arg("--job-id")
        .arg(job_id)
        .arg("--input-path")
        .arg(input_path)
        .arg("--output-dir")
        .arg(output_dir)
        .arg("--mode")
        .arg(mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(options) = whisperx_options {
        let options_json = serde_json::to_string(options)
            .map_err(|err| format!("Serialize worker options failed: {err}"))?;
        command.arg("--options-json").arg(options_json);
    }

    let mut child = command.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            format!(
                "Python executable '{python_command}' not found. Install Python 3.10+ and whisperx, or set WHISPERX_STUDIO_PYTHON."
            )
        } else {
            format!("Failed to launch worker: {err}")
        }
    })?;
    let pid = child.id();

    if let Ok(mut runtime_lock) = runtime_state.lock() {
        runtime_lock.insert(job_id.to_string(), pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Worker stdout is not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Worker stderr is not available".to_string())?;

    let result_holder = Arc::new(Mutex::new(None::<WorkerResult>));

    let stdout_app = app.clone();
    let stdout_db = db_path.to_path_buf();
    let stdout_jobs = jobs.clone();
    let stdout_result = result_holder.clone();
    let stdout_job_id = job_id.to_string();

    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(text) = line {
                process_worker_line(
                    &stdout_app,
                    &stdout_db,
                    &stdout_jobs,
                    &stdout_result,
                    &stdout_job_id,
                    "stdout",
                    text.trim(),
                );
            }
        }
    });

    let stderr_app = app.clone();
    let stderr_db = db_path.to_path_buf();
    let stderr_jobs = jobs.clone();
    let stderr_result = result_holder.clone();
    let stderr_job_id = job_id.to_string();

    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(text) = line {
                process_worker_line(
                    &stderr_app,
                    &stderr_db,
                    &stderr_jobs,
                    &stderr_result,
                    &stderr_job_id,
                    "stderr",
                    text.trim(),
                );
            }
        }
    });

    let status = child
        .wait()
        .map_err(|err| format!("Failed waiting for worker process: {err}"))?;

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if let Ok(mut runtime_lock) = runtime_state.lock() {
        runtime_lock.remove(job_id);
    }

    if current_job_status(jobs, job_id).as_deref() == Some("cancelled") {
        return Err("cancelled by user".into());
    }

    if !status.success() {
        return Err(format!("Worker exited with status: {status}"));
    }

    let result = result_holder
        .lock()
        .map_err(|_| "Failed to lock worker result holder".to_string())?
        .clone()
        .ok_or_else(|| "Worker completed but did not return a final result payload".to_string())?;

    Ok(result)
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    let output = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|err| format!("Failed to execute taskkill: {err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("taskkill failed: {stderr}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    let output = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
        .map_err(|err| format!("Failed to execute kill: {err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("kill failed: {stderr}"))
    }
}

fn run_job_thread(
    app: AppHandle,
    db_path: PathBuf,
    jobs: Arc<Mutex<HashMap<String, Job>>>,
    runtime_state: Arc<Mutex<HashMap<String, u32>>>,
    job_id: String,
    input_path: String,
    output_dir: String,
    mode: String,
    whisperx_options: Option<WhisperxOptions>,
) {
    mutate_job(&app, &db_path, &jobs, &job_id, |job| {
        job.status = "running".into();
        job.progress = 10;
        job.message = "Starting Python worker".into();
    });

    let worker_path = match resolve_worker_path(&app) {
        Ok(path) => path,
        Err(err) => {
            set_job_error(&app, &db_path, &jobs, &job_id, "Worker path error", &err);
            return;
        }
    };
    let python_command = resolve_python_command(&app);
    emit_job_log(
        &app,
        &JobLogEvent {
            job_id: job_id.clone(),
            ts_ms: now_ms(),
            stream: "system".into(),
            level: "info".into(),
            stage: Some("runtime".into()),
            message: format!("Python runtime: {python_command}"),
        },
    );

    mutate_job(&app, &db_path, &jobs, &job_id, |job| {
        job.progress = 20;
        if mode == "whisperx" {
            let model = whisperx_options
                .as_ref()
                .and_then(|options| options.model.clone())
                .unwrap_or_else(|| "small".into());
            job.message = format!("Running whisperx ({model})");
        } else {
            job.message = "Running mock pipeline".into();
        }
    });

    match run_worker(
        &app,
        &db_path,
        &jobs,
        &runtime_state,
        &python_command,
        &worker_path,
        &job_id,
        &input_path,
        &output_dir,
        &mode,
        whisperx_options.as_ref(),
    ) {
        Ok(result) => {
            mutate_job(&app, &db_path, &jobs, &job_id, |job| {
                job.status = "done".into();
                job.progress = 100;
                job.message = result
                    .message
                    .unwrap_or_else(|| "Job completed successfully".into());
                job.output_files = result.output_files;
                job.error = None;
            });
        }
        Err(err) => {
            if current_job_status(&jobs, &job_id).as_deref() == Some("cancelled") {
                let event = JobLogEvent {
                    job_id: job_id.clone(),
                    ts_ms: now_ms(),
                    stream: "system".into(),
                    level: "warning".into(),
                    stage: Some("system".into()),
                    message: "Job cancelled by user".into(),
                };
                emit_job_log(&app, &event);
                return;
            }
            set_job_error(&app, &db_path, &jobs, &job_id, "Worker execution error", &err);
        }
    }
}

#[tauri::command]
fn get_runtime_status(app: AppHandle) -> RuntimeStatus {
    let python_command = resolve_python_command(&app);
    let mut python_ok = false;
    let mut whisperx_ok = false;
    let mut ffmpeg_ok = false;
    let mut whisperx_version: Option<String> = None;
    let mut details: Vec<String> = Vec::new();

    match run_probe(&python_command, &["-c", "import sys; print(sys.executable)"]) {
        Ok(executable) => {
            python_ok = true;
            details.push(format!("python ok: {executable}"));
        }
        Err(err) => {
            details.push(format!("python error: {err}"));
        }
    }

    if python_ok {
        match run_probe(
            &python_command,
            &[
                "-c",
                "import importlib.metadata as md; import whisperx; print(getattr(whisperx, '__version__', md.version('whisperx')))",
            ],
        ) {
            Ok(version) => {
                whisperx_ok = true;
                whisperx_version = Some(version.clone());
                details.push(format!("whisperx ok: {version}"));
            }
            Err(err) => {
                details.push(format!("whisperx error: {err}"));
            }
        }
    }

    match run_probe("ffmpeg", &["-version"]) {
        Ok(output) => {
            ffmpeg_ok = true;
            let first_line = output.lines().next().unwrap_or("ffmpeg available");
            details.push(format!("ffmpeg ok: {first_line}"));
        }
        Err(err) => {
            details.push(format!("ffmpeg error: {err}"));
        }
    }

    RuntimeStatus {
        python_command,
        python_ok,
        whisperx_ok,
        ffmpeg_ok,
        whisperx_version,
        details,
    }
}

#[tauri::command]
fn get_runtime_setup_status(state: State<RuntimeSetupState>) -> Result<RuntimeSetupStatus, String> {
    let running = *state
        .running
        .lock()
        .map_err(|_| "Failed to lock runtime setup state".to_string())?;
    Ok(RuntimeSetupStatus { running })
}

#[tauri::command]
fn start_runtime_setup(
    app: AppHandle,
    state: State<RuntimeSetupState>,
) -> Result<(), String> {
    {
        let mut lock = state
            .running
            .lock()
            .map_err(|_| "Failed to lock runtime setup state".to_string())?;
        if *lock {
            return Err("Runtime setup is already running.".into());
        }
        *lock = true;
    }

    let app_for_thread = app.clone();
    let running_state = state.running.clone();
    std::thread::spawn(move || {
        let result = run_runtime_setup_process(&app_for_thread);
        if let Ok(mut lock) = running_state.lock() {
            *lock = false;
        }
        match result {
            Ok(()) => emit_runtime_setup_finished(
                &app_for_thread,
                true,
                "Runtime setup completed.".into(),
            ),
            Err(err) => emit_runtime_setup_finished(
                &app_for_thread,
                false,
                err,
            ),
        }
    });

    Ok(())
}

fn default_output_dir(app: &AppHandle, job_id: &str) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?
        .join("runs")
        .join(job_id);
    std::fs::create_dir_all(&dir).map_err(|err| format!("Unable to create output directory: {err}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn create_job(
    app: AppHandle,
    db_state: State<DbState>,
    state: State<JobsState>,
    runtime_state: State<RuntimeState>,
    request: CreateJobRequest,
) -> Result<Job, String> {
    if request.input_path.trim().is_empty() {
        return Err("inputPath is required".into());
    }

    if !Path::new(request.input_path.trim()).exists() {
        return Err("inputPath does not exist on disk".into());
    }

    let mode = request.mode.unwrap_or_else(|| "mock".into());
    let job_id = format!("job-{}", uuid::Uuid::new_v4());
    let output_dir = if let Some(dir) = request.output_dir {
        if dir.trim().is_empty() {
            default_output_dir(&app, &job_id)?
        } else {
            dir
        }
    } else {
        default_output_dir(&app, &job_id)?
    };

    std::fs::create_dir_all(&output_dir)
        .map_err(|err| format!("Unable to create output directory: {err}"))?;

    let ts = now_ms();
    let job = Job {
        id: job_id.clone(),
        input_path: request.input_path.clone(),
        output_dir: output_dir.clone(),
        mode: mode.clone(),
        status: "queued".into(),
        progress: 0,
        message: "Queued".into(),
        created_at_ms: ts,
        updated_at_ms: ts,
        error: None,
        output_files: vec![],
        whisperx_options: request.whisperx_options.clone(),
    };

    if let Ok(mut lock) = state.jobs.lock() {
        lock.insert(job_id.clone(), job.clone());
    } else {
        return Err("Failed to lock in-memory job store".into());
    }

    persist_job(&db_state.path, &job)?;

    let app_for_thread = app.clone();
    let db_for_thread = db_state.path.as_ref().to_path_buf();
    let jobs_for_thread = state.jobs.clone();
    let runtime_for_thread = runtime_state.running_pids.clone();
    let whisperx_options_for_thread = request.whisperx_options.clone();

    std::thread::spawn(move || {
        run_job_thread(
            app_for_thread,
            db_for_thread,
            jobs_for_thread,
            runtime_for_thread,
            job_id,
            request.input_path,
            output_dir,
            mode,
            whisperx_options_for_thread,
        );
    });

    emit_job_update(&app, &job);
    Ok(job)
}

#[tauri::command]
fn list_jobs(state: State<JobsState>) -> Result<Vec<Job>, String> {
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| "Failed to lock in-memory job store".to_string())?
        .values()
        .cloned()
        .collect::<Vec<Job>>();

    jobs.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    Ok(jobs)
}

#[tauri::command]
fn get_job(state: State<JobsState>, job_id: String) -> Result<Option<Job>, String> {
    let maybe_job = state
        .jobs
        .lock()
        .map_err(|_| "Failed to lock in-memory job store".to_string())?
        .get(&job_id)
        .cloned();

    Ok(maybe_job)
}

#[tauri::command]
fn load_transcript_document(path: String) -> Result<TranscriptDocument, String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("Transcript file does not exist".into());
    }
    if !target.is_file() {
        return Err("Transcript path is not a file".into());
    }
    let text =
        std::fs::read_to_string(&target).map_err(|err| format!("Unable to read transcript: {err}"))?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|err| format!("Invalid transcript JSON content: {err}"))?;
    let language = value
        .get("language")
        .and_then(|lang| lang.as_str())
        .map(ToOwned::to_owned);
    let segments = load_segments_from_json(&value);
    if segments.is_empty() {
        return Err("No usable segments were found in transcript JSON".into());
    }

    Ok(TranscriptDocument {
        path,
        language,
        segments,
    })
}

#[tauri::command]
fn load_transcript_draft(path: String) -> Result<Option<TranscriptDraftDocument>, String> {
    let source = PathBuf::from(&path);
    let draft_path = draft_path_for_source(&source);
    if !draft_path.exists() {
        return Ok(None);
    }
    if !draft_path.is_file() {
        return Err("Draft path exists but is not a file".into());
    }

    let text =
        std::fs::read_to_string(&draft_path).map_err(|err| format!("Unable to read draft: {err}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|err| format!("Invalid draft JSON content: {err}"))?;
    let language = value
        .get("language")
        .and_then(|lang| lang.as_str())
        .map(ToOwned::to_owned);
    let segments = load_segments_from_json(&value);
    if segments.is_empty() {
        return Ok(None);
    }

    let updated_at_ms = draft_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(system_time_to_ms)
        .unwrap_or_else(now_ms);

    Ok(Some(TranscriptDraftDocument {
        source_path: source.to_string_lossy().to_string(),
        draft_path: draft_path.to_string_lossy().to_string(),
        updated_at_ms,
        language,
        segments,
    }))
}

#[tauri::command]
fn save_transcript_draft(
    request: SaveTranscriptDraftRequest,
) -> Result<SaveTranscriptDraftResponse, String> {
    let source = PathBuf::from(&request.path);
    let draft_path = draft_path_for_source(&source);
    let payload = build_transcript_draft_json(&source, request.language, &request.segments);
    let serialized =
        serde_json::to_string_pretty(&payload).map_err(|err| format!("Unable to serialize draft JSON: {err}"))?;

    if let Some(parent) = draft_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create draft directory: {err}"))?;
    }

    std::fs::write(&draft_path, serialized)
        .map_err(|err| format!("Unable to write transcript draft: {err}"))?;

    let updated_at_ms = draft_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(system_time_to_ms)
        .unwrap_or_else(now_ms);

    Ok(SaveTranscriptDraftResponse {
        draft_path: draft_path.to_string_lossy().to_string(),
        updated_at_ms,
    })
}

#[tauri::command]
fn delete_transcript_draft(path: String) -> Result<bool, String> {
    let source = PathBuf::from(&path);
    let draft_path = draft_path_for_source(&source);
    if !draft_path.exists() {
        return Ok(false);
    }
    if !draft_path.is_file() {
        return Err("Draft path exists but is not a file".into());
    }
    std::fs::remove_file(&draft_path).map_err(|err| format!("Unable to delete draft file: {err}"))?;
    Ok(true)
}

#[tauri::command]
fn save_transcript_json(request: SaveTranscriptRequest) -> Result<String, String> {
    let source = PathBuf::from(&request.path);
    let target_path = if request.overwrite.unwrap_or(false) {
        source.clone()
    } else {
        edited_path_with_ext(&source, "json")
    };

    let payload = build_transcript_json(request.language, &request.segments);
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("Unable to serialize transcript JSON: {err}"))?;

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create transcript directory: {err}"))?;
    }

    std::fs::write(&target_path, serialized)
        .map_err(|err| format!("Unable to write transcript JSON: {err}"))?;

    let draft_path = draft_path_for_source(&source);
    if draft_path.exists() && draft_path.is_file() {
        let _ = std::fs::remove_file(draft_path);
    }

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_transcript(request: ExportTranscriptRequest) -> Result<ExportTranscriptResponse, String> {
    let format = request.format.trim().to_lowercase();
    let source = PathBuf::from(&request.path);
    let (segments_for_export, report) = apply_export_timing_rules(&request.segments, request.rules.as_ref());
    let output = match format.as_str() {
        "json" => {
            let target_path = edited_path_with_ext(&source, "json");
            let payload = build_transcript_json(request.language.clone(), &segments_for_export);
            let serialized = serde_json::to_string_pretty(&payload)
                .map_err(|err| format!("Unable to serialize transcript JSON: {err}"))?;
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export JSON transcript: {err}"))?;
            target_path
        }
        "srt" => {
            let target_path = edited_path_with_ext(&source, "srt");
            let serialized = to_srt_text(&segments_for_export);
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export SRT transcript: {err}"))?;
            target_path
        }
        "vtt" => {
            let target_path = edited_path_with_ext(&source, "vtt");
            let serialized = to_vtt_text(&segments_for_export);
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export VTT transcript: {err}"))?;
            target_path
        }
        "txt" => {
            let target_path = edited_path_with_ext(&source, "txt");
            let serialized = to_txt_text(&segments_for_export);
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export TXT transcript: {err}"))?;
            target_path
        }
        other => return Err(format!("Unsupported export format: {other}")),
    };

    Ok(ExportTranscriptResponse {
        output_path: output.to_string_lossy().to_string(),
        report,
    })
}

#[tauri::command]
fn read_text_preview(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("Target file does not exist".into());
    }
    if !target.is_file() {
        return Err("Target path is not a file".into());
    }

    let max = max_bytes.unwrap_or(200_000).clamp(1024, 2_000_000);
    let bytes = std::fs::read(&target).map_err(|err| format!("Unable to read file: {err}"))?;
    let truncated = bytes.len() > max;
    let slice = if truncated { &bytes[..max] } else { &bytes };
    let mut content = String::from_utf8_lossy(slice).to_string();
    if truncated {
        content.push_str(&format!(
            "\n\n[Preview truncated to {max} bytes out of {} bytes]",
            bytes.len()
        ));
    }
    Ok(content)
}

#[tauri::command]
fn cancel_job(
    app: AppHandle,
    db_state: State<DbState>,
    state: State<JobsState>,
    runtime_state: State<RuntimeState>,
    job_id: String,
) -> Result<(), String> {
    let status = current_job_status(&state.jobs, &job_id)
        .ok_or_else(|| "Unknown job id".to_string())?;

    if status == "done" || status == "error" || status == "cancelled" {
        return Err(format!("Cannot cancel job in status '{status}'"));
    }

    mutate_job(&app, &db_state.path, &state.jobs, &job_id, |job| {
        job.status = "cancelled".into();
        job.progress = 100;
        job.message = "Cancellation requested by user".into();
        job.error = None;
    });

    let maybe_pid = runtime_state
        .running_pids
        .lock()
        .map_err(|_| "Failed to lock running pid store".to_string())?
        .remove(&job_id);

    if let Some(pid) = maybe_pid {
        kill_process_tree(pid)?;
        let event = JobLogEvent {
            job_id,
            ts_ms: now_ms(),
            stream: "system".into(),
            level: "warning".into(),
            stage: Some("system".into()),
            message: format!("Process {pid} terminated"),
        };
        emit_job_log(&app, &event);
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(JobsState::default())
        .manage(RuntimeState::default())
        .manage(RuntimeSetupState::default())
        .setup(|app| {
            let app_handle = app.handle();
            let db_path = database_path(&app_handle).map_err(std::io::Error::other)?;
            init_database(&db_path).map_err(std::io::Error::other)?;
            let persisted_jobs = load_jobs(&db_path).map_err(std::io::Error::other)?;

            {
                let state: State<JobsState> = app.state();
                let mut lock = state
                    .jobs
                    .lock()
                    .map_err(|_| std::io::Error::other("Failed to lock in-memory job store"))?;
                for job in persisted_jobs {
                    lock.insert(job.id.clone(), job);
                }
            }

            app.manage(DbState {
                path: Arc::new(db_path),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_job,
            list_jobs,
            get_job,
            get_runtime_status,
            get_runtime_setup_status,
            start_runtime_setup,
            build_waveform_peaks,
            load_transcript_document,
            load_transcript_draft,
            save_transcript_draft,
            delete_transcript_draft,
            save_transcript_json,
            export_transcript,
            read_text_preview,
            cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
