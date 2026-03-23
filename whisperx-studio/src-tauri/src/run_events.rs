//! WX-612 — Base `events.sqlite` par dossier de run : mots, tours, pauses, IPU
//! importés depuis `*.timeline.json` (pipeline WhisperX / `write_data_science_exports`).
//!
//! ## Requêtes fenêtre (t0/t1 en ms)
//! ```sql
//! SELECT * FROM words WHERE start_ms < ?1 AND end_ms > ?2 ORDER BY start_ms LIMIT ?3;
//! ```
//! Même motif pour `turns`, `pauses`, `ipus` avec index sur `start_ms`.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, Row};
use rusqlite::types::Value as SqlValue;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::path_guard::validate_path_string;

pub const EVENTS_DB_FILE: &str = "events.sqlite";
pub const EVENTS_DB_SCHEMA_VERSION: i32 = 1;

/// Plafond documenté par couche (WX-613) — le front ne doit pas monter au-delà sans accord produit.
pub const DEFAULT_MAX_WORDS_PER_WINDOW: u32 = 5000;
pub const DEFAULT_MAX_TURNS_PER_WINDOW: u32 = 2000;
pub const DEFAULT_MAX_PAUSES_PER_WINDOW: u32 = 2000;
pub const DEFAULT_MAX_IPUS_PER_WINDOW: u32 = 2000;

fn default_true() -> bool {
    true
}

fn default_max_words() -> u32 {
    DEFAULT_MAX_WORDS_PER_WINDOW
}
fn default_max_turns() -> u32 {
    DEFAULT_MAX_TURNS_PER_WINDOW
}
fn default_max_pauses() -> u32 {
    DEFAULT_MAX_PAUSES_PER_WINDOW
}
fn default_max_ipus() -> u32 {
    DEFAULT_MAX_IPUS_PER_WINDOW
}

/// Filtres de couches : par défaut tout est inclus.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryWindowLayers {
    #[serde(default = "default_true")]
    pub words: bool,
    #[serde(default = "default_true")]
    pub turns: bool,
    #[serde(default = "default_true")]
    pub pauses: bool,
    #[serde(default = "default_true")]
    pub ipus: bool,
}

impl Default for QueryWindowLayers {
    fn default() -> Self {
        Self {
            words: true,
            turns: true,
            pauses: true,
            ipus: true,
        }
    }
}

/// Limites par table (pagination fenêtre).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryWindowLimits {
    #[serde(default = "default_max_words")]
    pub max_words: u32,
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
    #[serde(default = "default_max_pauses")]
    pub max_pauses: u32,
    #[serde(default = "default_max_ipus")]
    pub max_ipus: u32,
}

impl Default for QueryWindowLimits {
    fn default() -> Self {
        Self {
            max_words: DEFAULT_MAX_WORDS_PER_WINDOW,
            max_turns: DEFAULT_MAX_TURNS_PER_WINDOW,
            max_pauses: DEFAULT_MAX_PAUSES_PER_WINDOW,
            max_ipus: DEFAULT_MAX_IPUS_PER_WINDOW,
        }
    }
}

