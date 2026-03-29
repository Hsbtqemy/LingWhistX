//! WX-656 — Commandes Tauri pour les profils utilisateur composites.
//!
//! Les profils sont stockés dans `appDataDir/profiles/*.json`.
//! Chaque fichier contient un objet JSON `UserProfileJson`.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

/// Profil utilisateur tel que sérialisé sur disque et échangé avec le frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileJson {
    pub id: String,
    pub label: String,
    pub description: String,
    /// Surcharges partielles — seuls les champs présents remplacent les défauts.
    pub overrides: serde_json::Value,
}

fn profiles_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("appDataDir indisponible : {e}"))?;
    let dir = base.join("profiles");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Création profiles/ impossible : {e}"))?;
    }
    Ok(dir)
}

/// Retourne tous les profils utilisateur stockés dans `appDataDir/profiles/`.
#[tauri::command]
pub fn read_user_profiles(app: AppHandle) -> Result<Vec<UserProfileJson>, String> {
    let dir = profiles_dir(&app)?;
    let mut profiles = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Lecture profiles/ impossible : {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Entrée profiles/ invalide : {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let raw =
            fs::read_to_string(&path).map_err(|e| format!("Lecture {} impossible : {e}", path.display()))?;
        match serde_json::from_str::<UserProfileJson>(&raw) {
            Ok(profile) => profiles.push(profile),
            Err(e) => {
                // Fichier corrompu : on l'ignore silencieusement (log uniquement).
                eprintln!("[profiles] Fichier ignoré {} : {e}", path.display());
            }
        }
    }
    profiles.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(profiles)
}

/// Sauvegarde ou écrase un profil utilisateur (`appDataDir/profiles/{id}.json`).
#[tauri::command]
pub fn save_user_profile(app: AppHandle, profile: UserProfileJson) -> Result<(), String> {
    let id = profile.id.trim().to_string();
    if id.is_empty() {
        return Err("L'id du profil ne peut pas être vide.".into());
    }
    // Sécurité : l'id ne doit contenir que des caractères sûrs pour un nom de fichier.
    if id.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err(format!("Id profil invalide (alphanum, _ et - uniquement) : {id}"));
    }
    let dir = profiles_dir(&app)?;
    let path = dir.join(format!("{id}.json"));
    let json = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Sérialisation profil impossible : {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Écriture profil impossible : {e}"))?;
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
    fs::remove_file(&path).map_err(|e| format!("Suppression profil impossible : {e}"))?;
    Ok(())
}
