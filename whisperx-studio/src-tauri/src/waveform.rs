//! Generation et cache des peaks waveform (ffmpeg).

use std::collections::{HashMap, HashSet};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use tauri::{AppHandle, Manager, State};

use crate::app_events::{
    emit_waveform_cancelled, emit_waveform_error, emit_waveform_progress, emit_waveform_ready,
};
use crate::ffmpeg_tools::{prepend_path_env, probe_duration_seconds, resolve_ffmpeg_tools};
use crate::models::{
    WaveformCancelledEvent, WaveformErrorEvent, WaveformPeaks, WaveformProgressEvent,
    WaveformReadyEvent, WaveformTaskStarted, WaveformTaskState,
};
use crate::path_guard::validate_path_string;
use crate::process_utils::kill_process_tree;
use crate::time_utils::now_ms;

/// FNV-1a 64-bit — déterministe entre compilations Rust (contrairement à `DefaultHasher`).
fn fnv1a64_mix_bytes(mut hash: u64, bytes: &[u8]) -> u64 {
    const PRIME: u64 = 1099511628211;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

fn waveform_cache_key(
    path_display: &str,
    len: u64,
    modified_nanos: u128,
    bins_per_second: u32,
    sample_rate: u32,
) -> String {
    const OFFSET: u64 = 14695981039346656037;
    let mut h = OFFSET;
    h = fnv1a64_mix_bytes(h, path_display.as_bytes());
    h = fnv1a64_mix_bytes(h, &len.to_le_bytes());
    h = fnv1a64_mix_bytes(h, &modified_nanos.to_le_bytes());
    h = fnv1a64_mix_bytes(h, &bins_per_second.to_le_bytes());
    h = fnv1a64_mix_bytes(h, &sample_rate.to_le_bytes());
    format!("{:016x}", h)
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
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);

    let key = waveform_cache_key(
        &source_path.to_string_lossy(),
        metadata.len(),
        modified_nanos,
        bins_per_second,
        sample_rate,
    );

    let cache_root = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?
        .join("waveforms");
    std::fs::create_dir_all(&cache_root)
        .map_err(|err| format!("Unable to create waveform cache dir: {err}"))?;

    Ok(cache_root.join(format!("{key}.json")))
}

fn is_waveform_task_cancelled(
    cancelled_task_ids: &Arc<Mutex<HashSet<String>>>,
    task_id: &str,
) -> bool {
    cancelled_task_ids
        .lock()
        .map(|lock| lock.contains(task_id))
        .unwrap_or(false)
}

fn clear_waveform_task_cancellation(
    cancelled_task_ids: &Arc<Mutex<HashSet<String>>>,
    task_id: &str,
) {
    if let Ok(mut lock) = cancelled_task_ids.lock() {
        lock.remove(task_id);
    }
}

fn remove_waveform_running_pid(running_pids: &Arc<Mutex<HashMap<String, u32>>>, task_id: &str) {
    if let Ok(mut lock) = running_pids.lock() {
        lock.remove(task_id);
    }
}

