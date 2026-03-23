//! Resolution de l executable Python pour worker et diagnostics.

use std::path::PathBuf;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

pub(crate) fn resolve_python_command(app: &AppHandle) -> String {
    if let Ok(raw) = std::env::var("WHISPERX_STUDIO_PYTHON") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(data_dir) = app.path().app_local_data_dir() {
        #[cfg(target_os = "windows")]
        candidates.push(
            data_dir
                .join("python-runtime")
                .join("Scripts")
                .join("python.exe"),
        );
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(data_dir.join("python-runtime").join("bin").join("python3"));
            candidates.push(data_dir.join("python-runtime").join("bin").join("python"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(path) = app
            .path()
            .resolve("python-runtime/python.exe", BaseDirectory::Resource)
        {
            candidates.push(path);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(path) = app
            .path()
            .resolve("python-runtime/bin/python3", BaseDirectory::Resource)
        {
            candidates.push(path);
        }
        if let Ok(path) = app
            .path()
            .resolve("python-runtime/bin/python", BaseDirectory::Resource)
        {
            candidates.push(path);
        }
    }

    if let Some(project_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf())
    {
        #[cfg(target_os = "windows")]
        candidates.push(
            project_root
                .join(".venv")
                .join("Scripts")
                .join("python.exe"),
        );
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(project_root.join(".venv").join("bin").join("python3"));
            candidates.push(project_root.join(".venv").join("bin").join("python"));
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    "python".into()
}
