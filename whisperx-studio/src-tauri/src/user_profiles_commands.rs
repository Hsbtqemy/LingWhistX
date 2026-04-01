//! WX-656 — Commandes Tauri pour les profils utilisateur composites.
//!
//! Les profils sont stockés dans `appDataDir/profiles/*.json`.
//! Chaque fichier contient un objet JSON `UserProfileJson`.
//!
//! WX-680 — Versionnement `schema_version` avec migration forward silencieuse.
//! Les profils écrits avant WX-680 ont `schema_version` absent (désérialisé à 0).
//! À la lecture, ils sont migrés vers `PROFILE_SCHEMA_VERSION` et réécrits sur disque.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

use crate::log_redaction::redact_user_home_in_text;

/// Version courante du schéma de profil. Incrémenter lors de toute migration structurelle.
const PROFILE_SCHEMA_VERSION: u32 = 1;

/// Profil utilisateur tel que sérialisé sur disque et échangé avec le frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileJson {
    pub id: String,
    pub label: String,
    pub description: String,
    /// Surcharges partielles — seuls les champs présents remplacent les défauts.
    pub overrides: serde_json::Value,
    /// WX-680 — Version du schéma. Absent dans les profils pré-WX-680 (désérialisé à 0).
    #[serde(default)]
    pub schema_version: u32,
}

fn profiles_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            format!(
                "appDataDir indisponible : {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
    let dir = base.join("profiles");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Création profiles/ impossible : {e}"))?;
    }
    Ok(dir)
}

/// Applique les migrations forward sur un profil chargé depuis le disque.
/// Retourne `true` si le profil a été modifié et doit être réécrit.
fn migrate_profile(profile: &mut UserProfileJson) -> bool {
    if profile.schema_version >= PROFILE_SCHEMA_VERSION {
        return false;
    }
    // v0 → v1 : ajout du champ schema_version (aucune migration structurelle des données).
    // Les migrations futures ajouteront des branches ici.
    profile.schema_version = PROFILE_SCHEMA_VERSION;
    true
}

/// Retourne tous les profils utilisateur stockés dans `appDataDir/profiles/`.
#[tauri::command]
pub fn read_user_profiles(app: AppHandle) -> Result<Vec<UserProfileJson>, String> {
    let dir = profiles_dir(&app)?;
    let mut profiles = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| {
        format!(
            "Lecture profiles/ impossible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|e| {
            format!(
                "Entrée profiles/ invalide : {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| {
            let label = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("(fichier)");
            format!(
                "Lecture {label} impossible : {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
        match serde_json::from_str::<UserProfileJson>(&raw) {
            Ok(mut profile) => {
                if migrate_profile(&mut profile) {
                    // Réécriture silencieuse pour pérenniser la migration.
                    if let Ok(json) = serde_json::to_string_pretty(&profile) {
                        let _ = fs::write(&path, json);
                    }
                }
                profiles.push(profile);
            }
            Err(e) => {
                // Fichier corrompu : on l'ignore silencieusement (log uniquement).
                eprintln!(
                    "[profiles] Fichier ignoré {} : {e}",
                    path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("(sans nom)")
                );
            }
        }
    }
    profiles.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(profiles)
}

/// Sauvegarde ou écrase un profil utilisateur (`appDataDir/profiles/{id}.json`).
#[tauri::command]
pub fn save_user_profile(app: AppHandle, mut profile: UserProfileJson) -> Result<(), String> {
    let id = profile.id.trim().to_string();
    if id.is_empty() {
        return Err("L'id du profil ne peut pas être vide.".into());
    }
    // Sécurité : l'id ne doit contenir que des caractères sûrs pour un nom de fichier.
    if id.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err(format!("Id profil invalide (alphanum, _ et - uniquement) : {id}"));
    }
    // WX-680 — Toujours persister avec la version courante du schéma.
    profile.schema_version = PROFILE_SCHEMA_VERSION;
    let dir = profiles_dir(&app)?;
    let path = dir.join(format!("{id}.json"));
    let json = serde_json::to_string_pretty(&profile).map_err(|e| {
        format!(
            "Sérialisation profil impossible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    fs::write(&path, json)
        .map_err(|e| format!("Écriture profil impossible : {}", redact_user_home_in_text(&e.to_string())))?;
    Ok(())
}

/// Supprime un profil utilisateur (`appDataDir/profiles/{id}.json`).
#[tauri::command]
pub fn delete_user_profile(app: AppHandle, id: String) -> Result<(), String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("L'id du profil ne peut pas être vide.".into());
    }
    if id.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err(format!("Id profil invalide : {id}"));
    }
    let dir = profiles_dir(&app)?;
    let path = dir.join(format!("{id}.json"));
    if !path.exists() {
        return Ok(()); // Idempotent : pas d'erreur si déjà absent.
    }
    fs::remove_file(&path).map_err(|e| {
        format!(
            "Suppression profil impossible : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    Ok(())
}
