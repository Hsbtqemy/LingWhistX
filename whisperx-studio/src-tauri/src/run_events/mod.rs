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

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value as JsonValue;

mod run_events_query_window;
pub mod player_derived_alerts;

pub use run_events_query_window::{
    query_run_events_window_inner, QueryWindowRequest, QueryWindowResult,
};

pub const EVENTS_DB_FILE: &str = "events.sqlite";
pub const EVENTS_DB_SCHEMA_VERSION: i32 = 1;

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
    let conn = Connection::open(db_path).map_err(|e| {
        format!(
            "SQLite open: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        ",
    )
    .map_err(|e| {
        format!(
            "SQLite pragma: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
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
    .map_err(|e| {
        format!(
            "SQLite schema: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
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
    .map_err(|e| {
        format!(
            "SQLite clear: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
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
    let raw = fs::read_to_string(&manifest_path).map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let v: JsonValue = serde_json::from_str(&raw).map_err(|e| {
        format!(
            "run_manifest JSON: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
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

    let tx = conn.transaction().map_err(|e| redact_user_home_in_text(&e.to_string()))?;

    {
        let mut insert_word = tx
            .prepare_cached(
                "INSERT INTO words (start_ms, end_ms, speaker, token, flags_json, confidence, word_id, chunk_id, alignment_status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )
            .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        for w in &words {
            let o = w
                .as_object()
                .ok_or_else(|| "words[]: objet attendu".to_string())?;
            let start = o
                .get("start")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "word.start".to_string())?;
            let end = o
                .get("end")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "word.end".to_string())?;
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

            insert_word
                .execute(params![
                    sec_to_ms(start),
                    sec_to_ms(end),
                    speaker,
                    token,
                    flags_json,
                    confidence,
                    word_id,
                    chunk_id,
                    alignment_status,
                ])
                .map_err(|e| {
                    format!(
                        "insert word: {}",
                        redact_user_home_in_text(&e.to_string())
                    )
                })?;
        }
    }

    {
        let mut insert_turn = tx
            .prepare_cached(
                "INSERT INTO turns (start_ms, end_ms, speaker, turn_id, flags_json, confidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        for t in &turns {
            let o = t
                .as_object()
                .ok_or_else(|| "speaker_turns[]: objet attendu".to_string())?;
            let start = o
                .get("start")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "turn.start".to_string())?;
            let end = o
                .get("end")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "turn.end".to_string())?;
            let speaker = o
                .get("speaker")
                .and_then(|x| x.as_str())
                .unwrap_or("UNKNOWN");
            let turn_id = o.get("turn_id").and_then(|x| x.as_str());
            let confidence = o.get("confidence").and_then(|x| x.as_f64());
            let flags_json = flags_to_json(o.get("flags"));

            insert_turn
                .execute(params![
                    sec_to_ms(start),
                    sec_to_ms(end),
                    speaker,
                    turn_id,
                    flags_json,
                    confidence,
                ])
                .map_err(|e| {
                    format!(
                        "insert turn: {}",
                        redact_user_home_in_text(&e.to_string())
                    )
                })?;
        }
    }

    {
        let mut insert_pause = tx
            .prepare_cached(
                "INSERT INTO pauses (start_ms, end_ms, dur_ms, type, speaker, flags_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        for p in &pauses {
            let o = p
                .as_object()
                .ok_or_else(|| "pauses[]: objet attendu".to_string())?;
            let start = o
                .get("start")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "pause.start".to_string())?;
            let end = o
                .get("end")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "pause.end".to_string())?;
            let dur = o.get("dur").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let typ = o.get("type").and_then(|x| x.as_str()).unwrap_or("");
            let speaker = o.get("speaker").and_then(|x| x.as_str());
            let flags_json = flags_to_json(o.get("flags"));

            insert_pause
                .execute(params![
                    sec_to_ms(start),
                    sec_to_ms(end),
                    sec_to_ms(dur),
                    typ,
                    speaker,
                    flags_json,
                ])
                .map_err(|e| {
                    format!(
                        "insert pause: {}",
                        redact_user_home_in_text(&e.to_string())
                    )
                })?;
        }
    }

    {
        let mut insert_ipu = tx
            .prepare_cached(
                "INSERT INTO ipus (start_ms, end_ms, dur_ms, n_words, speaker, text, flags_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        for ipu in &ipus {
            let o = ipu
                .as_object()
                .ok_or_else(|| "ipus[]: objet attendu".to_string())?;
            let start = o
                .get("start")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "ipu.start".to_string())?;
            let end = o
                .get("end")
                .and_then(|x| x.as_f64())
                .ok_or_else(|| "ipu.end".to_string())?;
            let dur = o.get("dur").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let n_words = o.get("n_words").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
            let text = o.get("text").and_then(|x| x.as_str()).unwrap_or("");
            let speaker = o.get("speaker").and_then(|x| x.as_str());
            let flags_json = flags_to_json(o.get("flags"));

            insert_ipu
                .execute(params![
                    sec_to_ms(start),
                    sec_to_ms(end),
                    sec_to_ms(dur),
                    n_words,
                    speaker,
                    text,
                    flags_json,
                ])
                .map_err(|e| {
                    format!(
                        "insert ipu: {}",
                        redact_user_home_in_text(&e.to_string())
                    )
                })?;
        }
    }

    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
        params!["db_schema_version", EVENTS_DB_SCHEMA_VERSION.to_string()],
    )
    .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
        params!["source_timeline", source_label],
    )
    .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)",
        params!["imported_at_ms", imported_at_ms.to_string()],
    )
    .map_err(|e| redact_user_home_in_text(&e.to_string()))?;

    tx.commit().map_err(|e| redact_user_home_in_text(&e.to_string()))?;

    Ok((words.len(), turns.len(), pauses.len(), ipus.len()))
}

/// Importe ou réimporte les événements depuis le `timeline_json` du manifest.
pub fn import_run_events_inner(run_dir: &Path) -> Result<RunEventsImportResult, String> {
    let run_dir = run_dir
        .canonicalize()
        .map_err(|e| format!("run_dir: {}", redact_user_home_in_text(&e.to_string())))?;
    let timeline_rel = read_run_manifest_timeline_rel(&run_dir)?;
    let timeline_path = run_dir.join(&timeline_rel);
    if !timeline_path.is_file() {
        return Err(format!(
            "Fichier timeline introuvable: {}",
            redact_user_home_in_text(&timeline_path.to_string_lossy())
        ));
    }

    let raw = fs::read_to_string(&timeline_path).map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let timeline: JsonValue =
        serde_json::from_str(&raw).map_err(|e| {
            format!(
                "timeline JSON: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;

    let db_path = run_dir.join(EVENTS_DB_FILE);
    let mut conn = open_events_connection(&db_path)?;
    apply_schema_v1(&conn)?;
    clear_event_tables(&conn)?;

    let imported_at_ms = crate::time_utils::now_ms();
    let (nw, nt, np, ni) =
        import_timeline_value(&mut conn, &timeline, imported_at_ms, &timeline_rel)?;

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

/// Si `events.sqlite` est absent, importe depuis `timeline_json` du manifest (WX-612 lazy).
pub(crate) fn ensure_events_sqlite_imported(run_dir: &Path) -> Result<(), String> {
    let run_dir = run_dir
        .canonicalize()
        .map_err(|e| format!("run_dir: {}", redact_user_home_in_text(&e.to_string())))?;
    let db_path = run_dir.join(EVENTS_DB_FILE);
    if db_path.is_file() {
        return Ok(());
    }
    import_run_events_inner(&run_dir).map(|_| ())
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
        .map_err(|e| format!("run_dir: {}", redact_user_home_in_text(&e.to_string())))?;
    ensure_events_sqlite_imported(&run_dir)?;
    let db_path = run_dir.join(EVENTS_DB_FILE);
    let conn = open_events_connection(&db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT speaker FROM turns WHERE speaker IS NOT NULL AND length(trim(speaker)) > 0 \
             UNION \
             SELECT speaker FROM words WHERE speaker IS NOT NULL AND length(trim(speaker)) > 0 \
             ORDER BY speaker COLLATE NOCASE",
        )
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let mut rows = stmt.query([]).map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| redact_user_home_in_text(&e.to_string()))? {
        let s: String = row.get(0).map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        out.push(s);
    }
    Ok(out)
}

#[tauri::command]
pub fn query_run_events_window(request: QueryWindowRequest) -> Result<QueryWindowResult, String> {
    query_run_events_window_inner(request)
}

#[cfg(test)]
mod tests {
    use super::run_events_query_window::{QueryWindowLayers, QueryWindowLimits};
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
        fs::write(
            run_dir.join("run_manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

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
