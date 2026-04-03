//! WX-718 — Création d'un run d'annotation directe (import transcript SRT/VTT/JSON sans ASR).
//!
//! La commande `create_annotation_run` spawn Python (`whisperx import_transcript`) et retourne
//! le run_dir créé au frontend pour basculer directement vers le Player ou l'Éditeur.

use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;
use crate::python_runtime::resolve_python_command;
use std::path::Path;

/// Réponse de `__WXRESULT__` depuis Python.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnnotationRunResponse {
    pub run_dir: String,
    pub run_id: String,
    pub warnings: Vec<String>,
}

/// Réponse d'erreur éventuelle du process Python.
#[derive(Debug, Deserialize)]
struct PythonError {
    error: String,
}

/// Crée un run d'annotation directe depuis un fichier audio + transcript optionnel.
///
/// - `audio_path`      : chemin absolu vers le fichier audio source.
/// - `transcript_path` : chemin vers SRT/VTT/JSON existant (null = run vide).
/// - `output_dir`      : répertoire racine ; un sous-dossier `runs/<id>/` y sera créé.
/// - `language`        : code langue optionnel (ex. "fr").
/// - `analysis_args`   : arguments supplémentaires passés tels quels à Python
///                       (ex. `["--analysis_pause_min", "0.2"]`).
#[tauri::command]
pub async fn create_annotation_run(
    app: AppHandle,
    audio_path: String,
    transcript_path: Option<String>,
    output_dir: String,
    language: Option<String>,
    analysis_args: Option<Vec<String>>,
) -> Result<CreateAnnotationRunResponse, String> {
    // Valider les chemins
    validate_path_string(&audio_path)?;
    if !Path::new(&audio_path).exists() {
        return Err(format!(
            "Fichier audio introuvable : {}",
            redact_user_home_in_text(&audio_path)
        ));
    }

    if let Some(ref tp) = transcript_path {
        validate_path_string(tp)?;
        if !Path::new(tp).exists() {
            return Err(format!(
                "Transcript introuvable : {}",
                redact_user_home_in_text(tp)
            ));
        }
    }

    validate_path_string(&output_dir)?;
    std::fs::create_dir_all(&output_dir).map_err(|e| {
        format!(
            "Impossible de créer output_dir : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    // Construire les arguments Python
    let python_cmd = resolve_python_command(&app);
    let mut args: Vec<String> = vec![
        "-m".into(),
        "whisperx".into(),
        "import_transcript".into(),
        audio_path.clone(),
        "--output_dir".into(),
        output_dir.clone(),
    ];

    if let Some(ref tp) = transcript_path {
        args.push("--transcript".into());
        args.push(tp.clone());
    }

    if let Some(ref lang) = language {
        args.push("--language".into());
        args.push(lang.clone());
    }

    if let Some(extra) = analysis_args {
        args.extend(extra);
    }

    // Spawn Python synchrone (le process peut durer quelques secondes)
    let output = Command::new(&python_cmd)
        .args(&args)
        .output()
        .map_err(|e| {
            format!(
                "Impossible de lancer Python pour import_transcript : {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let short: String = stderr.chars().take(500).collect();
        return Err(format!(
            "import_transcript a échoué : {}",
            redact_user_home_in_text(&short)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Chercher la sentinelle __WXRESULT__ dans stdout
    for line in stdout.lines().rev() {
        if let Some(json_str) = line.strip_prefix("__WXRESULT__") {
            // Vérifier si c'est une erreur Python
            if let Ok(err_obj) = serde_json::from_str::<PythonError>(json_str) {
                return Err(format!(
                    "import_transcript : {}",
                    redact_user_home_in_text(&err_obj.error)
                ));
            }
            return serde_json::from_str::<CreateAnnotationRunResponse>(json_str).map_err(|e| {
                format!(
                    "Impossible de parser la réponse de import_transcript : {}",
                    redact_user_home_in_text(&e.to_string())
                )
            });
        }
    }

    Err("import_transcript n'a retourné aucun résultat __WXRESULT__".into())
}
