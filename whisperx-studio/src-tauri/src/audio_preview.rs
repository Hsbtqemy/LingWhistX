//! Extraction ffmpeg d'une fenêtre audio WAV mono 16 kHz (WX-619 — lecture Web Audio).

use std::fs;
use std::process::Command;

use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::ffmpeg_tools::{prepend_path_env, resolve_ffmpeg_tools};
use crate::path_guard::resolve_existing_file_path;

/// Extrait `[start_sec, start_sec + duration_sec)` en WAV PCM (mono 16 kHz) dans le cache app.
/// `duration_sec` est plafonné à 60 s. Pour les fichiers longs, placer `-ss` avant `-i` (seek rapide).
#[tauri::command]
pub fn extract_audio_wav_window(
    app: AppHandle,
    input_path: String,
    start_sec: f64,
    duration_sec: f64,
) -> Result<String, String> {
    let src = resolve_existing_file_path(
        &input_path,
        "Media file does not exist",
        "Media path is not a file",
    )?;
    let start = if start_sec.is_finite() {
        start_sec.max(0.0)
    } else {
        return Err("start_sec must be finite".into());
    };
    let dur = if duration_sec.is_finite() {
        duration_sec.clamp(0.05, 60.0)
    } else {
        return Err("duration_sec must be finite".into());
    };

    let cache = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("audio_wav_windows");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;

    let out = cache.join(format!("{}.wav", Uuid::new_v4()));
    let out_str = out.to_string_lossy().to_string();
    let src_str = src.to_str().ok_or_else(|| "Invalid source path".to_string())?;

    let tools = resolve_ffmpeg_tools(&app);
    let mut cmd = Command::new(&tools.ffmpeg_command);
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        &format!("{start:.6}"),
        "-i",
        src_str,
        "-t",
        &format!("{dur:.6}"),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        &out_str,
    ]);
    if let Some(prefix) = tools.ffmpeg_dir.as_deref() {
        prepend_path_env(&mut cmd, prefix);
    }

    let status = cmd.status().map_err(|e| format!("ffmpeg: {e}"))?;
    if !status.success() {
        let _ = fs::remove_file(&out);
        return Err("ffmpeg failed to extract audio window".into());
    }
    if !out.is_file() {
        return Err("ffmpeg produced no output file".into());
    }
    Ok(out_str)
}
