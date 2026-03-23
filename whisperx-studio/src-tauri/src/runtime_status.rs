//! Commande Tauri: diagnostic runtime local (Python, WhisperX, ffmpeg).

use tauri::AppHandle;

use crate::ffmpeg_tools::{resolve_ffmpeg_tools, run_probe};
use crate::models::RuntimeStatus;
use crate::python_runtime::resolve_python_command;

#[tauri::command]
pub fn get_runtime_status(app: AppHandle) -> RuntimeStatus {
    let python_command = resolve_python_command(&app);
    let ffmpeg_tools = resolve_ffmpeg_tools(&app);
    let mut python_ok = false;
    let mut whisperx_ok = false;
    let mut ffmpeg_ok = false;
    let mut whisperx_version: Option<String> = None;
    let mut details: Vec<String> = Vec::new();

    match run_probe(
        &python_command,
        &["-c", "import sys; print(sys.executable)"],
        None,
    ) {
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
            None,
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

    if let Some(dir) = ffmpeg_tools.ffmpeg_dir.as_deref() {
        details.push(format!("ffmpeg dir: {}", dir.to_string_lossy()));
    }
    match run_probe(
        &ffmpeg_tools.ffmpeg_command,
        &["-version"],
        ffmpeg_tools.ffmpeg_dir.as_deref(),
    ) {
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
