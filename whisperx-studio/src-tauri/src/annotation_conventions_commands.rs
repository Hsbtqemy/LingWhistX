//! WX-719 — Commandes Tauri pour les conventions d'annotation utilisateur.
//!
//! Les conventions built-in (ICOR, CHAT, minimaliste) sont définies côté TS dans constants.ts
//! et ne sont pas stockées sur disque. Seules les conventions personnalisées de l'utilisateur
//! sont persistées dans `appDataDir/annotation_conventions/*.json`.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

use crate::log_redaction::redact_user_home_in_text;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationMarkJson {
    pub id: String,
    pub label: String,
    pub symbol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationConventionJson {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub marks: Vec<AnnotationMarkJson>,
}

fn conventions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| {
        format!(
            "appDataDir indisponible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    let dir = base.join("annotation_conventions");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| {
            format!(
                "Création annotation_conventions/ impossible : {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
    }
    Ok(dir)
}

fn validate_convention_id(id: &str) -> Result<String, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("L'id de la convention ne peut pas être vide.".into());
    }
    if id.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err(format!(
            "Id de convention invalide (alphanum, _ et - uniquement) : {id}"
        ));
    }
    // Empêcher d'écraser les conventions built-in
    if matches!(id.as_str(), "icor" | "chat" | "minimal") {
        return Err(format!(
            "'{id}' est une convention built-in et ne peut pas être modifiée."
        ));
    }
    Ok(id)
}

/// Retourne toutes les conventions utilisateur stockées dans `appDataDir/annotation_conventions/`.
#[tauri::command]
pub fn read_user_conventions(app: AppHandle) -> Result<Vec<AnnotationConventionJson>, String> {
    let dir = conventions_dir(&app)?;
    let mut conventions = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| {
        format!(
            "Lecture annotation_conventions/ impossible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|e| {
            format!(
                "Entrée annotation_conventions/ invalide : {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).unwrap_or_default();
        match serde_json::from_str::<AnnotationConventionJson>(&raw) {
            Ok(c) => conventions.push(c),
            Err(e) => {
                eprintln!(
                    "[conventions] Fichier ignoré {} : {}",
                    path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("(sans nom)"),
                    redact_user_home_in_text(&e.to_string())
                );
            }
        }
    }
    conventions.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(conventions)
}

/// Sauvegarde ou écrase une convention utilisateur (`appDataDir/annotation_conventions/{id}.json`).
#[tauri::command]
pub fn save_user_convention(
    app: AppHandle,
    convention: AnnotationConventionJson,
) -> Result<(), String> {
    let id = validate_convention_id(&convention.id)?;
    let dir = conventions_dir(&app)?;
    let path = dir.join(format!("{id}.json"));
    let json = serde_json::to_string_pretty(&convention).map_err(|e| {
        format!(
            "Sérialisation convention impossible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    fs::write(&path, json).map_err(|e| {
        format!(
            "Écriture convention impossible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    Ok(())
}

/// Exporte une convention vers un fichier JSON à un chemin choisi par le frontend.
#[tauri::command]
pub fn export_convention_file(
    convention: AnnotationConventionJson,
    path: String,
) -> Result<(), String> {
    use crate::path_guard::validate_path_string;
    validate_path_string(&path)?;
    let json = serde_json::to_string_pretty(&convention).map_err(|e| {
        format!(
            "Sérialisation impossible : {}",
            crate::log_redaction::redact_user_home_in_text(&e.to_string())
        )
    })?;
    fs::write(&path, json).map_err(|e| {
        format!(
            "Écriture fichier impossible : {}",
            crate::log_redaction::redact_user_home_in_text(&e.to_string())
        )
    })?;
    Ok(())
}

/// Importe une convention depuis un fichier JSON à un chemin choisi par le frontend.
#[tauri::command]
pub fn import_convention_file(path: String) -> Result<AnnotationConventionJson, String> {
    use crate::path_guard::validate_path_string;
    validate_path_string(&path)?;
    let raw = fs::read_to_string(&path).map_err(|e| {
        format!(
            "Lecture fichier impossible : {}",
            crate::log_redaction::redact_user_home_in_text(&e.to_string())
        )
    })?;
    let convention: AnnotationConventionJson =
        serde_json::from_str(&raw).map_err(|e| format!("JSON invalide : {e}"))?;
    if convention.id.trim().is_empty() || convention.label.trim().is_empty() {
        return Err("Le fichier ne contient pas une convention valide (id ou label manquant).".into());
    }
    Ok(convention)
}

/// Supprime une convention utilisateur.
#[tauri::command]
pub fn delete_user_convention(app: AppHandle, id: String) -> Result<(), String> {
    let id = validate_convention_id(&id)?;
    let dir = conventions_dir(&app)?;
    let path = dir.join(format!("{id}.json"));
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|e| {
        format!(
            "Suppression convention impossible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    Ok(())
}
