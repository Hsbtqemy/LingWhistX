//! Commandes Tauri: chargement, brouillon, export transcript.

use std::path::{Path, PathBuf};

use crate::log_redaction::redact_user_home_in_text;
use crate::models::{
    ExportRunTimingPackRequest, ExportRunTimingPackResponse, ExportTranscriptRequest,
    ExportTranscriptResponse, SaveTranscriptDraftRequest, SaveTranscriptDraftResponse,
    SaveTranscriptRequest, TranscriptDocument, TranscriptDraftDocument,
};
use crate::path_guard::{resolve_existing_file_path, validate_path_string};
use crate::time_utils::{now_ms, system_time_to_ms};
use crate::transcript::{
    apply_export_timing_rules, build_transcript_draft_json, build_transcript_json,
    draft_path_for_source, edited_path_with_ext, load_segments_from_json, to_csv_text,
    to_eaf_text, to_srt_text, to_textgrid_text, to_txt_text, to_vtt_text,
};

fn write_export_sidecar_file(path: &Path, content: &str, err_ctx: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Unable to create export directory: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }
    std::fs::write(path, content).map_err(|err| {
        format!(
            "{}: {}",
            err_ctx,
            redact_user_home_in_text(&err.to_string())
        )
    })
}

#[tauri::command]
pub fn load_transcript_document(path: String) -> Result<TranscriptDocument, String> {
    let target = resolve_existing_file_path(
        &path,
        "Transcript file does not exist",
        "Transcript path is not a file",
    )?;
    let text = std::fs::read_to_string(&target).map_err(|err| {
        format!(
            "Unable to read transcript: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|err| {
        format!(
            "Invalid transcript JSON content: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let language = value
        .get("language")
        .and_then(|lang| lang.as_str())
        .map(ToOwned::to_owned);
    let segments = load_segments_from_json(&value);
    if segments.is_empty() {
        return Err("No usable segments were found in transcript JSON".into());
    }

    Ok(TranscriptDocument {
        path,
        language,
        segments,
    })
}

#[tauri::command]
pub fn load_transcript_draft(path: String) -> Result<Option<TranscriptDraftDocument>, String> {
    let source = resolve_existing_file_path(
        &path,
        "Transcript file does not exist",
        "Transcript path is not a file",
    )?;
    let draft_path = draft_path_for_source(&source);
    if !draft_path.exists() {
        return Ok(None);
    }
    if !draft_path.is_file() {
        return Err("Draft path exists but is not a file".into());
    }

    let text = std::fs::read_to_string(&draft_path).map_err(|err| {
        format!(
            "Unable to read draft: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|err| {
        format!(
            "Invalid draft JSON content: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let language = value
        .get("language")
        .and_then(|lang| lang.as_str())
        .map(ToOwned::to_owned);
    let segments = load_segments_from_json(&value);
    if segments.is_empty() {
        return Ok(None);
    }

    let updated_at_ms = draft_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(system_time_to_ms)
        .unwrap_or_else(now_ms);

    Ok(Some(TranscriptDraftDocument {
        source_path: source.to_string_lossy().to_string(),
        draft_path: draft_path.to_string_lossy().to_string(),
        updated_at_ms,
        language,
        segments,
    }))
}

#[tauri::command]
pub fn save_transcript_draft(
    request: SaveTranscriptDraftRequest,
) -> Result<SaveTranscriptDraftResponse, String> {
    let source = resolve_existing_file_path(
        &request.path,
        "Transcript file does not exist",
        "Transcript path is not a file",
    )?;
    let draft_path = draft_path_for_source(&source);
    let payload = build_transcript_draft_json(&source, request.language, &request.segments);
    let serialized = serde_json::to_string_pretty(&payload).map_err(|err| {
        format!(
            "Unable to serialize draft JSON: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;

    if let Some(parent) = draft_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Unable to create draft directory: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }

    std::fs::write(&draft_path, serialized).map_err(|err| {
        format!(
            "Unable to write transcript draft: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;

    let updated_at_ms = draft_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(system_time_to_ms)
        .unwrap_or_else(now_ms);

    Ok(SaveTranscriptDraftResponse {
        draft_path: draft_path.to_string_lossy().to_string(),
        updated_at_ms,
    })
}

#[tauri::command]
pub fn delete_transcript_draft(path: String) -> Result<bool, String> {
    let source = resolve_existing_file_path(
        &path,
        "Transcript file does not exist",
        "Transcript path is not a file",
    )?;
    let draft_path = draft_path_for_source(&source);
    if !draft_path.exists() {
        return Ok(false);
    }
    if !draft_path.is_file() {
        return Err("Draft path exists but is not a file".into());
    }
    std::fs::remove_file(&draft_path).map_err(|err| {
        format!(
            "Unable to delete draft file: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    Ok(true)
}

#[tauri::command]
pub fn save_transcript_json(request: SaveTranscriptRequest) -> Result<String, String> {
    let source = resolve_existing_file_path(
        &request.path,
        "Transcript file does not exist",
        "Transcript path is not a file",
    )?;
    let target_path = if request.overwrite.unwrap_or(false) {
        source.clone()
    } else {
        edited_path_with_ext(&source, "json")
    };

    let payload = build_transcript_json(request.language, &request.segments);
    let serialized = serde_json::to_string_pretty(&payload).map_err(|err| {
        format!(
            "Unable to serialize transcript JSON: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Unable to create transcript directory: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
    }

    std::fs::write(&target_path, serialized).map_err(|err| {
        format!(
            "Unable to write transcript JSON: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;

    let draft_path = draft_path_for_source(&source);
    if draft_path.exists() && draft_path.is_file() {
        let _ = std::fs::remove_file(draft_path);
    }

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_transcript(
    request: ExportTranscriptRequest,
) -> Result<ExportTranscriptResponse, String> {
    let source = resolve_existing_file_path(
        &request.path,
        "Transcript file does not exist",
        "Transcript path is not a file",
    )?;
    let format = request.format.trim().to_lowercase();
    let (segments_for_export, report) =
        apply_export_timing_rules(&request.segments, request.rules.as_ref());
    let output = match format.as_str() {
        "json" => {
            let target_path = edited_path_with_ext(&source, "json");
            let payload = build_transcript_json(request.language.clone(), &segments_for_export);
            let serialized = serde_json::to_string_pretty(&payload).map_err(|err| {
                format!(
                    "Unable to serialize transcript JSON: {}",
                    redact_user_home_in_text(&err.to_string())
                )
            })?;
            write_export_sidecar_file(
                &target_path,
                &serialized,
                "Unable to export JSON transcript",
            )?;
            target_path
        }
        "srt" => {
            let target_path = edited_path_with_ext(&source, "srt");
            let serialized = to_srt_text(&segments_for_export);
            write_export_sidecar_file(
                &target_path,
                &serialized,
                "Unable to export SRT transcript",
            )?;
            target_path
        }
        "vtt" => {
            let target_path = edited_path_with_ext(&source, "vtt");
            let serialized = to_vtt_text(&segments_for_export);
            write_export_sidecar_file(
                &target_path,
                &serialized,
                "Unable to export VTT transcript",
            )?;
            target_path
        }
        "txt" => {
            let target_path = edited_path_with_ext(&source, "txt");
            let serialized = to_txt_text(&segments_for_export);
            write_export_sidecar_file(
                &target_path,
                &serialized,
                "Unable to export TXT transcript",
            )?;
            target_path
        }
        "csv" => {
            let target_path = edited_path_with_ext(&source, "csv");
            let serialized = to_csv_text(&segments_for_export);
            write_export_sidecar_file(
                &target_path,
                &serialized,
                "Unable to export CSV transcript",
            )?;
            target_path
        }
        "textgrid" => {
            let target_path = edited_path_with_ext(&source, "TextGrid");
            let serialized = to_textgrid_text(&segments_for_export);
            write_export_sidecar_file(
                &target_path,
                &serialized,
                "Unable to export TextGrid transcript",
            )?;
            target_path
        }
        "eaf" => {
            let target_path = edited_path_with_ext(&source, "eaf");
            let serialized = to_eaf_text(&segments_for_export);
            write_export_sidecar_file(
                &target_path,
                &serialized,
                "Unable to export EAF transcript",
            )?;
            target_path
        }
        other => return Err(format!("Unsupported export format: {other}")),
    };

    Ok(ExportTranscriptResponse {
        output_path: output.to_string_lossy().to_string(),
        report,
    })
}

/// Même livrable que « Export pack timing » (Explorer) : JSON + SRT + CSV à côté du fichier source
/// (`timeline_json` ou `run_json` du manifest).
#[tauri::command]
pub fn export_run_timing_pack(
    request: ExportRunTimingPackRequest,
) -> Result<ExportRunTimingPackResponse, String> {
    validate_path_string(&request.run_dir)?;
    let run_dir = PathBuf::from(request.run_dir.trim());
    let run_dir = run_dir.canonicalize().map_err(|e| {
        format!(
            "Impossible de canoniser run_dir: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;
    let manifest_path = run_dir.join("run_manifest.json");
    if !manifest_path.is_file() {
        return Err("run_manifest.json introuvable dans ce dossier.".into());
    }
    let raw = std::fs::read_to_string(&manifest_path).map_err(|e| {
        redact_user_home_in_text(&e.to_string())
    })?;
    let manifest: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
        redact_user_home_in_text(&e.to_string())
    })?;
    let art = manifest
        .get("artifacts")
        .and_then(|a| a.as_object())
        .ok_or_else(|| "Champ artifacts manquant dans run_manifest.json.".to_string())?;

    let mut source_path: Option<PathBuf> = None;
    let mut language: Option<String> = None;
    let mut segments = Vec::new();

    for key in ["timeline_json", "run_json"] {
        let Some(rel) = art.get(key).and_then(|x| x.as_str()) else {
            continue;
        };
        let p = run_dir.join(rel);
        if !p.is_file() {
            continue;
        }
        let text = std::fs::read_to_string(&p).map_err(|e| {
            format!(
                "Lecture {rel}: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
        let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            format!(
                "JSON {rel}: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
        let segs = load_segments_from_json(&json);
        if !segs.is_empty() {
            source_path = Some(p);
            language = json
                .get("language")
                .and_then(|lang| lang.as_str())
                .map(std::string::ToString::to_string);
            segments = segs;
            break;
        }
    }

    let source_path = source_path.ok_or_else(|| {
        "Aucun artifact timeline_json ou run_json avec segments exploitables.".to_string()
    })?;

    let source_str = source_path.to_string_lossy().to_string();
    let mut last_path = String::new();
    let mut last_report = None;

    for format in ["json", "srt", "vtt", "csv"] {
        let r = export_transcript(ExportTranscriptRequest {
            path: source_str.clone(),
            language: language.clone(),
            segments: segments.clone(),
            format: format.to_string(),
            rules: request.rules.clone(),
        })?;
        last_path = r.output_path;
        last_report = Some(r.report);
    }

    let report =
        last_report.ok_or_else(|| "export pack: aucun format exporté (interne)".to_string())?;

    Ok(ExportRunTimingPackResponse {
        source_path: source_str,
        last_output_path: last_path,
        report,
    })
}
