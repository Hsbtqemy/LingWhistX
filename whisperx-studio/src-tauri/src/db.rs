use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, Row};
use tauri::{AppHandle, Manager};

use crate::models::{Job, LiveTranscriptSegment, WhisperxOptions};

/// Taille d'une page de jobs (démarrage + « charger plus »).
pub(crate) const JOBS_PAGE_SIZE: i64 = 200;

fn map_job_row(row: &Row<'_>) -> Result<Job, rusqlite::Error> {
    let progress_raw: i64 = row.get(5)?;
    let progress = progress_raw.clamp(0, 100) as u8;

    let output_files_json: String = row.get(10)?;
    let output_files = serde_json::from_str::<Vec<String>>(&output_files_json).unwrap_or_default();

    let whisperx_options_json: Option<String> = row.get(11)?;
    let whisperx_options =
        whisperx_options_json.and_then(|json| serde_json::from_str::<WhisperxOptions>(&json).ok());

    let live_transcript_json: String = row.get(12)?;
    let live_transcript_segments =
        serde_json::from_str::<Vec<LiveTranscriptSegment>>(&live_transcript_json)
            .unwrap_or_default();

    let priority: i64 = row.get::<_, i64>(13).unwrap_or(2);
    let queue_order: i64 = row.get::<_, i64>(14).unwrap_or(0);

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
        live_transcript_segments,
        priority: priority.clamp(0, 3) as u8,
        queue_order,
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

/// Ouvre une connexion SQLite avec WAL mode et busy_timeout configurés,
/// puis exécute la closure. Centralise la configuration de connexion pour
/// éviter les SQLITE_BUSY sous charge (WX-679).
pub(crate) fn with_conn<T, F>(path: &Path, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let conn = Connection::open(path).map_err(|err| format!("DB open failed: {err}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
        .map_err(|err| format!("DB PRAGMA failed: {err}"))?;
    f(&conn)
}

pub(crate) fn init_database(path: &Path) -> Result<(), String> {
    with_conn(path, |conn| {
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
              whisperx_options TEXT,
              live_transcript_segments TEXT NOT NULL DEFAULT '[]'
            );
            ",
        )
        .map_err(|err| format!("DB init failed: {err}"))?;
        migrate_schema(conn)
    })
}

fn jobs_table_has_column(conn: &Connection, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(jobs)")
        .map_err(|err| format!("PRAGMA table_info failed: {err}"))?;
    let mut rows = stmt
        .query([])
        .map_err(|err| format!("table_info query failed: {err}"))?;
    while let Some(row) = rows
        .next()
        .map_err(|err| format!("table_info row: {err}"))?
    {
        let name: String = row
            .get(1)
            .map_err(|err| format!("table_info name: {err}"))?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
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

    if version < 2 {
        if !jobs_table_has_column(conn, "live_transcript_segments")? {
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN live_transcript_segments TEXT NOT NULL DEFAULT '[]'",
                [],
            )
            .map_err(|err| format!("Migrate v2 (live_transcript_segments) failed: {err}"))?;
        }
        conn.pragma_update(None, "user_version", 2)
            .map_err(|err| format!("Set schema version failed: {err}"))?;
    }

    if version < 3 {
        // WX-672 — priority P0-P3 (default 2 = P2) and queue_order for DnD
        if !jobs_table_has_column(conn, "priority")? {
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 2",
                [],
            )
            .map_err(|err| format!("Migrate v3 (priority) failed: {err}"))?;
        }
        if !jobs_table_has_column(conn, "queue_order")? {
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|err| format!("Migrate v3 (queue_order) failed: {err}"))?;
        }
        conn.pragma_update(None, "user_version", 3)
            .map_err(|err| format!("Set schema version v3 failed: {err}"))?;
    }

    Ok(())
}

pub(crate) fn persist_job(db_path: &Path, job: &Job) -> Result<(), String> {
    let output_files_json = serde_json::to_string(&job.output_files)
        .map_err(|err| format!("Serialize output_files failed: {err}"))?;
    let whisperx_options_json = job
        .whisperx_options
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|err| format!("Serialize whisperx_options failed: {err}"))?;

    with_conn(db_path, |conn| {
        conn.execute(
            "
            INSERT INTO jobs (
              id, input_path, output_dir, mode, status, progress,
              message, created_at_ms, updated_at_ms, error,
              output_files, whisperx_options, priority, queue_order
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6,
              ?7, ?8, ?9, ?10,
              ?11, ?12, ?13, ?14
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
              whisperx_options = excluded.whisperx_options,
              priority = excluded.priority,
              queue_order = excluded.queue_order
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
                whisperx_options_json,
                i64::from(job.priority),
                job.queue_order
            ],
        )
        .map_err(|err| format!("Persist job failed: {err}"))?;
        Ok(())
    })
}

/// WX-672 — Met à jour la priorité d'un job (P0-P3).
pub(crate) fn update_job_priority(db_path: &Path, job_id: &str, priority: u8) -> Result<(), String> {
    with_conn(db_path, |conn| {
        conn.execute(
            "UPDATE jobs SET priority = ?1, updated_at_ms = ?2 WHERE id = ?3",
            params![i64::from(priority.min(3)), crate::time_utils::now_ms() as i64, job_id],
        )
        .map_err(|err| format!("Update job priority failed: {err}"))?;
        Ok(())
    })
}

/// WX-672 — Met à jour `queue_order` pour une liste ordonnée de job IDs.
pub(crate) fn update_jobs_queue_order(db_path: &Path, ordered_ids: &[String]) -> Result<(), String> {
    with_conn(db_path, |conn| {
        for (idx, id) in ordered_ids.iter().enumerate() {
            conn.execute(
                "UPDATE jobs SET queue_order = ?1 WHERE id = ?2",
                params![idx as i64, id],
            )
            .map_err(|err| format!("Update queue_order failed: {err}"))?;
        }
        Ok(())
    })
}