/// Requête fenêtre temporelle `[t0_ms, t1_ms)` en millisecondes : overlap `start_ms < t1_ms AND end_ms > t0_ms`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryWindowRequest {
    pub run_dir: String,
    pub t0_ms: i64,
    pub t1_ms: i64,
    #[serde(default)]
    pub layers: QueryWindowLayers,
    /// Si non vide : uniquement ces locuteurs (`speaker` doit correspondre exactement).
    #[serde(default)]
    pub speakers: Vec<String>,
    #[serde(default)]
    pub limits: QueryWindowLimits,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryWindowTruncated {
    pub words: bool,
    pub turns: bool,
    pub pauses: bool,
    pub ipus: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventWordRow {
    pub id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub speaker: Option<String>,
    pub token: Option<String>,
    pub flags_json: Option<String>,
    pub confidence: Option<f64>,
    pub word_id: Option<String>,
    pub chunk_id: Option<String>,
    pub alignment_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTurnRow {
    pub id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub speaker: String,
    pub turn_id: Option<String>,
    pub flags_json: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPauseRow {
    pub id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub dur_ms: i64,
    #[serde(rename = "type")]
    pub pause_type: Option<String>,
    pub speaker: Option<String>,
    pub flags_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventIpuRow {
    pub id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub dur_ms: i64,
    pub n_words: i32,
    pub speaker: Option<String>,
    pub text: Option<String>,
    pub flags_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryWindowResult {
    pub run_dir: String,
    pub t0_ms: i64,
    pub t1_ms: i64,
    pub words: Vec<EventWordRow>,
    pub turns: Vec<EventTurnRow>,
    pub pauses: Vec<EventPauseRow>,
    pub ipus: Vec<EventIpuRow>,
    pub truncated: QueryWindowTruncated,
}

/// Résultat de [`import_run_events_inner`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventsImportResult {
    pub run_dir: String,
    pub db_path: String,
    pub schema_version: i32,
    pub n_words: usize,
    pub n_turns: usize,
    pub n_pauses: usize,
    pub n_ipus: usize,
    pub source_timeline: String,
}

fn sec_to_ms(sec: f64) -> i64 {
    (sec * 1000.0).round() as i64
}

pub(crate) fn open_events_connection(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("SQLite open: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        ",
    )
    .map_err(|e| format!("SQLite pragma: {e}"))?;
    Ok(conn)
}

fn apply_schema_v1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            speaker TEXT,
            token TEXT,
            flags_json TEXT,
            confidence REAL,
            word_id TEXT,
            chunk_id TEXT,
            alignment_status TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_words_start ON words(start_ms);
        CREATE INDEX IF NOT EXISTS idx_words_window ON words(start_ms, end_ms);

        CREATE TABLE IF NOT EXISTS turns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            speaker TEXT NOT NULL,
            turn_id TEXT,
            flags_json TEXT,
            confidence REAL
        );
        CREATE INDEX IF NOT EXISTS idx_turns_start ON turns(start_ms);
        CREATE INDEX IF NOT EXISTS idx_turns_window ON turns(start_ms, end_ms);

        CREATE TABLE IF NOT EXISTS pauses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            dur_ms INTEGER NOT NULL,
            type TEXT,
            speaker TEXT,
            flags_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pauses_start ON pauses(start_ms);
        CREATE INDEX IF NOT EXISTS idx_pauses_window ON pauses(start_ms, end_ms);

        CREATE TABLE IF NOT EXISTS ipus (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            dur_ms INTEGER NOT NULL,
            n_words INTEGER NOT NULL,
            speaker TEXT,
            text TEXT,
            flags_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ipus_start ON ipus(start_ms);
        CREATE INDEX IF NOT EXISTS idx_ipus_window ON ipus(start_ms, end_ms);
        ",
    )
    .map_err(|e| format!("SQLite schema: {e}"))?;
    Ok(())
}

fn clear_event_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        DELETE FROM words;
        DELETE FROM turns;
        DELETE FROM pauses;
        DELETE FROM ipus;
        DELETE FROM meta;
        ",
    )
    .map_err(|e| format!("SQLite clear: {e}"))?;
    Ok(())
}

fn flags_to_json(flags: Option<&JsonValue>) -> Option<String> {
    flags.and_then(|v| serde_json::to_string(v).ok())
}

fn read_run_manifest_timeline_rel(run_dir: &Path) -> Result<String, String> {
    let manifest_path = run_dir.join("run_manifest.json");
    if !manifest_path.is_file() {
        return Err("run_manifest.json introuvable.".into());
    }
    let raw = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let v: JsonValue = serde_json::from_str(&raw).map_err(|e| format!("run_manifest JSON: {e}"))?;
    let artifacts = v
        .get("artifacts")
        .and_then(|a| a.as_object())
        .ok_or_else(|| "run_manifest: artifacts manquant.".to_string())?;
    let rel = artifacts
        .get("timeline_json")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "run_manifest: artifacts.timeline_json manquant.".to_string())?;
    if rel.trim().is_empty() {
        return Err("timeline_json vide.".into());
    }
    Ok(rel.to_string())
}