fn build_waveform_peaks_internal(
    app: &AppHandle,
    path: &str,
    bins_per_second: Option<u32>,
    sample_rate: Option<u32>,
    task_id: Option<&str>,
    running_pids: Option<&Arc<Mutex<HashMap<String, u32>>>>,
    cancelled_task_ids: Option<&Arc<Mutex<HashSet<String>>>>,
) -> Result<WaveformPeaks, String> {
    validate_path_string(path)?;
    let source = PathBuf::from(path.trim());
    if !source.exists() {
        return Err("Source media path does not exist".into());
    }
    if !source.is_file() {
        return Err("Source media path is not a file".into());
    }

    let source_path_string = source.to_string_lossy().to_string();
    let bins_per_second = bins_per_second.unwrap_or(50).clamp(10, 200);
    let sample_rate = sample_rate.unwrap_or(16_000).clamp(8_000, 48_000);

    let emit_progress_for_task = |progress: u8, message: &str| {
        if let Some(task_id) = task_id {
            emit_waveform_progress(
                app,
                &WaveformProgressEvent {
                    task_id: task_id.to_string(),
                    path: source_path_string.clone(),
                    progress,
                    message: message.to_string(),
                },
            );
        }
    };

    let cache_file = waveform_cache_file(app, &source, bins_per_second, sample_rate)?;
    if cache_file.exists() {
        let raw = std::fs::read_to_string(&cache_file)
            .map_err(|err| format!("Unable to read waveform cache file: {err}"))?;
        let mut cached: WaveformPeaks =
            serde_json::from_str(&raw).map_err(|err| format!("Invalid waveform cache: {err}"))?;
        cached.cached = true;
        emit_progress_for_task(100, "Waveform charge depuis le cache.");
        return Ok(cached);
    }

    emit_progress_for_task(1, "Generation waveform: decodage audio...");

    let ffmpeg_tools = resolve_ffmpeg_tools(app);
    let duration_hint = probe_duration_seconds(&source_path_string, &ffmpeg_tools);
    let estimated_total_samples = duration_hint
        .map(|duration| (duration * sample_rate as f64).max(1.0) as u64)
        .filter(|value| *value > 0);

    let mut ffmpeg = Command::new(&ffmpeg_tools.ffmpeg_command);
    ffmpeg
        .args([
            "-v",
            "error",
            "-i",
            &source_path_string,
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
    if let Some(prefix) = ffmpeg_tools.ffmpeg_dir.as_deref() {
        prepend_path_env(&mut ffmpeg, prefix);
    }

    let mut child = ffmpeg.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "ffmpeg not found. Install ffmpeg to enable waveform generation.".to_string()
        } else {
            format!("Unable to launch ffmpeg: {err}")
        }
    })?;

    if let (Some(task_id), Some(running_pids)) = (task_id, running_pids) {
        if let Ok(mut lock) = running_pids.lock() {
            lock.insert(task_id.to_string(), child.id());
        }
    }

    if let (Some(task_id), Some(cancelled_task_ids)) = (task_id, cancelled_task_ids) {
        if is_waveform_task_cancelled(cancelled_task_ids, task_id) {
            let _ = kill_process_tree(child.id());
        }
    }

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
    let mut generation_error: Option<String> = None;
    let mut cancelled = false;
    let mut last_progress: u8 = 1;

    let mut carry: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 64 * 1024];

    loop {
        if let (Some(task_id), Some(cancelled_task_ids)) = (task_id, cancelled_task_ids) {
            if is_waveform_task_cancelled(cancelled_task_ids, task_id) {
                let _ = kill_process_tree(child.id());
                cancelled = true;
                break;
            }
        }

        let read = match stdout.read(&mut chunk) {
            Ok(value) => value,
            Err(err) => {
                generation_error = Some(format!("Unable to read ffmpeg stream: {err}"));
                break;
            }
        };
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
                    generation_error =
                        Some("Waveform too large to render safely. Reduce bins-per-second.".into());
                    break;
                }
            }
            offset += 4;
        }
        if generation_error.is_some() {
            break;
        }

        if complete_len > 0 {
            carry.drain(..complete_len);
        }

        if let Some(total_estimate) = estimated_total_samples {
            let ratio = (total_samples as f64 / total_estimate as f64).clamp(0.0, 1.0);
            let next_progress = ((ratio * 95.0).floor() as u8).clamp(1, 95);
            if next_progress > last_progress {
                last_progress = next_progress;
                emit_progress_for_task(next_progress, "Generation waveform: decodage audio...");
            }
        }
    }

    if generation_error.is_some() {
        let _ = kill_process_tree(child.id());
    }

    if !cancelled && generation_error.is_none() && current_count > 0 {
        peaks.push(current_peak);
    }

    let status = child
        .wait()
        .map_err(|err| format!("Unable to wait ffmpeg process: {err}"))?;
    let stderr_output = stderr_handle
        .join()
        .unwrap_or_else(|_| "Unable to read ffmpeg stderr".into());

    if let (Some(task_id), Some(running_pids)) = (task_id, running_pids) {
        remove_waveform_running_pid(running_pids, task_id);
    }

    if let (Some(task_id), Some(cancelled_task_ids)) = (task_id, cancelled_task_ids) {
        if cancelled || is_waveform_task_cancelled(cancelled_task_ids, task_id) {
            clear_waveform_task_cancellation(cancelled_task_ids, task_id);
            return Err("cancelled by user".into());
        }
    }

    if let Some(err) = generation_error {
        return Err(err);
    }

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

    emit_progress_for_task(97, "Generation waveform: finalisation...");

    let duration_from_decode = total_samples as f64 / sample_rate as f64;
    let duration_sec = duration_hint.unwrap_or(duration_from_decode);

    let mut result = WaveformPeaks {
        source_path: source_path_string.clone(),
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

    emit_progress_for_task(100, "Waveform generee.");

    if let (Some(task_id), Some(cancelled_task_ids)) = (task_id, cancelled_task_ids) {
        clear_waveform_task_cancellation(cancelled_task_ids, task_id);
    }

    result.cached = false;
    Ok(result)
}

