//! WX-617 — Recalcul rapide des pauses / IPU depuis `words` (sans WhisperX).

use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;

use crate::run_events::open_events_connection;
use crate::run_events::{ensure_events_sqlite_imported, EVENTS_DB_FILE};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcPausesIpuConfig {
    pub min_pause_sec: f64,
    pub ignore_below_sec: f64,
    pub pause_max_sec: Option<f64>,
    #[serde(default = "default_ipu_min_words")]
    pub ipu_min_words: u32,
    #[serde(default)]
    pub ipu_min_duration_sec: f64,
}

fn default_ipu_min_words() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcPausesIpuStats {
    pub n_pauses: usize,
    pub pause_duration_mean_ms: f64,
    pub pause_duration_p95_ms: f64,
    pub n_ipus: usize,
    pub overlap_total_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcPausesIpuResult {
    pub run_dir: String,
    pub stats: RecalcPausesIpuStats,
    pub persisted: bool,
}

struct WordRow {
    start_ms: i64,
    end_ms: i64,
    speaker: Option<String>,
    token: String,
}

type PauseInsertRow = (i64, i64, i64, Option<String>, Option<String>);
type IpuInsertRow = (i64, i64, i64, i32, Option<String>, String);

fn load_words(conn: &Connection) -> Result<Vec<WordRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT start_ms, end_ms, speaker, COALESCE(token, '') FROM words ORDER BY start_ms ASC, id ASC",
        )
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let mut rows = stmt.query([]).map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| redact_user_home_in_text(&e.to_string()))? {
        out.push(WordRow {
            start_ms: row.get(0).map_err(|e| redact_user_home_in_text(&e.to_string()))?,
            end_ms: row.get(1).map_err(|e| redact_user_home_in_text(&e.to_string()))?,
            speaker: row.get(2).map_err(|e| redact_user_home_in_text(&e.to_string()))?,
            token: row.get(3).map_err(|e| redact_user_home_in_text(&e.to_string()))?,
        });
    }
    Ok(out)
}

fn compute_recalc(
    words: &[WordRow],
    cfg: &RecalcPausesIpuConfig,
) -> (Vec<PauseInsertRow>, Vec<IpuInsertRow>, RecalcPausesIpuStats) {
    let min_pause_ms = (cfg.min_pause_sec * 1000.0).round().max(0.0) as i64;
    let ignore_below_ms = (cfg.ignore_below_sec * 1000.0).round().max(0.0) as i64;
    let pause_max_ms = cfg
        .pause_max_sec
        .filter(|x| x.is_finite() && *x > 0.0)
        .map(|s| (s * 1000.0).round() as i64);
    let ipu_min_dur_ms = (cfg.ipu_min_duration_sec * 1000.0).round().max(0.0) as i64;

    let mut overlap_total_ms: i64 = 0;
    let mut pause_durations: Vec<i64> = Vec::new();
    let mut pauses_out: Vec<PauseInsertRow> = Vec::new();
    let mut ipus_out: Vec<IpuInsertRow> = Vec::new();

    if words.is_empty() {
        return (
            pauses_out,
            ipus_out,
            RecalcPausesIpuStats {
                n_pauses: 0,
                pause_duration_mean_ms: 0.0,
                pause_duration_p95_ms: 0.0,
                n_ipus: 0,
                overlap_total_ms: 0,
            },
        );
    }

    // Chevauchements entre mots consécutifs (ordre timeline).
    for w in words.windows(2) {
        let a = &w[0];
        let b = &w[1];
        if b.start_ms < a.end_ms {
            overlap_total_ms += a.end_ms - b.start_ms;
        }
    }

    // IPU : groupe de mots séparés par des gaps < min_pause_ms (sauf gaps < ignore_below_ms traités comme fusionnés).
    let mut ipu_words: Vec<&WordRow> = Vec::new();

    let mut flush_ipu = |cluster: &[&WordRow]| {
        if cluster.is_empty() {
            return;
        }
        let start_ms = cluster[0].start_ms;
        let end_ms = cluster[cluster.len() - 1].end_ms;
        let dur_ms = (end_ms - start_ms).max(0);
        let n_words = cluster.len() as i32;
        let speaker = cluster[0].speaker.clone();
        let text = cluster
            .iter()
            .map(|w| w.token.as_str())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if n_words as u32 >= cfg.ipu_min_words && dur_ms >= ipu_min_dur_ms {
            ipus_out.push((start_ms, end_ms, dur_ms, n_words, speaker, text));
        }
    };

    ipu_words.push(&words[0]);

    for i in 0..words.len() - 1 {
        let w0 = &words[i];
        let w1 = &words[i + 1];
        let gap_ms = w1.start_ms - w0.end_ms;

        if gap_ms < ignore_below_ms {
            // Pont : même IPU.
            ipu_words.push(w1);
            continue;
        }

        if gap_ms >= min_pause_ms {
            let mut dur_ms = gap_ms;
            if let Some(max_ms) = pause_max_ms {
                if dur_ms > max_ms {
                    dur_ms = max_ms;
                }
            }
            let start_p = w0.end_ms;
            let end_p = w0.end_ms + dur_ms;
            pauses_out.push((
                start_p,
                end_p,
                dur_ms,
                Some("transition_gap".into()),
                w0.speaker.clone(),
            ));
            pause_durations.push(dur_ms);

            flush_ipu(&ipu_words);
            ipu_words.clear();
            ipu_words.push(w1);
        } else {
            // Gap court : pas de ligne pause, même IPU.
            ipu_words.push(w1);
        }
    }
    flush_ipu(&ipu_words);

    let n_pauses = pauses_out.len();
    let pause_duration_mean_ms = if pause_durations.is_empty() {
        0.0
    } else {
        pause_durations.iter().map(|x| *x as f64).sum::<f64>() / pause_durations.len() as f64
    };
    let pause_duration_p95_ms = if pause_durations.is_empty() {
        0.0
    } else {
        let mut sorted = pause_durations.clone();
        sorted.sort_unstable();
        let idx = (((sorted.len() as f64 - 1.0) * 0.95).round() as usize).min(sorted.len() - 1);
        sorted[idx] as f64
    };

    let stats = RecalcPausesIpuStats {
        n_pauses,
        pause_duration_mean_ms,
        pause_duration_p95_ms,
        n_ipus: ipus_out.len(),
        overlap_total_ms,
    };

    (pauses_out, ipus_out, stats)
}

