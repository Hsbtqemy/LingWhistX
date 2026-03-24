//! Requêtes fenêtre temporelle sur `events.sqlite` (`query_run_events_window`).

use std::path::PathBuf;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};

use crate::path_guard::validate_path_string;

use super::{open_events_connection, EVENTS_DB_FILE};

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
        out.push(word_row_from_row(row).map_err(|e| e.to_string())?);
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
        out.push(turn_row_from_row(row).map_err(|e| e.to_string())?);
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
        out.push(pause_row_from_row(row).map_err(|e| e.to_string())?);
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
        out.push(ipu_row_from_row(row).map_err(|e| e.to_string())?);
    }
    let truncated = out.len() as u32 >= limit && limit > 0;
    Ok((out, truncated))
}

/// Fenêtre temporelle `[t0_ms, t1_ms)` : overlap `start_ms < t1_ms AND end_ms > t0_ms`.
pub fn query_run_events_window_inner(
    request: QueryWindowRequest,
) -> Result<QueryWindowResult, String> {
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
