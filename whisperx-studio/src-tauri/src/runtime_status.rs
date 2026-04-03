//! Commande Tauri: diagnostic runtime local (Python, WhisperX, ffmpeg).

use tauri::AppHandle;

use crate::ffmpeg_tools::{resolve_ffmpeg_tools, run_probe};
use crate::log_redaction::redact_user_home_in_text;
use crate::models::{RuntimeStatus, TorchProbeResult};
use crate::python_runtime::resolve_python_command;

/// Sondage torch (CUDA / MPS / défaut identique au CLI WhisperX).
const TORCH_PROBE_PY: &str = r#"import json,sys;import torch;cuda=torch.cuda.is_available();mps=getattr(torch.backends,"mps",None)is not None and torch.backends.mps.is_available();print(json.dumps({"platform":sys.platform,"torchCuda":cuda,"torchMps":mps,"whisperxDefaultDevice":("cuda" if cuda else "cpu")}))"#;

fn build_runtime_status(app: AppHandle) -> RuntimeStatus {
    let python_command = resolve_python_command(&app);
    let ffmpeg_tools = resolve_ffmpeg_tools(&app);
    let mut python_ok = false;
    let mut whisperx_ok = false;
    let mut ffmpeg_ok = false;
    let mut whisperx_version: Option<String> = None;
    let mut details: Vec<String> = Vec::new();
    let mut python_platform: Option<String> = None;
    let mut torch_cuda_available = false;
    let mut torch_mps_available = false;
    let mut whisperx_default_device: Option<String> = None;
    let mut demucs_ok = false;
    let mut demucs_version: Option<String> = None;

    match run_probe(
        &python_command,
        &["-c", "import sys; print(sys.executable)"],
        None,
    ) {
        Ok(executable) => {
            python_ok = true;
            details.push(format!(
                "python ok: {}",
                redact_user_home_in_text(&executable)
            ));
        }
        Err(err) => {
            details.push(format!("python error: {}", redact_user_home_in_text(&err)));
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
                details.push(format!(
                    "whisperx error: {}",
                    redact_user_home_in_text(&err)
                ));
            }
        }
    }

    if whisperx_ok {
        match run_probe(&python_command, &["-c", TORCH_PROBE_PY], None) {
            Ok(line) => {
                let trimmed = line.trim();
                match serde_json::from_str::<TorchProbeResult>(trimmed) {
                    Ok(probe) => {
                        python_platform = Some(probe.platform.clone());
                        torch_cuda_available = probe.torch_cuda;
                        torch_mps_available = probe.torch_mps;
                        whisperx_default_device = Some(probe.whisperx_default_device.clone());
                        details.push(format!(
                            "torch probe: platform={} cuda={} mps={} whisperx_default={}",
                            probe.platform,
                            probe.torch_cuda,
                            probe.torch_mps,
                            probe.whisperx_default_device
                        ));
                    }
                    Err(err) => {
                        details.push(redact_user_home_in_text(&format!(
                            "torch probe parse error: {err} (output: {trimmed})"
                        )));
                    }
                }
            }
            Err(err) => {
                details.push(format!(
                    "torch probe error: {}",
                    redact_user_home_in_text(&err)
                ));
            }
        }
    }

    // WX-666 — probe Demucs availability
    if python_ok {
        match run_probe(
            &python_command,
            &[
                "-c",
                "import importlib.metadata as md; print(md.version('demucs'))",
            ],
            None,
        ) {
            Ok(version) => {
                demucs_ok = true;
                demucs_version = Some(version.clone());
                details.push(format!("demucs ok: {version}"));
            }
            Err(_) => {
                details.push("demucs not installed".into());
            }
        }
    }

    if let Some(dir) = ffmpeg_tools.ffmpeg_dir.as_deref() {
        details.push(format!(
            "ffmpeg dir: {}",
            redact_user_home_in_text(&dir.to_string_lossy())
        ));
    }
    match run_probe(
        &ffmpeg_tools.ffmpeg_command,
        &["-version"],
        ffmpeg_tools.ffmpeg_dir.as_deref(),
    ) {
        Ok(output) => {
            ffmpeg_ok = true;
            let first_line = output.lines().next().unwrap_or("ffmpeg available");
            details.push(format!(
                "ffmpeg ok: {}",
                redact_user_home_in_text(first_line)
            ));
        }
        Err(err) => {
            details.push(format!("ffmpeg error: {}", redact_user_home_in_text(&err)));
        }
    }

    RuntimeStatus {
        python_command,
        python_ok,
        whisperx_ok,
        ffmpeg_ok,
        whisperx_version,
        details,
        python_platform,
        torch_cuda_available,
        torch_mps_available,
        whisperx_default_device,
        demucs_ok,
        demucs_version,
    }
}

/// Sondes Python / WhisperX / ffmpeg hors du thread async principal (évite de bloquer le runtime Tauri).
#[tauri::command]
pub async fn get_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    tokio::task::spawn_blocking(move || build_runtime_status(app))
        .await
        .map_err(|e| {
            format!(
                "Runtime status task failed: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })
}
