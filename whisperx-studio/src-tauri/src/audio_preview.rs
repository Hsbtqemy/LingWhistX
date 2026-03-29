//! Extraction ffmpeg d'une fenêtre audio WAV mono 16 kHz (WX-619 — lecture Web Audio).
//! WX-623 — export snippet vers un chemin utilisateur (même pipeline d'extraction).
//! WX-665 — aperçu prétraité A/B (preview_preprocess.py).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::{engine::general_purpose, Engine as _};
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::embedded_resources::resolve_preview_preprocess_path;
use crate::ffmpeg_tools::{prepend_path_env, resolve_ffmpeg_tools};
use crate::path_guard::{resolve_existing_file_path, validate_custom_output_dir};
use crate::python_runtime::resolve_python_command;

/// Plafond taille fichier WAV lu puis encodé en base64 pour IPC (`read_extracted_wav_window` plafonne déjà à 60 s mono 16 kHz ; marge pour en-tête WAV).
pub const MAX_READ_WAV_BYTES_FOR_B64: u64 = 4 * 1024 * 1024;

fn validate_path_under_audio_wav_cache(app: &AppHandle, raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw.trim());
    if !path.is_absolute() {
        return Err("path must be absolute".into());
    }
    let cache_root = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("audio_wav_windows");
    let _ = fs::create_dir_all(&cache_root);
    let cache_root = cache_root.canonicalize().map_err(|e| e.to_string())?;
    let p = path.canonicalize().map_err(|e| e.to_string())?;
    if !p.starts_with(&cache_root) {
        return Err("Path must be under audio_wav_windows cache".into());
    }
    if !p.is_file() {
        return Err("Not a file".into());
    }
    Ok(p)
}