fn import_timeline_value(
    conn: &mut Connection,
    timeline: &JsonValue,
    imported_at_ms: u64,
    source_label: &str,
) -> Result<(usize, usize, usize, usize), String> {
    let words = timeline
        .get("words")
        .and_then(|w| w.as_array())
        .cloned()
        .unwrap_or_default();
    let turns = timeline
        .get("speaker_turns")
        .and_then(|w| w.as_array())
        .cloned()
        .unwrap_or_default();

    let analysis = timeline.get("analysis").and_then(|a| a.as_object());
    let pauses = analysis
        .and_then(|a| a.get("pauses"))
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();
    let ipus = analysis
        .and_then(|a| a.get("ipus"))
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut insert_word = tx
            .prepare_cached(
                "INSERT INTO words (start_ms, end_ms, speaker, token, flags_json, confidence, word_id, chunk_id, alignment_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )
            .map_err(|e| e.to_string())?;
        for w in &words {
        let o = w.as_object().ok_or_else(|| "words[]: objet attendu".to_string())?;
        let start = o.get("start").and_then(|x| x.as_f64()).ok_or_else(|| "word.start".to_string())?;
        let end = o.get("end").and_then(|x| x.as_f64()).ok_or_else(|| "word.end".to_string())?;
        let token = o
            .get("token")
            .or_else(|| o.get("word"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let speaker = o.get("speaker").and_then(|x| x.as_str());
        let confidence = o.get("confidence").and_then(|x| x.as_f64());
        let word_id = o.get("word_id").and_then(|x| x.as_str());
        let chunk_id = o.get("chunk_id").and_then(|x| x.as_str());
        let alignment_status = o.get("alignment_status").and_then(|x| x.as_str());
        let flags_json = flags_to_json(o.get("flags"));

        insert_word.execute(params![
            sec_to_ms(start),
            sec_to_ms(end),
            speaker,
            token,
            flags_json,
            confidence,
            word_id,
            chunk_id,
            alignment_status,
        ]).map_err(|e| format!("insert word: {e}"))?;
        }
    }

    {
        let mut insert_turn = tx
            .prepare_cached(
                "INSERT INTO turns (start_ms, end_ms, speaker, turn_id, flags_json, confidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| e.to_string())?;
        for t in &turns {
        let o = t
            .as_object()
            .ok_or_else(|| "speaker_turns[]: objet attendu".to_string())?;
        let start = o.get("start").and_then(|x| x.as_f64()).ok_or_else(|| "turn.start".to_string())?;
        let end = o.get("end").and_then(|x| x.as_f64()).ok_or_else(|| "turn.end".to_string())?;
        let speaker = o
            .get("speaker")
            .and_then(|x| x.as_str())
            .unwrap_or("UNKNOWN");
        let turn_id = o.get("turn_id").and_then(|x| x.as_str());
        let confidence = o.get("confidence").and_then(|x| x.as_f64());
        let flags_json = flags_to_json(o.get("flags"));

        insert_turn.execute(params![
            sec_to_ms(start),
            sec_to_ms(end),
            speaker,
            turn_id,
            flags_json,
            confidence,
        ]).map_err(|e| format!("insert turn: {e}"))?;
        }
    }

    {
        let mut insert_pause = tx
            .prepare_cached(
                "INSERT INTO pauses (start_ms, end_ms, dur_ms, type, speaker, flags_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| e.to_string())?;
        for p in &pauses {
        let o = p.as_object().ok_or_else(|| "pauses[]: objet attendu".to_string())?;
        let start = o.get("start").and_then(|x| x.as_f64()).ok_or_else(|| "pause.start".to_string())?;
        let end = o.get("end").and_then(|x| x.as_f64()).ok_or_else(|| "pause.end".to_string())?;
        let dur = o.get("dur").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let typ = o.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let speaker = o.get("speaker").and_then(|x| x.as_str());
        let flags_json = flags_to_json(o.get("flags"));

        insert_pause.execute(params![
            sec_to_ms(start),
            sec_to_ms(end),
            sec_to_ms(dur) as i64,
            typ,
            speaker,
            flags_json,
        ]).map_err(|e| format!("insert pause: {e}"))?;
        }
    }

    {
        let mut insert_ipu = tx
            .prepare_cached(
                "INSERT INTO ipus (start_ms, end_ms, dur_ms, n_words, speaker, text, flags_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;
        for ipu in &ipus {
        let o = ipu.as_object().ok_or_else(|| "ipus[]: objet attendu".to_string())?;
        let start = o.get("start").and_then(|x| x.as_f64()).ok_or_else(|| "ipu.start".to_string())?;
        let end = o.get("end").and_then(|x| x.as_f64()).ok_or_else(|| "ipu.end".to_string())?;
        let dur = o.get("dur").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let n_words = o.get("n_words").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
        let text = o.get("text").and_then(|x| x.as_str()).unwrap_or("");
        let speaker = o.get("speaker").and_then(|x| x.as_str());
        let flags_json = flags_to_json(o.get("flags"));

        insert_ipu.execute(params![
            sec_to_ms(start),
            sec_to_ms(end),
            sec_to_ms(dur) as i64,
            n_words,
            speaker,
            text,
            flags_json,
        ]).map_err(|e| format!("insert ipu: {e}"))?;
        }
    }

    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
        params!["db_schema_version", EVENTS_DB_SCHEMA_VERSION.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
        params!["source_timeline", source_label],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
        params!["imported_at_ms", imported_at_ms.to_string()],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok((words.len(), turns.len(), pauses.len(), ipus.len()))
}

/// Importe ou réimporte les événements depuis le `timeline_json` du manifest.
pub fn import_run_events_inner(run_dir: &Path) -> Result<RunEventsImportResult, String> {
    let run_dir = run_dir
        .canonicalize()
        .map_err(|e| format!("run_dir: {e}"))?;
    let timeline_rel = read_run_manifest_timeline_rel(&run_dir)?;
    let timeline_path = run_dir.join(&timeline_rel);
    if !timeline_path.is_file() {
        return Err(format!(
            "Fichier timeline introuvable: {}",
            timeline_path.display()
        ));
    }

    let raw = fs::read_to_string(&timeline_path).map_err(|e| e.to_string())?;
    let timeline: JsonValue = serde_json::from_str(&raw).map_err(|e| format!("timeline JSON: {e}"))?;

    let db_path = run_dir.join(EVENTS_DB_FILE);
    let mut conn = open_events_connection(&db_path)?;
    apply_schema_v1(&conn)?;
    clear_event_tables(&conn)?;

    let imported_at_ms = crate::time_utils::now_ms();
    let (nw, nt, np, ni) = import_timeline_value(
        &mut conn,
        &timeline,
        imported_at_ms,
        &timeline_rel,
    )?;

    Ok(RunEventsImportResult {
        run_dir: run_dir.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        schema_version: EVENTS_DB_SCHEMA_VERSION,
        n_words: nw,
        n_turns: nt,
        n_pauses: np,
        n_ipus: ni,
        source_timeline: timeline_rel,
    })
}

#[tauri::command]
pub fn import_run_events(run_dir: String) -> Result<RunEventsImportResult, String> {
    validate_path_string(&run_dir)?;
    let p = PathBuf::from(run_dir.trim());
    import_run_events_inner(&p)
}

/// Locuteurs distincts présents dans `turns` et `words` (après import timeline).
#[tauri::command]
pub fn list_run_speakers(run_dir: String) -> Result<Vec<String>, String> {
    validate_path_string(&run_dir)?;
    let run_dir = PathBuf::from(run_dir.trim())
        .canonicalize()
        .map_err(|e| format!("run_dir: {e}"))?;
    let db_path = run_dir.join(EVENTS_DB_FILE);
    if !db_path.is_file() {
        return Err(format!(
            "events.sqlite introuvable. Lance import_run_events ({}).",
            db_path.display()
        ));
    }
    let conn = open_events_connection(&db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT speaker FROM turns WHERE speaker IS NOT NULL AND length(trim(speaker)) > 0 \
             UNION \
             SELECT speaker FROM words WHERE speaker IS NOT NULL AND length(trim(speaker)) > 0 \
             ORDER BY speaker COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let s: String = row.get(0).map_err(|e| e.to_string())?;
        out.push(s);
    }
    Ok(out)
}

fn word_row_from_row(row: &Row<'_>) -> Result<EventWordRow, rusqlite::Error> {
    Ok(EventWordRow {
        id: row.get(0)?,
        start_ms: row.get(1)?,
        end_ms: row.get(2)?,
        speaker: row.get(3)?,
        token: row.get(4)?,
        flags_json: row.get(5)?,
        confidence: row.get(6)?,
        word_id: row.get(7)?,
        chunk_id: row.get(8)?,
        alignment_status: row.get(9)?,
    })
}

fn turn_row_from_row(row: &Row<'_>) -> Result<EventTurnRow, rusqlite::Error> {
    Ok(EventTurnRow {
        id: row.get(0)?,
        start_ms: row.get(1)?,
        end_ms: row.get(2)?,
        speaker: row.get(3)?,
        turn_id: row.get(4)?,
        flags_json: row.get(5)?,
        confidence: row.get(6)?,
    })
}

fn pause_row_from_row(row: &Row<'_>) -> Result<EventPauseRow, rusqlite::Error> {
    Ok(EventPauseRow {
        id: row.get(0)?,
        start_ms: row.get(1)?,
        end_ms: row.get(2)?,
        dur_ms: row.get(3)?,
        pause_type: row.get(4)?,
        speaker: row.get(5)?,
        flags_json: row.get(6)?,
    })
}

fn ipu_row_from_row(row: &Row<'_>) -> Result<EventIpuRow, rusqlite::Error> {
    Ok(EventIpuRow {
        id: row.get(0)?,
        start_ms: row.get(1)?,
        end_ms: row.get(2)?,
        dur_ms: row.get(3)?,
        n_words: row.get(4)?,
        speaker: row.get(5)?,
        text: row.get(6)?,
        flags_json: row.get(7)?,
    })
}

fn query_words_window(
    conn: &Connection,
    t0_ms: i64,
    t1_ms: i64,
    speakers: &[String],
    limit: u32,
) -> Result<(Vec<EventWordRow>, bool), String> {
    let lim = limit as i64;
    let mut sql = String::from(
        "SELECT id, start_ms, end_ms, speaker, token, flags_json, confidence, word_id, chunk_id, alignment_status
         FROM words WHERE start_ms < ? AND end_ms > ?",
    );
    if !speakers.is_empty() {
        sql.push_str(" AND speaker IN (");
        sql.push_str(&vec!["?"; speakers.len()].join(","));
        sql.push(')');
    }
    sql.push_str(" ORDER BY start_ms LIMIT ?");

    let mut params: Vec<SqlValue> = vec![SqlValue::Integer(t1_ms), SqlValue::Integer(t0_ms)];
    for s in speakers {
        params.push(SqlValue::Text(s.clone()));
    }
    params.push(SqlValue::Integer(lim));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(word_row_from_row(&row).map_err(|e| e.to_string())?);
    }
    let truncated = out.len() as u32 >= limit && limit > 0;
    Ok((out, truncated))
}

fn query_turns_window(
    conn: &Connection,
    t0_ms: i64,
    t1_ms: i64,
    speakers: &[String],
    limit: u32,
) -> Result<(Vec<EventTurnRow>, bool), String> {
    let lim = limit as i64;
    let mut sql = String::from(
        "SELECT id, start_ms, end_ms, speaker, turn_id, flags_json, confidence
         FROM turns WHERE start_ms < ? AND end_ms > ?",
    );
    if !speakers.is_empty() {
        sql.push_str(" AND speaker IN (");
        sql.push_str(&vec!["?"; speakers.len()].join(","));
        sql.push(')');
    }
    sql.push_str(" ORDER BY start_ms LIMIT ?");

    let mut params: Vec<SqlValue> = vec![SqlValue::Integer(t1_ms), SqlValue::Integer(t0_ms)];
    for s in speakers {
        params.push(SqlValue::Text(s.clone()));
    }
    params.push(SqlValue::Integer(lim));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(turn_row_from_row(&row).map_err(|e| e.to_string())?);
    }
    let truncated = out.len() as u32 >= limit && limit > 0;
    Ok((out, truncated))
}

fn query_pauses_window(
    conn: &Connection,
    t0_ms: i64,
    t1_ms: i64,
    speakers: &[String],
    limit: u32,
) -> Result<(Vec<EventPauseRow>, bool), String> {
    let lim = limit as i64;
    let mut sql = String::from(
        "SELECT id, start_ms, end_ms, dur_ms, type, speaker, flags_json
         FROM pauses WHERE start_ms < ? AND end_ms > ?",
    );
    if !speakers.is_empty() {
        sql.push_str(" AND (speaker IS NULL OR speaker IN (");
        sql.push_str(&vec!["?"; speakers.len()].join(","));
        sql.push_str("))");
    }
    sql.push_str(" ORDER BY start_ms LIMIT ?");

    let mut params: Vec<SqlValue> = vec![SqlValue::Integer(t1_ms), SqlValue::Integer(t0_ms)];
    for s in speakers {
        params.push(SqlValue::Text(s.clone()));
    }
    params.push(SqlValue::Integer(lim));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(pause_row_from_row(&row).map_err(|e| e.to_string())?);
    }
    let truncated = out.len() as u32 >= limit && limit > 0;
    Ok((out, truncated))
}

fn query_ipus_window(
    conn: &Connection,
    t0_ms: i64,
    t1_ms: i64,
    speakers: &[String],
    limit: u32,
) -> Result<(Vec<EventIpuRow>, bool), String> {
    let lim = limit as i64;
    let mut sql = String::from(
        "SELECT id, start_ms, end_ms, dur_ms, n_words, speaker, text, flags_json
         FROM ipus WHERE start_ms < ? AND end_ms > ?",
    );
    if !speakers.is_empty() {
        sql.push_str(" AND (speaker IS NULL OR speaker IN (");
        sql.push_str(&vec!["?"; speakers.len()].join(","));
        sql.push_str("))");
    }
    sql.push_str(" ORDER BY start_ms LIMIT ?");

    let mut params: Vec<SqlValue> = vec![SqlValue::Integer(t1_ms), SqlValue::Integer(t0_ms)];
    for s in speakers {
        params.push(SqlValue::Text(s.clone()));
    }
    params.push(SqlValue::Integer(lim));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(ipu_row_from_row(&row).map_err(|e| e.to_string())?);
    }
    let truncated = out.len() as u32 >= limit && limit > 0;
    Ok((out, truncated))
}

/// Fenêtre temporelle `[t0_ms, t1_ms)` : overlap `start_ms < t1_ms AND end_ms > t0_ms`.
pub fn query_run_events_window_inner(request: QueryWindowRequest) -> Result<QueryWindowResult, String> {
    validate_path_string(&request.run_dir)?;
    if request.t0_ms >= request.t1_ms {
        return Err("t0_ms doit etre strictement inferieur a t1_ms.".into());
    }

    let run_dir = PathBuf::from(request.run_dir.trim())
        .canonicalize()
        .map_err(|e| format!("run_dir: {e}"))?;
    let db_path = run_dir.join(EVENTS_DB_FILE);
    if !db_path.is_file() {
        return Err(format!(
            "events.sqlite introuvable. Lance import_run_events d abord: {}",
            db_path.display()
        ));
    }

    let conn = open_events_connection(&db_path)?;
    let t0 = request.t0_ms;
    let t1 = request.t1_ms;
    let speakers = &request.speakers;
    let layers = &request.layers;
    let lim = &request.limits;

    let mut words = Vec::new();
    let mut turns = Vec::new();
    let mut pauses = Vec::new();
    let mut ipus = Vec::new();
    let mut tw = false;
    let mut tt = false;
    let mut tp = false;
    let mut ti = false;

    if layers.words {
        let (v, tr) = query_words_window(&conn, t0, t1, speakers, lim.max_words)?;
        words = v;
        tw = tr;
    }
    if layers.turns {
        let (v, tr) = query_turns_window(&conn, t0, t1, speakers, lim.max_turns)?;
        turns = v;
        tt = tr;
    }
    if layers.pauses {
        let (v, tr) = query_pauses_window(&conn, t0, t1, speakers, lim.max_pauses)?;
        pauses = v;
        tp = tr;
    }
    if layers.ipus {
        let (v, tr) = query_ipus_window(&conn, t0, t1, speakers, lim.max_ipus)?;
        ipus = v;
        ti = tr;
    }

    Ok(QueryWindowResult {
        run_dir: run_dir.to_string_lossy().to_string(),
        t0_ms: t0,
        t1_ms: t1,
        words,
        turns,
        pauses,
        ipus,
        truncated: QueryWindowTruncated {
            words: tw,
            turns: tt,
            pauses: tp,
            ipus: ti,
        },
    })
}

#[tauri::command]
pub fn query_run_events_window(request: QueryWindowRequest) -> Result<QueryWindowResult, String> {
    query_run_events_window_inner(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn import_minimal_timeline() {
        let run_dir = std::env::temp_dir().join(format!("wx612_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&run_dir).unwrap();

        let timeline = serde_json::json!({
            "version": 1,
            "words": [
                {"token": "hello", "start": 0.1, "end": 0.35, "speaker": "SPEAKER_00"}
            ],
            "segments": [],
            "speaker_turns": [
                {"speaker": "SPEAKER_00", "start": 0.1, "end": 0.5}
            ],
            "events": [],
            "analysis": {
                "pauses": [{"start": 0.5, "end": 0.7, "dur": 0.2, "type": "transition_gap"}],
                "ipus": [{"start": 0.1, "end": 0.5, "dur": 0.4, "text": "hello", "n_words": 1}]
            }
        });
        let timeline_path = run_dir.join("demo.timeline.json");
        let mut f = fs::File::create(&timeline_path).unwrap();
        write!(f, "{}", serde_json::to_string_pretty(&timeline).unwrap()).unwrap();

        let manifest = serde_json::json!({
            "schema_version": 1,
            "run_id": "test",
            "created_at": "2026-01-01T00:00:00Z",
            "input_media": {"path": "x.wav", "duration": 10.0},
            "artifacts": {"timeline_json": "demo.timeline.json"}
        });
        fs::write(run_dir.join("run_manifest.json"), serde_json::to_string_pretty(&manifest).unwrap()).unwrap();

        let r = import_run_events_inner(&run_dir).unwrap();
        assert_eq!(r.n_words, 1);
        assert_eq!(r.n_turns, 1);
        assert_eq!(r.n_pauses, 1);
        assert_eq!(r.n_ipus, 1);

        let conn = Connection::open(run_dir.join(EVENTS_DB_FILE)).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM words", [], |row| row.get(0))
            .unwrap();
        assert_eq!(n, 1);

        let q = query_run_events_window_inner(QueryWindowRequest {
            run_dir: run_dir.to_string_lossy().to_string(),
            t0_ms: 0,
            t1_ms: 2_000,
            layers: QueryWindowLayers::default(),
            speakers: vec![],
            limits: QueryWindowLimits::default(),
        })
        .unwrap();
        assert_eq!(q.words.len(), 1);
        assert_eq!(q.turns.len(), 1);
        assert_eq!(q.pauses.len(), 1);
        assert_eq!(q.ipus.len(), 1);
        assert!(!q.truncated.words);

        let outside = query_run_events_window_inner(QueryWindowRequest {
            run_dir: run_dir.to_string_lossy().to_string(),
            t0_ms: 10_000,
            t1_ms: 20_000,
            layers: QueryWindowLayers::default(),
            speakers: vec![],
            limits: QueryWindowLimits::default(),
        })
        .unwrap();
        assert!(outside.words.is_empty());
    }
}
