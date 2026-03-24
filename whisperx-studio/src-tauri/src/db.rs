use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, Row};
use tauri::{AppHandle, Manager};

use crate::models::{Job, WhisperxOptions};

/// Taille d’une page de jobs (démarrage + « charger plus »).
pub(crate) const JOBS_PAGE_SIZE: i64 = 200;

fn map_job_row(row: &Row<'_>) -> Result<Job, rusqlite::Error> {
    let progress_raw: i64 = row.get(5)?;
    let progress = progress_raw.clamp(0, 100) as u8;

    let output_files_json: String = row.get(10)?;
    let output_files = serde_json::from_str::<Vec<String>>(&output_files_json).unwrap_or_default();

    let whisperx_options_json: Option<String> = row.get(11)?;
    let whisperx_options =
        whisperx_options_json.and_then(|json| serde_json::from_str::<WhisperxOptions>(&json).ok());

    Ok(Job {
        id: row.get(0)?,
        input_path: row.get(1)?,
        output_dir: row.get(2)?,
        mode: row.get(3)?,
        status: row.get(4)?,
        progress,
        message: row.get(6)?,
        created_at_ms: row.get::<_, i64>(7)? as u64,
        updated_at_ms: row.get::<_, i64>(8)? as u64,
        error: row.get(9)?,
        output_files,
        whisperx_options,
    })
}

pub(crate) fn redact_whisperx_options_for_storage(
    options: Option<WhisperxOptions>,
) -> Option<WhisperxOptions> {
    options.map(|mut options| {
        options.hf_token = None;
        options
    })
}

pub(crate) fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Unable to create app local data dir: {err}"))?;
    Ok(data_dir.join("whisperx-studio-jobs.sqlite3"))
}

pub(crate) fn init_database(path: &Path) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|err| format!("DB open failed: {err}"))?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          input_path TEXT NOT NULL,
          output_dir TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL,
          message TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          error TEXT,
          output_files TEXT NOT NULL,
          whisperx_options TEXT
        );
        ",
    )
    .map_err(|err| format!("DB init failed: {err}"))?;
    migrate_schema(&conn)?;
    Ok(())
}

/// Versionnement du schéma via `PRAGMA user_version` (SQLite).
/// `0` = bases créées avant cette colonne ; les migrations futures feront `ALTER TABLE` puis incrémenteront la version.
fn migrate_schema(conn: &Connection) -> Result<(), String> {
    let version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|err| format!("Read schema version failed: {err}"))?;

    if version < 1 {
        conn.pragma_update(None, "user_version", 1)
            .map_err(|err| format!("Set schema version failed: {err}"))?;
    }

    Ok(())
}

pub(crate) fn persist_job(db_path: &Path, job: &Job) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|err| format!("DB open failed: {err}"))?;
    let output_files_json = serde_json::to_string(&job.output_files)
        .map_err(|err| format!("Serialize output_files failed: {err}"))?;
    let whisperx_options_json = job
        .whisperx_options
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| format!("Serialize whisperx_options failed: {err}"))?;

    conn.execute(
        "
        INSERT INTO jobs (
          id, input_path, output_dir, mode, status, progress,
          message, created_at_ms, updated_at_ms, error,
          output_files, whisperx_options
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6,
          ?7, ?8, ?9, ?10,
          ?11, ?12
        )
        ON CONFLICT(id) DO UPDATE SET
          input_path = excluded.input_path,
          output_dir = excluded.output_dir,
          mode = excluded.mode,
          status = excluded.status,
          progress = excluded.progress,
          message = excluded.message,
          created_at_ms = excluded.created_at_ms,
          updated_at_ms = excluded.updated_at_ms,
          error = excluded.error,
          output_files = excluded.output_files,
          whisperx_options = excluded.whisperx_options
        ",
        params![
            job.id,
            job.input_path,
            job.output_dir,
            job.mode,
            job.status,
            i64::from(job.progress),
            job.message,
            job.created_at_ms as i64,
            job.updated_at_ms as i64,
            job.error,
            output_files_json,
            whisperx_options_json
        ],
    )
    .map_err(|err| format!("Persist job failed: {err}"))?;

    Ok(())
}

pub(crate) fn count_jobs(db_path: &Path) -> Result<i64, String> {
    let conn = Connection::open(db_path).map_err(|err| format!("DB open failed: {err}"))?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM jobs", [], |row| row.get(0))
        .map_err(|err| format!("Count jobs failed: {err}"))?;
    Ok(count)
}

/// Première page (démarrage app).
pub(crate) fn load_jobs(db_path: &Path) -> Result<Vec<Job>, String> {
    load_jobs_page(db_path, 0, JOBS_PAGE_SIZE)
}

pub(crate) fn load_jobs_page(db_path: &Path, offset: i64, limit: i64) -> Result<Vec<Job>, String> {
    let conn = Connection::open(db_path).map_err(|err| format!("DB open failed: {err}"))?;
    let mut statement = conn
        .prepare(
            "
            SELECT id, input_path, output_dir, mode, status, progress,
                   message, created_at_ms, updated_at_ms, error,
                   output_files, whisperx_options
            FROM jobs
            ORDER BY created_at_ms DESC
            LIMIT ?1 OFFSET ?2
            ",
        )
        .map_err(|err| format!("Prepare load query failed: {err}"))?;

    let rows = statement
        .query_map(params![limit, offset], map_job_row)
        .map_err(|err| format!("Load query failed: {err}"))?;

    let mut jobs = Vec::new();
    for row in rows {
        jobs.push(row.map_err(|err| format!("Load row failed: {err}"))?);
    }
    Ok(jobs)
}
