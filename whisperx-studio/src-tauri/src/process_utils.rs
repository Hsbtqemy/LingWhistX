//! Arrêt de processus (waveform / jobs).
//!
//! **Annulation de job** : `cancel_job` appelle `kill_process_tree(pid)` pour le worker Python.
//! - **Windows** : `taskkill /PID … /T /F` tue le processus et ses enfants.
//! - **Unix** : `kill -TERM <pid>` cible le PID racine ; les processus enfants peuvent nécessiter une
//!   stratégie de groupe de processus si le worker fork sans rester dans le même arbre (limitation connue).

use std::process::Command;

use crate::log_redaction::redact_user_home_in_text;

/// Sous Windows, évite les fenêtres console qui s’ouvrent puis se referment lorsque l’app desktop
/// lance un sous-processus (Python, ffmpeg, winget, etc.).
#[cfg(windows)]
pub(crate) fn hide_console_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_console_window(_cmd: &mut Command) {}

#[cfg(target_os = "windows")]
pub(crate) fn kill_process_tree(pid: u32) -> Result<(), String> {
    let mut taskkill = Command::new("taskkill");
    taskkill.args(["/PID", &pid.to_string(), "/T", "/F"]);
    hide_console_window(&mut taskkill);
    let output = taskkill.output().map_err(|err| {
        format!(
            "Failed to execute taskkill: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!(
            "taskkill failed: {}",
            redact_user_home_in_text(&stderr)
        ))
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn kill_process_tree(pid: u32) -> Result<(), String> {
    let output = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
        .map_err(|err| {
            format!(
                "Failed to execute kill: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!(
            "kill failed: {}",
            redact_user_home_in_text(&stderr)
        ))
    }
}
