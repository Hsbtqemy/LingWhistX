//! Arrêt de processus (waveform / jobs).
//!
//! **Annulation de job** : `cancel_job` appelle `kill_process_tree(pid)` pour le worker Python.
//! - **Windows** : `taskkill /PID … /T /F` tue le processus et ses enfants.
//! - **Unix** : `kill -TERM <pid>` cible le PID racine ; les processus enfants peuvent nécessiter une
//!   stratégie de groupe de processus si le worker fork sans rester dans le même arbre (limitation connue).

use std::process::Command;

#[cfg(target_os = "windows")]
pub(crate) fn kill_process_tree(pid: u32) -> Result<(), String> {
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
pub(crate) fn kill_process_tree(pid: u32) -> Result<(), String> {
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
