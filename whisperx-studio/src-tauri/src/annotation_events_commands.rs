//! WX-696 — Écriture des tiers d'annotation dans events.sqlite pour affichage Player.
//!
//! Les segments sont insérés comme `turns` avec `flags_json = {"source":"annotation","tier_id":"…"}`.
//! Un DELETE préalable garantit l'idempotence (réimport sans doublon).

use std::path::PathBuf;

use rusqlite::params;
use serde::Deserialize;

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;
use crate::run_events::{open_events_connection, EVENTS_DB_FILE};

/// Un segment d'annotation à insérer comme turn.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSegmentPayload {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Un tier d'annotation (locuteur) avec ses segments.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationTierPayload {
    pub tier_id: String,
    pub segments: Vec<AnnotationSegmentPayload>,
}

/// Écrit les tiers d'annotation dans `events.sqlite` du run.
///
/// Appel : `invoke("write_annotation_tiers_to_events", { runDir, tiers })`
///
/// - Supprime d'abord les turns `source=annotation` existants (idempotent).
/// - Insère chaque segment comme turn avec `speaker = tier_id`.
/// - Retourne le nombre de turns insérés.
#[tauri::command]
pub fn write_annotation_tiers_to_events(
    run_dir: String,
    tiers: Vec<AnnotationTierPayload>,
) -> Result<usize, String> {
    validate_path_string(&run_dir)?;

    let run_dir_path = PathBuf::from(run_dir.trim()).canonicalize().map_err(|e| {
        format!(
            "run_dir invalide : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    let db_path = run_dir_path.join(EVENTS_DB_FILE);
    if !db_path.is_file() {
        return Err(
            "events.sqlite introuvable — ouvre d'abord ce run dans le Player pour l'indexer."
                .into(),
        );
    }

    let conn = open_events_connection(&db_path)?;

    // Suppression idempotente des turns annotation précédents.
    conn.execute(
        r#"DELETE FROM turns WHERE flags_json LIKE '%"source":"annotation"%'"#,
        [],
    )
    .map_err(|e| {
        format!(
            "DELETE annotation turns : {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    let mut n: usize = 0;
    for tier in &tiers {
        // Échappe les guillemets dans le tier_id pour un JSON valide.
        let safe_tier_id = tier.tier_id.replace('\\', "\\\\").replace('"', "\\\"");
        for seg in &tier.segments {
            let safe_text = seg.text.replace('\\', "\\\\").replace('"', "\\\"");
            let flags = format!(
                r#"{{"source":"annotation","tier_id":"{safe_tier_id}","text":"{safe_text}"}}"#,
            );
            let start_ms = (seg.start * 1000.0).round() as i64;
            let end_ms = (seg.end * 1000.0).round() as i64;
            conn.execute(
                "INSERT INTO turns (start_ms, end_ms, speaker, turn_id, flags_json)
                 VALUES (?1, ?2, ?3, NULL, ?4)",
                params![start_ms, end_ms, tier.tier_id, flags],
            )
            .map_err(|e| {
                format!(
                    "INSERT turn (tier={}, seg) : {}",
                    tier.tier_id,
                    redact_user_home_in_text(&e.to_string())
                )
            })?;
            n += 1;
        }
    }

    Ok(n)
}
