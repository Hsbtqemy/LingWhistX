//! Commandes Tauri: creation, liste et annulation des jobs.

use std::path::Path;

use tauri::{AppHandle, Manager, State};

use crate::app_events::{emit_job_deleted, emit_job_log, emit_job_update};
use crate::db::{
    count_jobs, delete_job_row, load_jobs_page, persist_job, redact_whisperx_options_for_storage,
    update_job_priority, update_jobs_queue_order, JOBS_PAGE_SIZE,
};
use crate::jobs::{current_job_status, mutate_job, run_job_thread};
use crate::models::{
    CreateJobRequest, DbState, Job, JobLogEvent, JobsPaginationInfo, JobsPaginationState,
    JobsState, LoadMoreJobsResult, RuntimeState,
};
use crate::path_guard::validate_custom_output_dir;
use crate::process_utils::kill_process_tree;
use crate::time_utils::now_ms;

/// Limite de jobs en file ou en cours (evite de lancer un nombre illimite de workers Python).
const MAX_CONCURRENT_ACTIVE_JOBS: usize = 4;

fn default_output_dir(app: &AppHandle, job_id: &str) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Unable to resolve app local data dir: {err}"))?
        .join("runs")
        .join(job_id);
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Unable to create output directory: {err}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_job(
    app: AppHandle,
    db_state: State<DbState>,
    state: State<JobsState>,
    pagination: State<JobsPaginationState>,
    runtime_state: State<RuntimeState>,
    request: CreateJobRequest,
) -> Result<Job, String> {
    if request.input_path.trim().is_empty() {
        return Err("inputPath is required".into());
    }

    let input_path = Path::new(request.input_path.trim());
    if !input_path.exists() {
        return Err("inputPath does not exist on disk".into());
    }
    if !input_path.is_file() {
        return Err("inputPath must be a file (not a directory)".into());
    }

    let mode = request.mode.unwrap_or_else(|| "mock".into());
    if mode != "mock" && mode != "whisperx" && mode != "analyze_only" {
        return Err("mode must be one of: mock, whisperx, analyze_only".into());
    }
    let job_id = format!("job-{}", uuid::Uuid::new_v4());
    let output_dir = if let Some(dir) = request.output_dir {
        if dir.trim().is_empty() {
            default_output_dir(&app, &job_id)?
        } else {
            validate_custom_output_dir(&app, &dir)?
                .to_string_lossy()
                .to_string()
        }
    } else {
        default_output_dir(&app, &job_id)?
    };

    let ts = now_ms();
    let whisperx_options_for_storage =
        redact_whisperx_options_for_storage(request.whisperx_options.clone());
    let job = Job {
        id: job_id.clone(),
        input_path: request.input_path.clone(),
        output_dir: output_dir.clone(),
        mode: mode.clone(),
        status: "queued".into(),
        progress: 0,
        message: "Queued".into(),
        created_at_ms: ts,
        updated_at_ms: ts,
        error: None,
        output_files: vec![],
        whisperx_options: whisperx_options_for_storage,
        live_transcript_segments: vec![],
        priority: 2,
        queue_order: 0,
    };

    {
        let mut lock = state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock in-memory job store".to_string())?;
        let active = lock
            .values()
            .filter(|j| j.status == "queued" || j.status == "running")
            .count();
        if active >= MAX_CONCURRENT_ACTIVE_JOBS {
            return Err(format!(
                "Too many active jobs (max {MAX_CONCURRENT_ACTIVE_JOBS}). Wait for completion or cancel a job."
            ));
        }
        lock.insert(job_id.clone(), job.clone());
    }

    persist_job(&db_state.path, &job)?;

    {
        if let Ok(mut meta) = pagination.inner.lock() {
            if let Ok(t) = count_jobs(db_state.path.as_ref()) {
                meta.total_in_db = t;
            }
        }
    }

    let app_for_thread = app.clone();
    let db_for_thread = db_state.path.as_ref().to_path_buf();
    let jobs_for_thread = state.jobs.clone();
    let runtime_for_thread = runtime_state.running_pids.clone();
    let whisperx_options_for_thread = request.whisperx_options.clone();

    std::thread::spawn(move || {
        run_job_thread(
            app_for_thread,
            db_for_thread,
            jobs_for_thread,
            runtime_for_thread,
            job_id,
            request.input_path,
            output_dir,
            mode,
            whisperx_options_for_thread,
        );
    });

    emit_job_update(&app, &job);
    Ok(job)
}

#[tauri::command]
pub fn list_jobs(state: State<JobsState>) -> Result<Vec<Job>, String> {
    let mut jobs = state
        .jobs
        .lock()
        .map_err(|_| "Failed to lock in-memory job store".to_string())?
        .values()
        .cloned()
        .collect::<Vec<Job>>();

    jobs.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    Ok(jobs)
}

#[tauri::command]
pub fn get_jobs_pagination_info(
    pagination: State<JobsPaginationState>,
) -> Result<JobsPaginationInfo, String> {
    let meta = pagination
        .inner
        .lock()
        .map_err(|_| "Failed to lock jobs pagination state".to_string())?;
    Ok(JobsPaginationInfo {
        has_more: meta.next_db_offset < meta.total_in_db,
        total_in_db: meta.total_in_db,
        next_db_offset: meta.next_db_offset,
    })
}

