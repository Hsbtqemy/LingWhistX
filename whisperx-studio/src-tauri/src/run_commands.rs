//! WX-611 — Lecture et validation de `run_manifest.json` (pipeline WhisperX),
//! liste des dossiers de run récents (persistance locale).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tauri::Manager;

use crate::path_guard::validate_path_string;
use crate::time_utils::now_ms;

const RECENT_RUNS_MAX: usize = 20;
const RECENT_RUNS_FILE: &str = "recent_runs.json";

fn recent_runs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Unable to create app data dir: {err}"))?;
    Ok(dir.join(RECENT_RUNS_FILE))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunManifestSummary {
    /// Dossier du run (chemin canonique).
    pub run_dir: String,
    pub manifest_path: String,
    pub schema_version: i64,
    pub run_id: String,
    pub created_at: Option<String>,
    /// Chemin média tel que présent dans le manifest (affichage).
    pub input_media_path: Option<String>,
    /// Chemin absolu résolu quand possible (média existant).
    pub input_media_resolved: Option<String>,
    pub duration_sec: Option<f64>,
    pub artifact_count: usize,
    pub artifact_keys: Vec<String>,
    pub warnings: Vec<String>,
    pub stats_n_segments: Option<i64>,
    pub stats_n_words: Option<i64>,
    pub stats_n_speaker_turns: Option<i64>,
    pub stats_n_pauses: Option<i64>,
    pub stats_n_ipus: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RecentRunsStore {
    entries: Vec<RecentRunEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRunEntry {
    pub run_dir: String,
    pub run_id: String,
    pub last_opened_at_ms: u64,
}

fn resolve_run_dir_and_manifest(input: &str) -> Result<(PathBuf, PathBuf), String> {
    validate_path_string(input)?;
    let trimmed = input.trim();
    let p = Path::new(trimmed);
    if !p.exists() {
        return Err("Le chemin n'existe pas.".into());
    }
    if p.is_dir() {
        let run_dir = p
            .canonicalize()
            .map_err(|e| format!("Impossible de canoniser le dossier: {e}"))?;
        let manifest = run_dir.join("run_manifest.json");
        if !manifest.is_file() {
            return Err("run_manifest.json introuvable dans ce dossier.".into());
        }
        return Ok((run_dir, manifest));
    }
    if p.is_file() {
        let name = p.file_name().and_then(|n| n.to_str());
        if name != Some("run_manifest.json") {
            return Err("Indique un dossier de run ou le fichier run_manifest.json.".into());
        }
        let manifest = p
            .canonicalize()
            .map_err(|e| format!("Impossible de canoniser le manifest: {e}"))?;
        let run_dir = manifest
            .parent()
            .ok_or_else(|| "Manifest sans dossier parent.".to_string())?
            .canonicalize()
            .map_err(|e| format!("Impossible de canoniser le dossier du run: {e}"))?;
        return Ok((run_dir, manifest));
    }
    Err("Chemin invalide.".into())
}

fn as_str(v: &Value) -> Option<String> {
    v.as_str().map(|s| s.to_string())
}

fn resolve_media_path(run_dir: &Path, raw: &str) -> (Option<String>, Option<String>) {
    let display = Some(raw.to_string());
    let p = Path::new(raw);
    let resolved = if p.is_absolute() {
        p.canonicalize()
            .ok()
            .map(|x| x.to_string_lossy().to_string())
    } else {
        let joined = run_dir.join(raw);
        joined.canonicalize().ok().map(|x| x.to_string_lossy().to_string())
    };
    (display, resolved)
}

fn parse_run_manifest_summary(run_dir: &Path, manifest_path: &Path) -> Result<RunManifestSummary, String> {
    let text = fs::read_to_string(manifest_path)
        .map_err(|e| format!("Lecture run_manifest.json: {e}"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("JSON invalide: {e}"))?;

    let schema_version = v
        .get("schema_version")
        .and_then(|x| x.as_i64())
        .ok_or_else(|| "Champ schema_version manquant ou invalide.".to_string())?;
    if schema_version != 1 {
        return Err(format!(
            "schema_version {schema_version} non pris en charge (attendu: 1)."
        ));
    }

    let run_id = v
        .get("run_id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "run_id manquant.".to_string())?
        .to_string();

    let created_at = v.get("created_at").and_then(as_str);

    let mut input_media_path = None;
    let mut input_media_resolved = None;
    let mut duration_sec = None;

    if let Some(im) = v.get("input_media").and_then(|x| x.as_object()) {
        if let Some(p) = im.get("path").and_then(|x| x.as_str()) {
            let (disp, res) = resolve_media_path(run_dir, p);
            input_media_path = disp;
            input_media_resolved = res;
        }
        if let Some(d) = im.get("duration").and_then(|x| x.as_f64()) {
            duration_sec = Some(d);
        }
    }

    let mut artifact_keys: Vec<String> = Vec::new();
    if let Some(art) = v.get("artifacts").and_then(|x| x.as_object()) {
        for k in art.keys() {
            artifact_keys.push(k.clone());
        }
        artifact_keys.sort();
    }

    let warnings: Vec<String> = v
        .get("warnings")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut stats_n_segments = None;
    let mut stats_n_words = None;
    let mut stats_n_speaker_turns = None;
    let mut stats_n_pauses = None;
    let mut stats_n_ipus = None;
    if let Some(st) = v.get("stats").and_then(|x| x.as_object()) {
        stats_n_segments = st.get("n_segments").and_then(|x| x.as_i64());
        stats_n_words = st.get("n_words").and_then(|x| x.as_i64());
        stats_n_speaker_turns = st.get("n_speaker_turns").and_then(|x| x.as_i64());
        stats_n_pauses = st.get("n_pauses").and_then(|x| x.as_i64());
        stats_n_ipus = st.get("n_ipus").and_then(|x| x.as_i64());
    }

    let run_dir_s = run_dir.to_string_lossy().to_string();
    let manifest_s = manifest_path.to_string_lossy().to_string();

    Ok(RunManifestSummary {
        run_dir: run_dir_s,
        manifest_path: manifest_s,
        schema_version,
        run_id,
        created_at,
        input_media_path,
        input_media_resolved,
        duration_sec,
        artifact_count: artifact_keys.len(),
        artifact_keys,
        warnings,
        stats_n_segments,
        stats_n_words,
        stats_n_speaker_turns,
        stats_n_pauses,
        stats_n_ipus,
    })
}

#[tauri::command]
pub fn read_run_manifest_summary(app: AppHandle, input_path: String) -> Result<RunManifestSummary, String> {
    let (run_dir, manifest_path) = resolve_run_dir_and_manifest(&input_path)?;
    let summary = parse_run_manifest_summary(&run_dir, &manifest_path)?;
    register_recent_run_inner(&app, &summary)?;
    Ok(summary)
}

fn register_recent_run_inner(app: &AppHandle, summary: &RunManifestSummary) -> Result<(), String> {
    let path = recent_runs_path(app)?;
    let mut store: RecentRunsStore = if path.is_file() {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        RecentRunsStore::default()
    };

    let key = summary.run_dir.clone();
    store.entries.retain(|e| e.run_dir != key);
    store.entries.push(RecentRunEntry {
        run_dir: summary.run_dir.clone(),
        run_id: summary.run_id.clone(),
        last_opened_at_ms: now_ms(),
    });
    store
        .entries
        .sort_by(|a, b| b.last_opened_at_ms.cmp(&a.last_opened_at_ms));
    if store.entries.len() > RECENT_RUNS_MAX {
        store.entries.truncate(RECENT_RUNS_MAX);
    }

    let json = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("recent_runs write failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_recent_runs(app: AppHandle) -> Result<Vec<RecentRunEntry>, String> {
    let path = recent_runs_path(&app)?;
    if !path.is_file() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let store: RecentRunsStore = serde_json::from_str(&raw).unwrap_or_default();
    Ok(store.entries)
}

#[tauri::command]
pub fn clear_recent_runs(app: AppHandle) -> Result<(), String> {
    let path = recent_runs_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

