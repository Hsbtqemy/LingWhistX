//! Commandes Tauri: chargement, brouillon, export transcript.

use std::path::PathBuf;

use crate::models::{
    ExportTranscriptRequest, ExportTranscriptResponse, SaveTranscriptDraftRequest,
    SaveTranscriptDraftResponse, SaveTranscriptRequest, TranscriptDocument,
    TranscriptDraftDocument,
};
use crate::path_guard::{resolve_existing_file_path, validate_path_string};
use crate::time_utils::{now_ms, system_time_to_ms};
use crate::transcript::{
    apply_export_timing_rules, build_transcript_draft_json, build_transcript_json,
    draft_path_for_source, edited_path_with_ext, load_segments_from_json, to_csv_text, to_srt_text,
    to_txt_text, to_vtt_text,
};

#[tauri::command]
pub fn load_transcript_document(path: String) -> Result<TranscriptDocument, String> {
    let target = resolve_existing_file_path(
        &path,
        "Transcript file does not exist",
        "Transcript path is not a file",
    )?;
    let text = std::fs::read_to_string(&target)
        .map_err(|err| format!("Unable to read transcript: {err}"))?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|err| format!("Invalid transcript JSON content: {err}"))?;
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
    validate_path_string(&path)?;
    let source = PathBuf::from(path.trim());
    let draft_path = draft_path_for_source(&source);
    if !draft_path.exists() {
        return Ok(None);
    }
    if !draft_path.is_file() {
        return Err("Draft path exists but is not a file".into());
    }

    let text = std::fs::read_to_string(&draft_path)
        .map_err(|err| format!("Unable to read draft: {err}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|err| format!("Invalid draft JSON content: {err}"))?;
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
    validate_path_string(&request.path)?;
    let source = PathBuf::from(request.path.trim());
    let draft_path = draft_path_for_source(&source);
    let payload = build_transcript_draft_json(&source, request.language, &request.segments);
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("Unable to serialize draft JSON: {err}"))?;

    if let Some(parent) = draft_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create draft directory: {err}"))?;
    }

    std::fs::write(&draft_path, serialized)
        .map_err(|err| format!("Unable to write transcript draft: {err}"))?;

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
    validate_path_string(&path)?;
    let source = PathBuf::from(path.trim());
    let draft_path = draft_path_for_source(&source);
    if !draft_path.exists() {
        return Ok(false);
    }
    if !draft_path.is_file() {
        return Err("Draft path exists but is not a file".into());
    }
    std::fs::remove_file(&draft_path)
        .map_err(|err| format!("Unable to delete draft file: {err}"))?;
    Ok(true)
}

#[tauri::command]
pub fn save_transcript_json(request: SaveTranscriptRequest) -> Result<String, String> {
    validate_path_string(&request.path)?;
    let source = PathBuf::from(request.path.trim());
    let target_path = if request.overwrite.unwrap_or(false) {
        source.clone()
    } else {
        edited_path_with_ext(&source, "json")
    };

    let payload = build_transcript_json(request.language, &request.segments);
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("Unable to serialize transcript JSON: {err}"))?;

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Unable to create transcript directory: {err}"))?;
    }

    std::fs::write(&target_path, serialized)
        .map_err(|err| format!("Unable to write transcript JSON: {err}"))?;

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
    validate_path_string(&request.path)?;
    let format = request.format.trim().to_lowercase();
    let source = PathBuf::from(request.path.trim());
    let (segments_for_export, report) =
        apply_export_timing_rules(&request.segments, request.rules.as_ref());
    let output = match format.as_str() {
        "json" => {
            let target_path = edited_path_with_ext(&source, "json");
            let payload = build_transcript_json(request.language.clone(), &segments_for_export);
            let serialized = serde_json::to_string_pretty(&payload)
                .map_err(|err| format!("Unable to serialize transcript JSON: {err}"))?;
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export JSON transcript: {err}"))?;
            target_path
        }
        "srt" => {
            let target_path = edited_path_with_ext(&source, "srt");
            let serialized = to_srt_text(&segments_for_export);
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export SRT transcript: {err}"))?;
            target_path
        }
        "vtt" => {
            let target_path = edited_path_with_ext(&source, "vtt");
            let serialized = to_vtt_text(&segments_for_export);
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export VTT transcript: {err}"))?;
            target_path
        }
        "txt" => {
            let target_path = edited_path_with_ext(&source, "txt");
            let serialized = to_txt_text(&segments_for_export);
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export TXT transcript: {err}"))?;
            target_path
        }
        "csv" => {
            let target_path = edited_path_with_ext(&source, "csv");
            let serialized = to_csv_text(&segments_for_export);
            if let Some(parent) = target_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Unable to create export directory: {err}"))?;
            }
            std::fs::write(&target_path, serialized)
                .map_err(|err| format!("Unable to export CSV transcript: {err}"))?;
            target_path
        }
        other => return Err(format!("Unsupported export format: {other}")),
    };

    Ok(ExportTranscriptResponse {
        output_path: output.to_string_lossy().to_string(),
        report,
    })
}