/// Lecture côté Rust des WAV extraits (évite `fetch(convertFileSrc)` : le protocole asset ne couvre pas toujours le cache).
#[tauri::command]
pub fn read_extracted_wav_bytes_b64(app: AppHandle, path: String) -> Result<String, String> {
    let p = validate_path_under_audio_wav_cache(&app, &path)?;
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > MAX_READ_WAV_BYTES_FOR_B64 {
        return Err(format!(
            "WAV file too large for IPC ({} bytes, max {}).",
            meta.len(),
            MAX_READ_WAV_BYTES_FOR_B64
        ));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

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
    let src_str = src
        .to_str()
        .ok_or_else(|| "Invalid source path".to_string())?;

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

/// Exporte `[start_sec, end_sec)` en WAV mono 16 kHz vers `output_path` (WX-623).
#[tauri::command]
pub fn export_audio_wav_segment(
    app: AppHandle,
    input_path: String,
    output_path: String,
    start_sec: f64,
    end_sec: f64,
) -> Result<(), String> {
    let src = resolve_existing_file_path(
        &input_path,
        "Media file does not exist",
        "Media path is not a file",
    )?;
    if !start_sec.is_finite() || !end_sec.is_finite() {
        return Err("start_sec and end_sec must be finite".into());
    }
    let t0 = start_sec.max(0.0);
    let t1 = end_sec.max(0.0);
    if t1 <= t0 {
        return Err("end_sec must be greater than start_sec".into());
    }
    let dur = (t1 - t0).min(14_400.0_f64);
    if dur < 0.05 {
        return Err("segment duration must be at least 50 ms".into());
    }

    let out = Path::new(output_path.trim());
    if !out.is_absolute() {
        return Err("output_path must be absolute".into());
    }
    let parent = out
        .parent()
        .ok_or_else(|| "Invalid output_path".to_string())?;
    validate_custom_output_dir(&app, parent.to_string_lossy().as_ref())?;

    let src_str = src
        .to_str()
        .ok_or_else(|| "Invalid source path".to_string())?;
    let out_str = out.to_string_lossy().to_string();

    let tools = resolve_ffmpeg_tools(&app);
    let mut cmd = Command::new(&tools.ffmpeg_command);
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        &format!("{t0:.6}"),
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
        let _ = fs::remove_file(out);
        return Err("ffmpeg failed to export audio segment".into());
    }
    if !out.is_file() {
        return Err("ffmpeg produced no output file".into());
    }
    Ok(())
}

/// Résultat de l'aperçu A/B prétraité (WX-665).
/// Les deux champs contiennent le WAV encodé en base64 (PCM 16 kHz mono, max 30 s ≈ 1 Mo).
#[derive(serde::Serialize)]
pub struct PreprocessedAudioPreview {
    pub original_b64: String,
    pub processed_b64: String,
    /// true si le fichier traité diffère de l'original (i.e. au moins un module a été appliqué).
    pub is_processed: bool,
}

/// WX-665 — Génère un aperçu audio A/B en appliquant les modules pipeline configurés
/// sur une fenêtre de 30 s extraite du fichier source.
///
/// - Extrait la fenêtre originale via ffmpeg.
/// - Lance `preview_preprocess.py` pour appliquer les modules.
/// - Retourne les deux WAV encodés en base64 pour lecture immédiate dans l'UI.
#[tauri::command]
pub fn generate_preprocessed_audio_preview(
    app: AppHandle,
    input_path: String,
    start_sec: f64,
    duration_sec: f64,
    modules_json: String,
) -> Result<PreprocessedAudioPreview, String> {
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
        duration_sec.clamp(0.1, 30.0)
    } else {
        return Err("duration_sec must be finite".into());
    };

    // Validate modules_json is a JSON object.
    let modules_value: serde_json::Value = serde_json::from_str(&modules_json)
        .map_err(|e| format!("modules_json: JSON invalide — {e}"))?;
    if !modules_value.is_object() {
        return Err("modules_json must be a JSON object".into());
    }

    let cache = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("audio_wav_windows");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;

    let session_id = Uuid::new_v4().to_string();
    let original_out = cache.join(format!("{session_id}_original.wav"));
    let original_str = original_out.to_string_lossy().to_string();
    let src_str = src
        .to_str()
        .ok_or_else(|| "Invalid source path".to_string())?;

    // Extract original window via ffmpeg.
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
        &original_str,
    ]);
    if let Some(prefix) = tools.ffmpeg_dir.as_deref() {
        prepend_path_env(&mut cmd, prefix);
    }
    let status = cmd.status().map_err(|e| format!("ffmpeg: {e}"))?;
    if !status.success() {
        let _ = fs::remove_file(&original_out);
        return Err("ffmpeg failed to extract audio window".into());
    }
    if !original_out.is_file() {
        return Err("ffmpeg produced no output file".into());
    }

    let original_bytes = fs::read(&original_out).map_err(|e| e.to_string())?;
    if original_bytes.len() as u64 > MAX_READ_WAV_BYTES_FOR_B64 {
        let _ = fs::remove_file(&original_out);
        return Err(format!(
            "Extracted WAV too large ({} bytes).",
            original_bytes.len()
        ));
    }
    let original_b64 = general_purpose::STANDARD.encode(&original_bytes);

    // Check if any modules are requested (non-empty object with at least one truthy value).
    let has_modules = modules_value
        .as_object()
        .map(|obj| {
            !obj.is_empty()
                && obj
                    .values()
                    .any(|v| v.as_bool().unwrap_or(true) || v.is_object())
        })
        .unwrap_or(false);

    if !has_modules {
        let _ = fs::remove_file(&original_out);
        return Ok(PreprocessedAudioPreview {
            original_b64: original_b64.clone(),
            processed_b64: original_b64,
            is_processed: false,
        });
    }

    // Apply preprocessing via preview_preprocess.py.
    let preview_script =
        resolve_preview_preprocess_path(&app).map_err(|e| format!("preview script: {e}"))?;
    let python = resolve_python_command(&app);

    let tmp_dir = cache.join(format!("{session_id}_preview_tmp"));
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

    let mut py_cmd = Command::new(&python);
    py_cmd.args([
        preview_script
            .to_str()
            .ok_or_else(|| "Invalid preview script path".to_string())?,
        "--input",
        &original_str,
        "--out-dir",
        &tmp_dir.to_string_lossy(),
        "--modules-json",
        &modules_json,
    ]);

    let output = py_cmd
        .output()
        .map_err(|e| format!("Python launch failed: {e}"))?;

    // Cleanup original window (no longer needed after Python reads it).
    let _ = fs::remove_file(&original_out);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!(
            "preview_preprocess failed ({}): {}",
            output.status,
            stderr.trim()
        ));
    }

    let processed_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if processed_path.is_empty() {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err("preview_preprocess produced no output path".into());
    }
    let processed_file = Path::new(&processed_path);
    if !processed_file.is_file() {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(format!("preview_preprocess output not found: {processed_path}"));
    }

    let processed_bytes = fs::read(processed_file).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&tmp_dir);

    if processed_bytes.len() as u64 > MAX_READ_WAV_BYTES_FOR_B64 {
        return Err(format!(
            "Processed WAV too large ({} bytes).",
            processed_bytes.len()
        ));
    }
    let processed_b64 = general_purpose::STANDARD.encode(&processed_bytes);

    // Reload original for the returned original_b64 (we deleted the file above).
    // Re-encode from the bytes we already have.
    Ok(PreprocessedAudioPreview {
        original_b64,
        processed_b64,
        is_processed: true,
    })
}
