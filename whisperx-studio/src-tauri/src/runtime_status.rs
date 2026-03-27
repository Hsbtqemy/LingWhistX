//! Commande Tauri: diagnostic runtime local (Python, WhisperX, ffmpeg).

use tauri::AppHandle;

use crate::ffmpeg_tools::{resolve_ffmpeg_tools, run_probe};
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
                            probe.platform, probe.torch_cuda, probe.torch_mps, probe.whisperx_default_device
                        ));
                    }
                    Err(err) => {
                        details.push(format!("torch probe parse error: {err} (output: {trimmed})"));
                    }
                }
            }
            Err(err) => {
                details.push(format!("torch probe error: {err}"));
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
        python_platform,
        torch_cuda_available,
        torch_mps_available,
        whisperx_default_device,
    }
}

/// Sondes Python / WhisperX / ffmpeg hors du thread async principal (évite de bloquer le runtime Tauri).
#[tauri::command]
pub async fn get_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    tokio::task::spawn_blocking(move || build_runtime_status(app))
        .await
        .map_err(|e| format!("Runtime status task failed: {e}"))
}
