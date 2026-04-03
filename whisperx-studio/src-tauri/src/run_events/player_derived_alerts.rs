//! Heuristiques d’alertes Player (WX-624 / WX-652) — alignées sur `derivePlayerAlerts` côté front.

use serde::{Deserialize, Serialize};

use super::run_events_query_window::{
    query_run_events_window_inner, EventTurnRow, QueryWindowLayers, QueryWindowLimits,
    QueryWindowRequest, QueryWindowResult,
};

const MAX_WORDS_WORDS_DETAIL: u32 = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDerivedAlert {
    pub id: String,
    pub kind: String,
    pub start_ms: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecomputePlayerAlertsStats {
    pub n_overlap_turn: usize,
    pub n_long_pause: usize,
    pub n_turns_in_window: usize,
    pub n_pauses_in_window: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecomputePlayerAlertsResponse {
    pub alerts: Vec<PlayerDerivedAlert>,
    pub stats: RecomputePlayerAlertsStats,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecomputePlayerAlertsRequest {
    pub run_dir: String,
    pub t0_ms: i64,
    pub t1_ms: i64,
    pub long_pause_ms: u32,
    /// `standard` | `words_detail` — aligné `usePlayerRunWindow`.
    pub query_preset: String,
    #[serde(default)]
    pub speakers: Vec<String>,
}

fn layers_for_preset(preset: &str) -> Result<QueryWindowLayers, String> {
    match preset {
        "standard" | "words_detail" => Ok(QueryWindowLayers {
            words: preset == "words_detail",
            turns: true,
            pauses: true,
            ipus: true,
        }),
        _ => Err(format!(
            "query_preset invalide: {preset} (attendu: standard | words_detail)"
        )),
    }
}

fn limits_for_preset(preset: &str) -> QueryWindowLimits {
    if preset == "words_detail" {
        QueryWindowLimits {
            max_words: MAX_WORDS_WORDS_DETAIL,
            max_turns: 2000,
            max_pauses: 2000,
            max_ipus: 2000,
        }
    } else {
        QueryWindowLimits::default()
    }
}

/// Détecte chevauchements entre tours consécutifs et pauses longues (même logique que le front).
pub fn derive_player_alerts_inner(
    slice: &QueryWindowResult,
    long_pause_ms: i64,
) -> Vec<PlayerDerivedAlert> {
    let mut out: Vec<PlayerDerivedAlert> = Vec::new();
    let mut turns: Vec<&EventTurnRow> = slice.turns.iter().collect();
    turns.sort_by_key(|t| t.start_ms);
    for i in 0..turns.len().saturating_sub(1) {
        let a = turns[i];
        let b = turns[i + 1];
        if a.end_ms > b.start_ms {
            let ov = a.end_ms - b.start_ms;
            out.push(PlayerDerivedAlert {
                id: format!("overlap-{}-{}", a.id, b.id),
                kind: "overlap_turn".to_string(),
                start_ms: b.start_ms,
                message: format!(
                    "Chevauchement tours {} / {} (~{} ms)",
                    a.speaker, b.speaker, ov
                ),
            });
        }
    }
    for p in &slice.pauses {
        if p.dur_ms >= long_pause_ms {
            out.push(PlayerDerivedAlert {
                id: format!("pause-{}", p.id),
                kind: "long_pause".to_string(),
                start_ms: p.start_ms,
                message: format!("Pause longue ({:.1} s)", p.dur_ms as f64 / 1000.0),
            });
        }
    }
    out.sort_by_key(|a| a.start_ms);
    out
}

#[tauri::command]
pub fn recompute_player_alerts(
    request: RecomputePlayerAlertsRequest,
) -> Result<RecomputePlayerAlertsResponse, String> {
    let _ = layers_for_preset(&request.query_preset)?;
    let q = QueryWindowRequest {
        run_dir: request.run_dir.clone(),
        t0_ms: request.t0_ms,
        t1_ms: request.t1_ms,
        layers: layers_for_preset(&request.query_preset)?,
        speakers: request.speakers.clone(),
        limits: limits_for_preset(&request.query_preset),
    };
    let slice = query_run_events_window_inner(q)?;
    let long_pause_ms = request.long_pause_ms as i64;
    let alerts = derive_player_alerts_inner(&slice, long_pause_ms);
    let stats = RecomputePlayerAlertsStats {
        n_overlap_turn: alerts.iter().filter(|a| a.kind == "overlap_turn").count(),
        n_long_pause: alerts.iter().filter(|a| a.kind == "long_pause").count(),
        n_turns_in_window: slice.turns.len(),
        n_pauses_in_window: slice.pauses.len(),
    };
    Ok(RecomputePlayerAlertsResponse { alerts, stats })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run_events::run_events_query_window::{
        EventPauseRow, EventTurnRow, QueryWindowResult, QueryWindowTruncated,
    };

    fn pause(id: i64, dur_ms: i64) -> EventPauseRow {
        EventPauseRow {
            id,
            start_ms: 0,
            end_ms: dur_ms,
            dur_ms,
            pause_type: None,
            speaker: None,
            flags_json: None,
        }
    }

    fn turn(id: i64, start: i64, end: i64, speaker: &str) -> EventTurnRow {
        EventTurnRow {
            id,
            start_ms: start,
            end_ms: end,
            speaker: speaker.to_string(),
            turn_id: None,
            flags_json: None,
            confidence: None,
        }
    }

    fn empty_slice() -> QueryWindowResult {
        QueryWindowResult {
            run_dir: "/tmp".into(),
            t0_ms: 0,
            t1_ms: 60_000,
            words: vec![],
            turns: vec![],
            pauses: vec![],
            ipus: vec![],
            truncated: QueryWindowTruncated {
                words: false,
                turns: false,
                pauses: false,
                ipus: false,
            },
        }
    }

    #[test]
    fn overlap_two_turns() {
        let mut s = empty_slice();
        s.turns = vec![turn(1, 1000, 5000, "A"), turn(2, 4000, 8000, "B")];
        let a = derive_player_alerts_inner(&s, 3000);
        assert!(a.iter().any(|x| x.kind == "overlap_turn"));
        assert_eq!(
            a.iter()
                .find(|x| x.kind == "overlap_turn")
                .unwrap()
                .start_ms,
            4000
        );
    }

    #[test]
    fn long_pause_threshold() {
        let mut s = empty_slice();
        s.pauses = vec![pause(1, 5000)];
        assert!(derive_player_alerts_inner(&s, 3_000)
            .iter()
            .any(|x| x.kind == "long_pause"));
        assert!(!derive_player_alerts_inner(&s, 6000)
            .iter()
            .any(|x| x.kind == "long_pause"));
    }
}
