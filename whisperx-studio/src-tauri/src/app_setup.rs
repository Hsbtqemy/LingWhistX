//! Initialisation au demarrage : SQLite, rehydratation des jobs en memoire.

use std::sync::Arc;

use tauri::{App, Manager, State};

use crate::db::{count_jobs, database_path, init_database, load_jobs};
use crate::models::{DbState, JobsPaginationState, JobsState};

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();
    let db_path = database_path(app_handle).map_err(std::io::Error::other)?;
    init_database(&db_path).map_err(std::io::Error::other)?;
    let total_in_db = count_jobs(&db_path).map_err(std::io::Error::other)?;
    let persisted_jobs = load_jobs(&db_path).map_err(std::io::Error::other)?;
    let initial_offset = persisted_jobs.len() as i64;

    {
        let state: State<JobsState> = app.state();
        let mut lock = state
            .jobs
            .lock()
            .map_err(|_| std::io::Error::other("Failed to lock in-memory job store"))?;
        for job in persisted_jobs {
            lock.insert(job.id.clone(), job);
        }
    }

    {
        let pag: State<JobsPaginationState> = app.state();
        let mut meta = pag
            .inner
            .lock()
            .map_err(|_| std::io::Error::other("Failed to lock jobs pagination state"))?;
        meta.next_db_offset = initial_offset;
        meta.total_in_db = total_in_db;
    }

    app.manage(DbState {
        path: Arc::new(db_path),
    });
    Ok(())
}