fn persist_pauses_ipus(
    conn: &Connection,
    pauses: &[PauseInsertRow],
    ipus: &[IpuInsertRow],
) -> Result<(), String> {
    conn.execute("DELETE FROM pauses", [])
        .map_err(|e| {
            format!(
                "delete pauses: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
    conn.execute("DELETE FROM ipus", [])
        .map_err(|e| {
            format!(
                "delete ipus: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;

    let mut ins_p = conn
        .prepare_cached(
            "INSERT INTO pauses (start_ms, end_ms, dur_ms, type, speaker, flags_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    for (start_ms, end_ms, dur_ms, typ, speaker) in pauses {
        ins_p
            .execute(params![
                start_ms,
                end_ms,
                dur_ms,
                typ.as_deref().unwrap_or(""),
                speaker,
                None::<String>,
            ])
            .map_err(|e| format!("insert pause: {e}"))?;
    }

    let mut ins_i = conn
        .prepare_cached(
            "INSERT INTO ipus (start_ms, end_ms, dur_ms, n_words, speaker, text, flags_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    for (start_ms, end_ms, dur_ms, n_words, speaker, text) in ipus {
        ins_i
            .execute(params![
                start_ms,
                end_ms,
                dur_ms,
                n_words,
                speaker,
                text,
                None::<String>,
            ])
            .map_err(|e| {
                format!(
                    "insert ipu: {}",
                    redact_user_home_in_text(&e.to_string())
                )
            })?;
    }

    Ok(())
}

pub fn recalc_pauses_ipu_inner(
    run_dir: &Path,
    cfg: RecalcPausesIpuConfig,
    persist: bool,
) -> Result<RecalcPausesIpuResult, String> {
    let run_dir = run_dir
        .canonicalize()
        .map_err(|e| format!("run_dir: {}", redact_user_home_in_text(&e.to_string())))?;
    ensure_events_sqlite_imported(&run_dir)?;
    let db_path = run_dir.join(EVENTS_DB_FILE);

    if !cfg.min_pause_sec.is_finite() || cfg.min_pause_sec < 0.0 {
        return Err("min_pause_sec invalide.".into());
    }
    if !cfg.ignore_below_sec.is_finite() || cfg.ignore_below_sec < 0.0 {
        return Err("ignore_below_sec invalide.".into());
    }

    let mut conn = open_events_connection(&db_path)?;
    let words = load_words(&conn)?;
    let (pauses, ipus, stats) = compute_recalc(&words, &cfg);

    if persist {
        let tx = conn.transaction().map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        persist_pauses_ipus(&tx, &pauses, &ipus)?;
        let now = crate::time_utils::now_ms().to_string();
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params!["recalc_pauses_ipu_at_ms", now],
        )
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        let cfg_json = serde_json::to_string(&cfg).map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params!["recalc_pauses_ipu_cfg_json", cfg_json],
        )
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
        tx.commit().map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    }

    Ok(RecalcPausesIpuResult {
        run_dir: run_dir.to_string_lossy().to_string(),
        stats,
        persisted: persist,
    })
}

#[tauri::command]
pub fn recalc_pauses_ipu(
    run_dir: String,
    config: RecalcPausesIpuConfig,
    persist: bool,
) -> Result<RecalcPausesIpuResult, String> {
    validate_path_string(&run_dir)?;
    recalc_pauses_ipu_inner(Path::new(run_dir.trim()), config, persist)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recalc_two_words_one_pause() {
        let words = vec![
            WordRow {
                start_ms: 0,
                end_ms: 100,
                speaker: Some("S0".into()),
                token: "a".into(),
            },
            WordRow {
                start_ms: 500,
                end_ms: 600,
                speaker: Some("S0".into()),
                token: "b".into(),
            },
        ];
        let cfg = RecalcPausesIpuConfig {
            min_pause_sec: 0.2,
            ignore_below_sec: 0.05,
            pause_max_sec: None,
            ipu_min_words: 1,
            ipu_min_duration_sec: 0.0,
        };
        let (pauses, ipus, stats) = compute_recalc(&words, &cfg);
        assert!(stats.n_pauses >= 1);
        assert!(!pauses.is_empty());
        assert_eq!(ipus.len(), 2);
    }
}
