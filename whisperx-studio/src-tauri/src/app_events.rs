//! Emission d evenements Tauri vers le frontend.

use tauri::{AppHandle, Emitter};

use crate::models::{
    AudioQualityReport, Job, JobLogEvent, RuntimeSetupFinishedEvent, RuntimeSetupLogEvent,
    WaveformCancelledEvent, WaveformErrorEvent, WaveformProgressEvent, WaveformReadyEvent,
};
use crate::time_utils::now_ms;

pub(crate) fn emit_job_update(app: &AppHandle, job: &Job) {
    let _ = app.emit("job-updated", job);
}

pub(crate) fn emit_job_deleted(app: &AppHandle, job_id: &str) {
    let _ = app.emit("job-deleted", serde_json::json!({ "jobId": job_id }));
}

pub(crate) fn emit_job_log(app: &AppHandle, log_event: &JobLogEvent) {
    let _ = app.emit("job-log", log_event);
}

pub(crate) fn emit_waveform_progress(app: &AppHandle, event: &WaveformProgressEvent) {
    let _ = app.emit("waveform-progress", event);
}

pub(crate) fn emit_waveform_ready(app: &AppHandle, event: &WaveformReadyEvent) {
    let _ = app.emit("waveform-ready", event);
}

pub(crate) fn emit_waveform_error(app: &AppHandle, event: &WaveformErrorEvent) {
    let _ = app.emit("waveform-error", event);
}

pub(crate) fn emit_waveform_cancelled(app: &AppHandle, event: &WaveformCancelledEvent) {
    let _ = app.emit("waveform-cancelled", event);
}

pub(crate) fn emit_runtime_setup_log(app: &AppHandle, stream: &str, message: &str) {
    let event = RuntimeSetupLogEvent {
        ts_ms: now_ms(),
        stream: stream.into(),
        message: message.into(),
    };
    let _ = app.emit("runtime-setup-log", event);
}

pub(crate) fn emit_runtime_setup_finished(app: &AppHandle, success: bool, message: String) {
    let event = RuntimeSetupFinishedEvent { success, message };
    let _ = app.emit("runtime-setup-finished", event);
}

pub(crate) fn emit_ffmpeg_install_log(app: &AppHandle, stream: &str, message: &str) {
    let event = RuntimeSetupLogEvent {
        ts_ms: now_ms(),
        stream: stream.into(),
        message: message.into(),
    };
    let _ = app.emit("ffmpeg-install-log", event);
}

pub(crate) fn emit_ffmpeg_install_finished(app: &AppHandle, success: bool, message: String) {
    let event = RuntimeSetupFinishedEvent { success, message };
    let _ = app.emit("ffmpeg-install-finished", event);
}

/// WX-661 — rapport qualité audio émis au frontend (`job-audio-quality`).
pub(crate) fn emit_audio_quality(app: &AppHandle, job_id: &str, report: &AudioQualityReport) {
    let _ = app.emit(
        "job-audio-quality",
        serde_json::json!({ "jobId": job_id, "report": report }),
    );
}
