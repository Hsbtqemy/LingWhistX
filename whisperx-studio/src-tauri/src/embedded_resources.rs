//! Scripts embarques (worker Python, setup runtime) et chemins de ressources.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::app_events::emit_runtime_setup_log;
use crate::log_redaction::redact_user_home_in_text;
use crate::process_utils::hide_console_window;

pub(crate) const EMBEDDED_WORKER_SCRIPT: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../python/worker.py"));
pub(crate) const EMBEDDED_STUDIO_AUDIO_MODULES: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../python/studio_audio_modules.py"
));
pub(crate) const EMBEDDED_PREVIEW_PREPROCESS_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../python/preview_preprocess.py"
));
pub(crate) const EMBEDDED_LOG_SANITIZE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../python/log_sanitize.py"
));
#[cfg(target_os = "windows")]
pub(crate) const EMBEDDED_RUNTIME_SETUP_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../scripts/setup-local-runtime.ps1"
));
#[cfg(not(target_os = "windows"))]
pub(crate) const EMBEDDED_RUNTIME_SETUP_MJS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../scripts/setup-local-runtime.mjs"
));

pub(crate) fn ensure_embedded_resource_file(
    app: &AppHandle,
    relative_path: &str,
    content: &str,
) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| {
            format!(
                "Unable to resolve app local data dir: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?
        .join("embedded-resources");
    let target = base_dir.join(relative_path);

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Unable to create embedded resource dir: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }

    let should_write = match std::fs::read_to_string(&target) {
        Ok(existing) => existing != content,
        Err(_) => true,
    };

    if should_write {
        std::fs::write(&target, content).map_err(|err| {
            format!(
                "Unable to write embedded resource file: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }

    Ok(target)
}

/// Garantit `log_sanitize.py`, `studio_audio_modules.py` et `preview_preprocess.py` au même répertoire que `worker.py`.
fn ensure_studio_audio_modules_adjacent(worker_path: &Path) -> Result<(), String> {
    let parent = worker_path
        .parent()
        .ok_or_else(|| "Worker path has no parent directory.".to_string())?;

    let log_sanitize_target = parent.join("log_sanitize.py");
    let should_write_log_sanitize = match std::fs::read_to_string(&log_sanitize_target) {
        Ok(existing) => existing != EMBEDDED_LOG_SANITIZE,
        Err(_) => true,
    };
    if should_write_log_sanitize {
        std::fs::write(&log_sanitize_target, EMBEDDED_LOG_SANITIZE).map_err(|err| {
            format!(
                "Unable to write log_sanitize.py: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }

    let target = parent.join("studio_audio_modules.py");
    let should_write = match std::fs::read_to_string(&target) {
        Ok(existing) => existing != EMBEDDED_STUDIO_AUDIO_MODULES,
        Err(_) => true,
    };
    if should_write {
        std::fs::write(&target, EMBEDDED_STUDIO_AUDIO_MODULES).map_err(|err| {
            format!(
                "Unable to write studio_audio_modules.py: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }

    let preview_target = parent.join("preview_preprocess.py");
    let should_write_preview = match std::fs::read_to_string(&preview_target) {
        Ok(existing) => existing != EMBEDDED_PREVIEW_PREPROCESS_SCRIPT,
        Err(_) => true,
    };
    if should_write_preview {
        std::fs::write(&preview_target, EMBEDDED_PREVIEW_PREPROCESS_SCRIPT).map_err(|err| {
            format!(
                "Unable to write preview_preprocess.py: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }

    Ok(())
}

/// Résout le chemin de `preview_preprocess.py` (adjacent à `worker.py`).
pub(crate) fn resolve_preview_preprocess_path(app: &AppHandle) -> Result<PathBuf, String> {
    let worker_path = resolve_worker_path(app)?;
    let parent = worker_path
        .parent()
        .ok_or_else(|| "Worker path has no parent directory.".to_string())?;
    Ok(parent.join("preview_preprocess.py"))
}

pub(crate) fn resolve_worker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let try_paths = [
        app.path()
            .resolve("python/worker.py", BaseDirectory::Resource),
        app.path().resolve("worker.py", BaseDirectory::Resource),
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "Unable to resolve project root".to_string())?
            .join("python")
            .join("worker.py")),
    ];

    for candidate in try_paths {
        match candidate {
            Ok(path) if path.exists() => {
                ensure_studio_audio_modules_adjacent(&path)?;
                return Ok(path);
            }
            _ => continue,
        }
    }

    let worker_path =
        ensure_embedded_resource_file(app, "python/worker.py", EMBEDDED_WORKER_SCRIPT).map_err(
            |err| {
                format!(
                    "Python worker script not found. Embedded fallback failed: {}",
                    redact_user_home_in_text(&err)
                )
            },
        )?;
    ensure_studio_audio_modules_adjacent(&worker_path)?;
    Ok(worker_path)
}

#[cfg(target_os = "windows")]
pub(crate) fn resolve_runtime_setup_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let try_paths = [
        app.path()
            .resolve("setup-local-runtime.ps1", BaseDirectory::Resource),
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

    ensure_embedded_resource_file(
        app,
        "scripts/setup-local-runtime.ps1",
        EMBEDDED_RUNTIME_SETUP_SCRIPT,
    )
    .map_err(|err| {
        format!(
            "Runtime setup script not found. Embedded fallback failed: {}",
            redact_user_home_in_text(&err)
        )
    })
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn resolve_runtime_setup_mjs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let try_paths = [
        app.path()
            .resolve("setup-local-runtime.mjs", BaseDirectory::Resource),
        app.path()
            .resolve("scripts/setup-local-runtime.mjs", BaseDirectory::Resource),
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "Unable to resolve project root".to_string())?
            .join("scripts")
            .join("setup-local-runtime.mjs")),
    ];

    for candidate in try_paths {
        match candidate {
            Ok(path) if path.exists() => return Ok(path),
            _ => continue,
        }
    }

    ensure_embedded_resource_file(
        app,
        "scripts/setup-local-runtime.mjs",
        EMBEDDED_RUNTIME_SETUP_MJS,
    )
    .map_err(|err| {
        format!(
            "Runtime setup script (mjs) not found. Embedded fallback failed: {}",
            redact_user_home_in_text(&err)
        )
    })
}

pub(crate) fn runtime_setup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|err| {
            format!(
                "Unable to resolve app local data dir: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?
        .join("python-runtime");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Unable to create runtime parent directory: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }
    Ok(path)
}

pub(crate) fn run_runtime_setup_process(app: &AppHandle) -> Result<(), String> {
    let runtime_dir = runtime_setup_dir(app)?;
    let runtime_dir_raw = runtime_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let (mut command, script_path) = {
        let script_path = resolve_runtime_setup_script_path(app)?;
        let mut cmd = Command::new("powershell");
        cmd.arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script_path)
            .arg("-RuntimeDir")
            .arg(&runtime_dir_raw)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console_window(&mut cmd);
        (cmd, script_path)
    };

    #[cfg(not(target_os = "windows"))]
    let (mut command, script_path) = {
        let script_path = resolve_runtime_setup_mjs_path(app)?;
        let mut cmd = Command::new("node");
        cmd.arg(&script_path)
            .env("RUNTIME_DIR", &runtime_dir_raw)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console_window(&mut cmd);
        (cmd, script_path)
    };

    emit_runtime_setup_log(
        app,
        "system",
        &format!(
            "Starting runtime setup script: {}",
            redact_user_home_in_text(&script_path.to_string_lossy())
        ),
    );

    let mut child = command.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            #[cfg(target_os = "windows")]
            {
                return "powershell not found to execute runtime setup script.".to_string();
            }
            #[cfg(not(target_os = "windows"))]
            {
                return "node not found to execute runtime setup script. Install Node.js or run `npm run runtime:setup` in whisperx-studio/.".to_string();
            }
        }
        format!(
            "Unable to start runtime setup process: {}",
            redact_user_home_in_text(&err.to_string())
        )
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
        for line in reader.lines().map_while(Result::ok) {
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
        for line in reader.lines().map_while(Result::ok) {
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

    let status = child.wait().map_err(|err| {
        format!(
            "Unable to wait runtime setup process: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if !status.success() {
        let details = stderr_acc
            .lock()
            .ok()
            .map(|lock| {
                let joined = lock.join("\n");
                if joined.len() > 8000 {
                    format!("{}…", joined.chars().take(8000).collect::<String>())
                } else {
                    joined
                }
            })
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Runtime setup failed without stderr details.".into());
        return Err(format!(
            "Runtime setup failed: {}",
            redact_user_home_in_text(&details)
        ));
    }

    Ok(())
}
