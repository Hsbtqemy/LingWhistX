//! WX-675 — Import d'un fichier d'annotation EAF/TextGrid depuis le frontend.
//!
//! Le Rust délègue le parsing à Python (`python -m whisperx import_annotation <path>`)
//! et retransmet le JSON résultant au frontend.

use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::resolve_existing_file_path;
use crate::python_runtime::resolve_python_command;

/// Un segment d'annotation : intervalle temporel + texte.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Un tier (piste) d'annotations — une entrée par locuteur / tier ELAN.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationTier {
    pub tier_id: String,
    pub segments: Vec<AnnotationSegment>,
}

/// Résultat complet de l'import, renvoyé au frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnnotationResponse {
    pub tiers: Vec<AnnotationTier>,
    pub media_path: Option<String>,
    pub duration_s: f64,
    pub source_format: String,
    pub warnings: Vec<String>,
}

/// Réponse d'erreur Python éventuelle.
#[derive(Debug, Deserialize)]
struct PythonError {
    error: String,
}

/// Commande Tauri exposée au frontend.
///
/// Appel: `invoke("import_annotation_file", { path: "/abs/path/file.eaf" })`
#[tauri::command]
pub async fn import_annotation_file(
    app: AppHandle,
    path: String,
) -> Result<ImportAnnotationResponse, String> {
    // 1. Validate path
    let resolved = resolve_existing_file_path(
        &path,
        "Annotation file does not exist",
        "Annotation path is not a file",
    )?;

    // 2. Check extension
    let ext = resolved
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "eaf" && ext != "textgrid" {
        return Err(format!(
            "Unsupported annotation format '.{ext}' — expected .eaf or .TextGrid"
        ));
    }

    // 3. Spawn Python parser
    let python_cmd = resolve_python_command(&app);
    let path_str = resolved.to_string_lossy().to_string();

    let output = Command::new(&python_cmd)
        .args(["-m", "whisperx", "import_annotation", &path_str])
        .output()
        .map_err(|e| {
            format!(
                "Failed to launch Python for annotation import: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let short_err: String = stderr.chars().take(400).collect();
        return Err(format!(
            "Python annotation import exited with error: {}",
            redact_user_home_in_text(&short_err)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();

    if trimmed.is_empty() {
        return Err("Python annotation import returned empty output".into());
    }

    // 4. Check for Python-reported errors
    if let Ok(err_obj) = serde_json::from_str::<PythonError>(trimmed) {
        return Err(format!(
            "Annotation import failed: {}",
            redact_user_home_in_text(&err_obj.error)
        ));
    }

    // 5. Deserialize the ImportedAnnotation result
    serde_json::from_str::<ImportAnnotationResponse>(trimmed)
        .map_err(|e| {
            format!(
                "Failed to parse annotation import JSON: {e} — raw: {}",
                redact_user_home_in_text(trimmed)
            )
        })
}
