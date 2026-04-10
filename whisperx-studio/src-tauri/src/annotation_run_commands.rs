//! WX-718 — Création d'un run d'annotation directe (import transcript SRT/VTT/JSON sans ASR).
//! WX-733 — `create_blank_annotation_run` : run vide entièrement en Rust (pas de Python).
//!
//! La commande `create_annotation_run` spawn Python (`whisperx import_transcript`) pour les cas
//! avec transcript existant (SRT/VTT/JSON).
//! La commande `create_blank_annotation_run` crée directement le run en Rust pour les runs vides.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;
use crate::process_utils::hide_console_window;
use crate::python_runtime::resolve_python_command;

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
    let mut py = Command::new(&python_cmd);
    py.args(&args);
    hide_console_window(&mut py);
    let output = py
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

/// WX-733 — Crée un run d'annotation vide entièrement en Rust (sans Python).
///
/// Écrit trois fichiers dans `output_dir/runs/<ts>_<id>/` :
/// - `<stem>.json`          : transcript vide `{"segments": [], "editedBy": "whisperx-studio"}`
/// - `<stem>.timeline.json` : timeline vide (structure WX-600+)
/// - `run_manifest.json`    : manifest v1 référençant les deux artefacts
#[tauri::command]
pub fn create_blank_annotation_run(
    audio_path: String,
    output_dir: String,
) -> Result<CreateAnnotationRunResponse, String> {
    validate_path_string(&audio_path)?;
    if !Path::new(&audio_path).exists() {
        return Err(format!(
            "Fichier audio introuvable : {}",
            redact_user_home_in_text(&audio_path)
        ));
    }
    validate_path_string(&output_dir)?;

    // Allouer le dossier de run : output_dir/runs/<ts>_<id>/
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // ISO-8601 UTC compact depuis epoch secondes
    let ts = {
        let secs = now;
        let s = secs % 60;
        let m = (secs / 60) % 60;
        let h = (secs / 3600) % 24;
        let days = secs / 86400;
        // Algorithme de Fliegel & Van Flandern pour Julian Day → Gregorian
        let z = days + 2440588; // JD epoch offset
        let a = (z as f64 - 1867216.25) / 36524.25;
        let a = z + 1 + a as u64 - (a as u64 / 4);
        let b = a + 1524;
        let c = ((b as f64 - 122.1) / 365.25) as u64;
        let d = (365.25 * c as f64) as u64;
        let e = ((b - d) as f64 / 30.6001) as u64;
        let day = b - d - (30.6001 * e as f64) as u64;
        let month = if e < 14 { e - 1 } else { e - 13 };
        let year = if month > 2 { c - 4716 } else { c - 4715 };
        format!(
            "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
            year, month, day, h, m, s
        )
    };
    let short_id: String = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        now.hash(&mut h);
        audio_path.hash(&mut h);
        format!("{:08x}", h.finish() as u32)
    };
    let run_id = format!("{}_{}", ts, short_id);
    let run_dir = Path::new(&output_dir).join("runs").join(&run_id);
    std::fs::create_dir_all(&run_dir).map_err(|e| {
        format!(
            "Impossible de créer le dossier de run : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    let audio_stem = Path::new(&audio_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "audio".to_string());

    // 1. Transcript vide
    let run_json_rel = format!("{}.json", audio_stem);
    let run_json_path = run_dir.join(&run_json_rel);
    let transcript_json = serde_json::json!({
        "segments": [],
        "editedBy": "whisperx-studio"
    });
    write_json(&run_json_path, &transcript_json)?;

    // 2. Timeline vide (structure WX-600+)
    let timeline_json_rel = format!("{}.timeline.json", audio_stem);
    let timeline_json_path = run_dir.join(&timeline_json_rel);
    let timeline_json = serde_json::json!({
        "version": 1,
        "words": [],
        "segments": [],
        "speaker_turns": [],
        "events": [],
        "analysis": {
            "config": {},
            "pauses": [],
            "nonspeech_intervals": [],
            "ipus": [],
            "transitions": [],
            "overlaps": []
        }
    });
    write_json(&timeline_json_path, &timeline_json)?;

    // 3. Manifest v1
    let created_at = ts.clone();
    let audio_path_abs = std::fs::canonicalize(&audio_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| audio_path.clone());
    let run_dir_str = run_dir.to_string_lossy().to_string();
    let manifest = serde_json::json!({
        "schema_version": 1,
        "run_id": run_id,
        "created_at": created_at,
        "input_media": {
            "path": audio_path_abs,
            "duration": 0.0
        },
        "pipeline": {
            "language": "unknown"
        },
        "env": {},
        "artifacts": {
            "run_json": run_json_rel,
            "timeline_json": timeline_json_rel
        },
        "warnings": ["Run vide créé pour annotation manuelle."],
        "stats": {
            "n_segments": 0,
            "n_words": 0,
            "n_speaker_turns": 0,
            "n_pauses": 0,
            "n_ipus": 0
        }
    });
    let manifest_path = run_dir.join("run_manifest.json");
    write_json(&manifest_path, &manifest)?;

    Ok(CreateAnnotationRunResponse {
        run_dir: run_dir_str,
        run_id,
        warnings: vec!["Run vide créé pour annotation manuelle.".into()],
    })
}

fn write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(value).map_err(|e| format!("Sérialisation JSON : {}", e))?;
    std::fs::write(path, text).map_err(|e| {
        format!(
            "Écriture {} : {}",
            redact_user_home_in_text(&path.to_string_lossy()),
            redact_user_home_in_text(&e.to_string())
        )
    })
}
