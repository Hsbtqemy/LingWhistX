//! Installation guidée de ffmpeg (Homebrew / Linuxbrew, winget ou Chocolatey).

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::app_events::{emit_ffmpeg_install_finished, emit_ffmpeg_install_log};
use crate::ffmpeg_tools::{resolve_ffmpeg_tools, run_probe};
use crate::log_redaction::redact_user_home_in_text;
use crate::process_utils::hide_console_window;

#[cfg(not(target_os = "windows"))]
use std::path::PathBuf;

#[cfg(not(target_os = "windows"))]
fn find_homebrew() -> Option<PathBuf> {
    let candidates = [
        "/opt/homebrew/bin/brew",
        "/usr/local/bin/brew",
        "/home/linuxbrew/.linuxbrew/bin/brew",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.is_file() {
            return Some(p);
        }
    }
    std::env::var_os("PATH").and_then(|paths| {
        for dir in std::env::split_paths(&paths) {
            let b = dir.join("brew");
            if b.is_file() {
                return Some(b);
            }
        }
        None
    })
}

fn ffmpeg_detected_ok(app: &AppHandle) -> bool {
    let tools = resolve_ffmpeg_tools(app);
    run_probe(
        &tools.ffmpeg_command,
        &["-version"],
        tools.ffmpeg_dir.as_deref(),
    )
    .is_ok()
}

fn run_command_with_logs(app: &AppHandle, mut command: Command) -> Result<(), String> {
    hide_console_window(&mut command);
    let mut child = command.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            return "Executable introuvable (PATH).".to_string();
        }
        format!(
            "Impossible de lancer la commande: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stdout indisponible".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "stderr indisponible".to_string())?;

    let stderr_acc = Arc::new(Mutex::new(Vec::<String>::new()));

    let stdout_app = app.clone();
    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                emit_ffmpeg_install_log(&stdout_app, "stdout", trimmed);
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
            emit_ffmpeg_install_log(&stderr_app, "stderr", trimmed);
            if let Ok(mut lock) = stderr_acc_clone.lock() {
                lock.push(trimmed.to_string());
            }
        }
    });

    let status = child.wait().map_err(|err| {
        format!(
            "Attente processus: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if !status.success() {
        let details = stderr_acc
            .lock()
            .ok()
            .and_then(|lock| lock.last().cloned())
            .unwrap_or_else(|| "echec sans detail stderr.".into());
        return Err(format!(
            "Commande terminee avec erreur: {}",
            redact_user_home_in_text(&details)
        ));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_program_version_ok(program: &str) -> bool {
    let mut c = Command::new(program);
    c.arg("--version");
    hide_console_window(&mut c);
    c.output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
pub(crate) fn run_ffmpeg_install_process(app: &AppHandle) -> Result<(), String> {
    let mut command = if windows_program_version_ok("winget") {
        emit_ffmpeg_install_log(
            app,
            "system",
            "Utilisation de winget (package Gyan.FFmpeg).",
        );
        let mut c = Command::new("winget");
        c.args([
            "install",
            "-e",
            "--id",
            "Gyan.FFmpeg",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ]);
        c
    } else if windows_program_version_ok("choco") {
        emit_ffmpeg_install_log(app, "system", "Utilisation de Chocolatey (ffmpeg).");
        let mut c = Command::new("choco");
        c.args(["install", "ffmpeg", "-y"]);
        c
    } else {
        return Err(
            "winget et choco introuvables. Installe ffmpeg manuellement ou ajoute winget / Chocolatey au PATH."
                .into(),
        );
    };

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    run_command_with_logs(app, command)?;

    if ffmpeg_detected_ok(app) {
        emit_ffmpeg_install_finished(app, true, "ffmpeg installe et detecte par Studio.".into());
        return Ok(());
    }

    emit_ffmpeg_install_finished(
        app,
        true,
        "Installation terminee. Redemarre WhisperX Studio pour que le PATH soit mis a jour, puis « Verifier le runtime »."
            .into(),
    );
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn run_ffmpeg_install_process(app: &AppHandle) -> Result<(), String> {
    let brew = find_homebrew().ok_or_else(|| {
        "Homebrew (brew) introuvable. macOS : https://brew.sh — Linux : https://docs.brew.sh/Homebrew-on-Linux ou installe ffmpeg avec ton gestionnaire de paquets (ex. sudo apt install ffmpeg).".to_string()
    })?;

    emit_ffmpeg_install_log(app, "system", &format!("Utilisation de {}", brew.display()));

    let mut command = Command::new(&brew);
    command.args(["install", "ffmpeg"]).stdout(Stdio::piped()).stderr(Stdio::piped());

    run_command_with_logs(app, command)?;

    if ffmpeg_detected_ok(app) {
        emit_ffmpeg_install_finished(app, true, "ffmpeg installe et detecte par Studio.".into());
        return Ok(());
    }

    emit_ffmpeg_install_finished(
        app,
        true,
        "brew install termine. Rouvre le terminal ou redemarre l'app, puis « Verifier le runtime »."
            .into(),
    );
    Ok(())
}