#[tauri::command]
pub fn load_more_jobs_from_db(
    db_state: State<DbState>,
    pagination: State<JobsPaginationState>,
    jobs_state: State<JobsState>,
) -> Result<LoadMoreJobsResult, String> {
    let total_in_db = count_jobs(db_state.path.as_ref())?;
    let mut meta = pagination
        .inner
        .lock()
        .map_err(|_| "Failed to lock jobs pagination state".to_string())?;
    meta.total_in_db = total_in_db;

    if meta.next_db_offset >= meta.total_in_db {
        return Ok(LoadMoreJobsResult {
            merged_count: 0,
            has_more: false,
            next_db_offset: meta.next_db_offset,
            total_in_db: meta.total_in_db,
        });
    }

    let page = load_jobs_page(db_state.path.as_ref(), meta.next_db_offset, JOBS_PAGE_SIZE)?;
    let page_len = page.len();

    if page_len == 0 {
        meta.next_db_offset = meta.total_in_db;
        return Ok(LoadMoreJobsResult {
            merged_count: 0,
            has_more: false,
            next_db_offset: meta.next_db_offset,
            total_in_db: meta.total_in_db,
        });
    }

    let mut merged_count = 0usize;

    {
        let mut lock = jobs_state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock in-memory job store".to_string())?;
        for job in page {
            if !lock.contains_key(&job.id) {
                lock.insert(job.id.clone(), job);
                merged_count += 1;
            }
        }
    }

    meta.next_db_offset += page_len as i64;
    let has_more = meta.next_db_offset < meta.total_in_db;

    Ok(LoadMoreJobsResult {
        merged_count,
        has_more,
        next_db_offset: meta.next_db_offset,
        total_in_db: meta.total_in_db,
    })
}

#[tauri::command]
pub fn get_job(state: State<JobsState>, job_id: String) -> Result<Option<Job>, String> {
    let maybe_job = state
        .jobs
        .lock()
        .map_err(|_| "Failed to lock in-memory job store".to_string())?
        .get(&job_id)
        .cloned();

    Ok(maybe_job)
}

#[tauri::command]
pub fn cancel_job(
    app: AppHandle,
    db_state: State<DbState>,
    state: State<JobsState>,
    runtime_state: State<RuntimeState>,
    job_id: String,
) -> Result<(), String> {
    let status =
        current_job_status(&state.jobs, &job_id).ok_or_else(|| "Unknown job id".to_string())?;

    if status == "done" || status == "error" || status == "cancelled" {
        return Err(format!("Cannot cancel job in status '{status}'"));
    }

    mutate_job(&app, &db_state.path, &state.jobs, &job_id, |job| {
        job.status = "cancelled".into();
        job.progress = 100;
        job.message = "Cancellation requested by user".into();
        job.error = None;
    });

    let maybe_pid = runtime_state
        .running_pids
        .lock()
        .map_err(|_| "Failed to lock running pid store".to_string())?
        .remove(&job_id);

    if let Some(pid) = maybe_pid {
        kill_process_tree(pid)?;
        let event = JobLogEvent {
            job_id,
            ts_ms: now_ms(),
            stream: "system".into(),
            level: "warning".into(),
            stage: Some("system".into()),
            message: format!("Process {pid} terminated"),
        };
        emit_job_log(&app, &event);
    }

    Ok(())
}

#[tauri::command]
pub fn delete_job(
    app: AppHandle,
    db_state: State<DbState>,
    state: State<JobsState>,
    pagination: State<JobsPaginationState>,
    runtime_state: State<RuntimeState>,
    job_id: String,
) -> Result<(), String> {
    let status =
        current_job_status(&state.jobs, &job_id).ok_or_else(|| "Unknown job id".to_string())?;

    if status == "queued" || status == "running" {
        return Err("Cannot delete a queued or running job; cancel it first.".into());
    }

    delete_job_row(db_state.path.as_ref(), &job_id)?;

    {
        let mut lock = state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock in-memory job store".to_string())?;
        lock.remove(&job_id);
    }

    {
        let _ = runtime_state
            .running_pids
            .lock()
            .map_err(|_| "Failed to lock running pid store".to_string())?
            .remove(&job_id);
    }

    {
        let mut meta = pagination
            .inner
            .lock()
            .map_err(|_| "Failed to lock jobs pagination state".to_string())?;
        meta.total_in_db = count_jobs(db_state.path.as_ref())?;
        meta.next_db_offset = meta.next_db_offset.min(meta.total_in_db);
    }

    emit_job_deleted(&app, &job_id);
    Ok(())
}

/// WX-672 — Modifie la priorité d'un job (P0 = highest, P3 = lowest).
#[tauri::command]
pub fn set_job_priority(
    app: AppHandle,
    db_state: State<DbState>,
    state: State<JobsState>,
    job_id: String,
    priority: u8,
) -> Result<Job, String> {
    if priority > 3 {
        return Err(format!("Invalid priority {priority}: must be 0–3"));
    }
    update_job_priority(db_state.path.as_ref(), &job_id, priority)?;
    let updated = {
        let mut lock = state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock job store".to_string())?;
        let job = lock.get_mut(&job_id).ok_or_else(|| "Unknown job id".to_string())?;
        job.priority = priority;
        job.clone()
    };
    emit_job_update(&app, &updated);
    Ok(updated)
}

/// WX-672 — Réordonne la file en appliquant une liste ordonnée d'IDs.
#[tauri::command]
pub fn reorder_jobs(
    app: AppHandle,
    db_state: State<DbState>,
    state: State<JobsState>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    update_jobs_queue_order(db_state.path.as_ref(), &ordered_ids)?;
    {
        let mut lock = state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock job store".to_string())?;
        for (idx, id) in ordered_ids.iter().enumerate() {
            if let Some(job) = lock.get_mut(id) {
                job.queue_order = idx as i64;
            }
        }
    }
    // Emit updates for all reordered jobs
    {
        let lock = state
            .jobs
            .lock()
            .map_err(|_| "Failed to lock job store".to_string())?;
        for id in &ordered_ids {
            if let Some(job) = lock.get(id) {
                emit_job_update(&app, job);
            }
        }
    }
    Ok(())
}
