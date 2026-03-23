//! Commandes Tauri: setup runtime local (assistant PowerShell).

use tauri::{AppHandle, State};

use crate::app_events::emit_runtime_setup_finished;
use crate::embedded_resources::run_runtime_setup_process;
use crate::models::{RuntimeSetupState, RuntimeSetupStatus};

#[tauri::command]
pub fn get_runtime_setup_status(
    state: State<RuntimeSetupState>,
) -> Result<RuntimeSetupStatus, String> {
    let running = *state
        .running
        .lock()
        .map_err(|_| "Failed to lock runtime setup state".to_string())?;
    Ok(RuntimeSetupStatus { running })
}

#[tauri::command]
pub fn start_runtime_setup(app: AppHandle, state: State<RuntimeSetupState>) -> Result<(), String> {
    {
        let mut lock = state
            .running
            .lock()
            .map_err(|_| "Failed to lock runtime setup state".to_string())?;
        if *lock {
            return Err("Runtime setup is already running.".into());
        }
        *lock = true;
    }

    let app_for_thread = app.clone();
    let running_state = state.running.clone();
    std::thread::spawn(move || {
        let result = run_runtime_setup_process(&app_for_thread);
        if let Ok(mut lock) = running_state.lock() {
            *lock = false;
        }
        match result {
            Ok(()) => emit_runtime_setup_finished(
                &app_for_thread,
                true,
                "Runtime setup completed.".into(),
            ),
            Err(err) => emit_runtime_setup_finished(&app_for_thread, false, err),
        }
    });

    Ok(())
}