#[tauri::command]
pub fn build_waveform_peaks(
    app: AppHandle,
    path: String,
    bins_per_second: Option<u32>,
    sample_rate: Option<u32>,
) -> Result<WaveformPeaks, String> {
    build_waveform_peaks_internal(&app, &path, bins_per_second, sample_rate, None, None, None)
}

#[tauri::command]
pub fn start_waveform_generation(
    app: AppHandle,
    state: State<WaveformTaskState>,
    path: String,
    bins_per_second: Option<u32>,
    sample_rate: Option<u32>,
) -> Result<WaveformTaskStarted, String> {
    let trimmed_path = path.trim().to_string();
    if trimmed_path.is_empty() {
        return Err("Source media path is required".into());
    }

    let task_id = format!("wf-{}", uuid::Uuid::new_v4());
    let started = WaveformTaskStarted {
        task_id: task_id.clone(),
        path: trimmed_path.clone(),
    };

    let app_for_thread = app.clone();
    let running_pids = state.running_pids.clone();
    let cancelled_task_ids = state.cancelled_task_ids.clone();
    let task_id_for_thread = task_id.clone();
    let path_for_thread = trimmed_path.clone();

    std::thread::spawn(move || {
        match build_waveform_peaks_internal(
            &app_for_thread,
            &path_for_thread,
            bins_per_second,
            sample_rate,
            Some(&task_id_for_thread),
            Some(&running_pids),
            Some(&cancelled_task_ids),
        ) {
            Ok(peaks) => {
                emit_waveform_ready(
                    &app_for_thread,
                    &WaveformReadyEvent {
                        task_id: task_id_for_thread.clone(),
                        path: path_for_thread.clone(),
                        peaks,
                    },
                );
            }
            Err(err) => {
                if err == "cancelled by user" {
                    emit_waveform_cancelled(
                        &app_for_thread,
                        &WaveformCancelledEvent {
                            task_id: task_id_for_thread.clone(),
                            path: path_for_thread.clone(),
                            message: "Generation waveform annulee.".into(),
                        },
                    );
                } else {
                    emit_waveform_error(
                        &app_for_thread,
                        &WaveformErrorEvent {
                            task_id: task_id_for_thread.clone(),
                            path: path_for_thread.clone(),
                            error: err,
                        },
                    );
                }
            }
        }
        remove_waveform_running_pid(&running_pids, &task_id_for_thread);
        clear_waveform_task_cancellation(&cancelled_task_ids, &task_id_for_thread);
    });

    Ok(started)
}

#[tauri::command]
pub fn cancel_waveform_generation(
    state: State<WaveformTaskState>,
    task_id: String,
) -> Result<bool, String> {
    let normalized = task_id.trim().to_string();
    if normalized.is_empty() {
        return Err("taskId is required".into());
    }

    if let Ok(mut cancelled) = state.cancelled_task_ids.lock() {
        cancelled.insert(normalized.clone());
    }

    let maybe_pid = state
        .running_pids
        .lock()
        .map_err(|_| "Failed to lock waveform running pid store".to_string())?
        .remove(&normalized);

    if let Some(pid) = maybe_pid {
        kill_process_tree(pid)?;
        Ok(true)
    } else {
        Ok(false)
    }
}