/// Supprime une ligne de `jobs`. Retourne `true` si une ligne a été supprimée.
pub(crate) fn delete_job_row(db_path: &Path, job_id: &str) -> Result<bool, String> {
    with_conn(db_path, |conn| {
        let n = conn
            .execute("DELETE FROM jobs WHERE id = ?1", params![job_id])
            .map_err(|err| format!("Delete job failed: {err}"))?;
        Ok(n > 0)
    })
}

pub(crate) fn count_jobs(db_path: &Path) -> Result<i64, String> {
    with_conn(db_path, |conn| {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM jobs", [], |row| row.get(0))
            .map_err(|err| format!("Count jobs failed: {err}"))?;
        Ok(count)
    })
}

/// Première page (démarrage app).
pub(crate) fn load_jobs(db_path: &Path) -> Result<Vec<Job>, String> {
    load_jobs_page(db_path, 0, JOBS_PAGE_SIZE)
}

pub(crate) fn load_jobs_page(db_path: &Path, offset: i64, limit: i64) -> Result<Vec<Job>, String> {
    with_conn(db_path, |conn| {
        let mut statement = conn
            .prepare(
                "
                SELECT id, input_path, output_dir, mode, status, progress,
                       message, created_at_ms, updated_at_ms, error,
                       output_files, whisperx_options, live_transcript_segments,
                       priority, queue_order
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
    })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static DB_TEST_SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_db_path() -> PathBuf {
        let seq = DB_TEST_SEQ.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("wx-db-test-{seq}"))
    }

    fn make_test_job(id: &str) -> Job {
        Job {
            id: id.into(),
            input_path: "/tmp/test.wav".into(),
            output_dir: "/tmp".into(),
            mode: "mock".into(),
            status: "pending".into(),
            progress: 0,
            message: String::new(),
            created_at_ms: 1_000_000,
            updated_at_ms: 1_000_000,
            error: None,
            output_files: vec![],
            whisperx_options: None,
            live_transcript_segments: vec![],
            priority: 2,
            queue_order: 0,
        }
    }

    #[test]
    fn test_with_conn_sets_wal() -> Result<(), String> {
        let path = temp_db_path();
        with_conn(&path, |conn| {
            conn.execute_batch("CREATE TABLE IF NOT EXISTS _probe (x INTEGER);")
                .map_err(|e| format!("Create table failed: {e}"))?;
            let mode: String = conn
                .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                .map_err(|e| format!("PRAGMA journal_mode failed: {e}"))?;
            assert_eq!(mode, "wal", "journal_mode should be WAL after with_conn");
            Ok(())
        })?;
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_init_database_idempotent() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        init_database(&path)?;
        init_database(&path)?;
        with_conn(&path, |conn| {
            let version: i32 = conn
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|e| format!("Read user_version failed: {e}"))?;
            assert_eq!(version, 3, "Schema should be at version 3 after migration");
            Ok(())
        })?;
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_persist_and_load() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        persist_job(&path, &make_test_job("j1"))?;
        let jobs = load_jobs(&path)?;
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, "j1");
        assert_eq!(jobs[0].status, "pending");
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_persist_upsert() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        let mut job = make_test_job("j1");
        persist_job(&path, &job)?;
        job.status = "done".into();
        job.progress = 100;
        persist_job(&path, &job)?;
        let jobs = load_jobs(&path)?;
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, "done");
        assert_eq!(jobs[0].progress, 100);
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_count_jobs() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        assert_eq!(count_jobs(&path)?, 0);
        persist_job(&path, &make_test_job("j1"))?;
        persist_job(&path, &make_test_job("j2"))?;
        assert_eq!(count_jobs(&path)?, 2);
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_delete_job_row() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        persist_job(&path, &make_test_job("j1"))?;
        assert!(delete_job_row(&path, "j1")?);
        assert_eq!(count_jobs(&path)?, 0);
        assert!(!delete_job_row(&path, "j1")?); // idempotent
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_load_jobs_page() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        for i in 0u64..5 {
            let mut job = make_test_job(&format!("j{i}"));
            job.created_at_ms = 1_000_000 + i * 1000;
            persist_job(&path, &job)?;
        }
        let page1 = load_jobs_page(&path, 0, 3)?;
        assert_eq!(page1.len(), 3);
        let page2 = load_jobs_page(&path, 3, 3)?;
        assert_eq!(page2.len(), 2);
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_update_job_priority_clamp() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        persist_job(&path, &make_test_job("j1"))?;
        update_job_priority(&path, "j1", 0)?;
        assert_eq!(load_jobs(&path)?[0].priority, 0);
        update_job_priority(&path, "j1", 99)?;
        assert_eq!(load_jobs(&path)?[0].priority, 3); // clamped
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn test_queue_order() -> Result<(), String> {
        let path = temp_db_path();
        init_database(&path)?;
        persist_job(&path, &make_test_job("j1"))?;
        persist_job(&path, &make_test_job("j2"))?;
        persist_job(&path, &make_test_job("j3"))?;
        let ordered = vec!["j3".into(), "j1".into(), "j2".into()];
        update_jobs_queue_order(&path, &ordered)?;
        with_conn(&path, |conn| {
            let order: i64 = conn
                .query_row(
                    "SELECT queue_order FROM jobs WHERE id = 'j3'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Query failed: {e}"))?;
            assert_eq!(order, 0, "j3 should be first (queue_order = 0)");
            Ok(())
        })?;
        let _ = std::fs::remove_file(&path);
        Ok(())
    }
}
