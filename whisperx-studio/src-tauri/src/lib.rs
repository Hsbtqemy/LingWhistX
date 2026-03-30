mod db;
mod models;
mod time_utils;

pub(crate) use models::*;

mod transcript;

mod annotation_events_commands;
mod annotation_import_commands;
mod app_events;
mod app_setup;
mod audio_preview;
mod embedded_resources;
mod ffmpeg_install;
mod ffmpeg_install_commands;
mod ffmpeg_tools;
mod hf_token_commands;
mod job_commands;
mod jobs;
mod local_fs_commands;
mod path_guard;
mod process_utils;
mod python_runtime;
mod report_commands;
mod run_commands;
mod run_events;
mod run_events_recalc;
mod runtime_setup_commands;
mod runtime_status;
mod transcript_commands;
mod user_profiles_commands;
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
        .manage(FfmpegInstallState::default())
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
            ffmpeg_install_commands::get_ffmpeg_install_status,
            ffmpeg_install_commands::start_ffmpeg_install,
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
            transcript_commands::export_run_timing_pack,
            report_commands::export_prosody_report,
            report_commands::open_html_report_for_print,
            local_fs_commands::open_local_path,
            local_fs_commands::read_text_preview,
            local_fs_commands::list_directory_files,
            job_commands::cancel_job,
            job_commands::delete_job,
            job_commands::set_job_priority,
            job_commands::reorder_jobs,
            run_commands::read_run_manifest_summary,
            run_commands::list_recent_runs,
            run_commands::clear_recent_runs,
            run_commands::remove_recent_run,
            run_commands::delete_run_directory,
            run_commands::find_run_transcript_json,
            run_events::import_run_events,
            run_events::list_run_speakers,
            run_events::query_run_events_window,
            run_events::player_derived_alerts::recompute_player_alerts,
            run_events_recalc::recalc_pauses_ipu,
            audio_preview::extract_audio_wav_window,
            audio_preview::read_extracted_wav_bytes_b64,
            audio_preview::export_audio_wav_segment,
            audio_preview::generate_preprocessed_audio_preview,
            hf_token_commands::validate_hf_token,
            user_profiles_commands::read_user_profiles,
            user_profiles_commands::save_user_profile,
            user_profiles_commands::delete_user_profile,
            annotation_import_commands::import_annotation_file,
            annotation_events_commands::write_annotation_tiers_to_events
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
