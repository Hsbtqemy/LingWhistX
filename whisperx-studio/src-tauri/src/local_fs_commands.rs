//! Commandes Tauri: ouverture explorateur / fichier, apercu texte, listage dossier.

use std::process::Command;

use tauri::AppHandle;

use crate::path_guard::{
    resolve_existing_file_path, resolve_existing_path_for_open, validate_delete_allowed_directory,
};

#[tauri::command]
pub fn open_local_path(path: String) -> Result<(), String> {
    let canon = resolve_existing_path_for_open(&path)?;
    let arg = canon.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(arg);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(arg);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(arg);
        cmd
    };

    command
        .spawn()
        .map_err(|err| format!("Unable to open path: {err}"))?;
    Ok(())
}

#[tauri::command]
pub fn read_text_preview(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let target = resolve_existing_file_path(
        &path,
        "Target file does not exist",
        "Target path is not a file",
    )?;

    let max = max_bytes.unwrap_or(200_000).clamp(1024, 2_000_000);
    let bytes = std::fs::read(&target).map_err(|err| format!("Unable to read file: {err}"))?;
    let truncated = bytes.len() > max;
    let slice = if truncated { &bytes[..max] } else { &bytes };
    let mut content = String::from_utf8_lossy(slice).to_string();
    if truncated {
        content.push_str(&format!(
            "\n\n[Preview truncated to {max} bytes out of {} bytes]",
            bytes.len()
        ));
    }
    Ok(content)
}

/// Liste les fichiers (non récursif) d’un dossier de sortie autorisé — pour suivi des exports pendant un job.
#[tauri::command]
pub fn list_directory_files(app: AppHandle, dir_path: String) -> Result<Vec<String>, String> {
    let dir = validate_delete_allowed_directory(&app, &dir_path)?;
    let read = std::fs::read_dir(&dir).map_err(|e| format!("Unable to read directory: {e}"))?;
    let mut out: Vec<String> = Vec::new();
    for entry in read {
        let entry = entry.map_err(|e| format!("Directory entry: {e}"))?;
        let p = entry.path();
        if p.is_file() {
            out.push(p.to_string_lossy().to_string());
        }
    }
    out.sort();
    Ok(out)
}
