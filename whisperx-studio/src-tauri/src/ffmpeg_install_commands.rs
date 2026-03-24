//! Commandes Tauri : installation guidée de ffmpeg.

use tauri::{AppHandle, State};

use crate::app_events::emit_ffmpeg_install_finished;
use crate::ffmpeg_install::run_ffmpeg_install_process;
use crate::models::{FfmpegInstallState, RuntimeSetupStatus};

#[tauri::command]
pub fn get_ffmpeg_install_status(
    state: State<FfmpegInstallState>,
) -> Result<RuntimeSetupStatus, String> {
    let running = *state
        .running
        .lock()
        .map_err(|_| "Failed to lock ffmpeg install state".to_string())?;
    Ok(RuntimeSetupStatus { running })
}

#[tauri::command]
pub fn start_ffmpeg_install(
    app: AppHandle,
    state: State<FfmpegInstallState>,
) -> Result<(), String> {
    {
        let mut lock = state
            .running
            .lock()
            .map_err(|_| "Failed to lock ffmpeg install state".to_string())?;
        if *lock {
            return Err("Installation ffmpeg deja en cours.".into());
        }
        *lock = true;
    }

    let app_for_thread = app.clone();
    let running_state = state.running.clone();
    std::thread::spawn(move || {
        let result = run_ffmpeg_install_process(&app_for_thread);
        if let Ok(mut lock) = running_state.lock() {
            *lock = false;
        }
        if let Err(err) = result {
            emit_ffmpeg_install_finished(&app_for_thread, false, err);
        }
    });

    Ok(())
}
