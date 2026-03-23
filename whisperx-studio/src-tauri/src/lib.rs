mod db;
mod models;
mod time_utils;

pub(crate) use models::*;

mod transcript;

mod app_events;
mod app_setup;
mod audio_preview;
mod embedded_resources;
mod ffmpeg_tools;
mod job_commands;
mod jobs;
mod local_fs_commands;
mod run_commands;
mod run_events;
mod run_events_recalc;
mod path_guard;
mod process_utils;
mod python_runtime;
mod runtime_setup_commands;
mod runtime_status;
mod transcript_commands;
mod waveform;
mod wxenv;

#[cfg(test)]
mod smoke_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(JobsState::default())
        .manage(JobsPaginationState::default())
        .manage(RuntimeState::default())
        .manage(RuntimeSetupState::default())
        .manage(WaveformTaskState::default())
        .setup(app_setup::setup_app)
        .invoke_handler(tauri::generate_handler![
            job_commands::create_job,
            job_commands::list_jobs,
            job_commands::get_jobs_pagination_info,
            job_commands::load_more_jobs_from_db,
            job_commands::get_job,
            runtime_status::get_runtime_status,
            runtime_setup_commands::get_runtime_setup_status,
            runtime_setup_commands::start_runtime_setup,
            waveform::build_waveform_peaks,
            waveform::start_waveform_generation,
            waveform::cancel_waveform_generation,
            wxenv::build_waveform_pyramid,
            wxenv::read_wxenv_meta,
            wxenv::read_wxenv_slice,
            transcript_commands::load_transcript_document,
            transcript_commands::load_transcript_draft,
            transcript_commands::save_transcript_draft,
            transcript_commands::delete_transcript_draft,
            transcript_commands::save_transcript_json,
            transcript_commands::export_transcript,
            local_fs_commands::open_local_path,
            local_fs_commands::read_text_preview,
            job_commands::cancel_job,
            run_commands::read_run_manifest_summary,
            run_commands::list_recent_runs,
            run_commands::clear_recent_runs,
            run_events::import_run_events,
            run_events::list_run_speakers,
            run_events::query_run_events_window,
            run_events_recalc::recalc_pauses_ipu,
            audio_preview::extract_audio_wav_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
