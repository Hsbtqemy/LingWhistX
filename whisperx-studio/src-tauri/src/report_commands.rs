//! WX-671 — Export rapport prosodique HTML auto-contenu.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::Connection;
use tauri::Manager;

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;
use crate::run_events::{open_events_connection, EVENTS_DB_FILE};
use crate::run_events::ensure_events_sqlite_imported;

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ─── Structures de stats ─────────────────────────────────────────────────────

struct TurnRow {
    start_ms: i64,
    end_ms: i64,
    speaker: String,
}

struct PauseRow {
    dur_ms: i64,
    speaker: Option<String>,
}

struct IpuRow {
    n_words: i64,
    speaker: Option<String>,
}

struct GlobalStats {
    total_speech_ms: i64,
    total_silence_ms: i64,
    n_turns: usize,
    n_pauses: usize,
    n_words: i64,
    total_media_ms: i64,
    avg_words_per_min: f64,
}

struct SpeakerStats {
    speaker: String,
    speech_ms: i64,
    n_turns: usize,
    n_ipus: usize,
    n_words: i64,
    n_pauses: usize,
    total_pause_ms: i64,
    avg_pause_ms: f64,
    words_per_min: f64,
}

// ─── Requêtes SQLite ──────────────────────────────────────────────────────────

fn query_turns(conn: &Connection) -> Result<Vec<TurnRow>, String> {
    let mut stmt = conn
        .prepare("SELECT start_ms, end_ms, speaker FROM turns ORDER BY start_ms")
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TurnRow {
                start_ms: row.get(0)?,
                end_ms: row.get(1)?,
                speaker: row.get::<_, String>(2).unwrap_or_default(),
            })
        })
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    rows.map(|r| r.map_err(|e| redact_user_home_in_text(&e.to_string()))).collect()
}

fn query_pauses(conn: &Connection) -> Result<Vec<PauseRow>, String> {
    let mut stmt = conn
        .prepare("SELECT dur_ms, speaker FROM pauses")
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PauseRow {
                dur_ms: row.get(0)?,
                speaker: row.get(1).ok(),
            })
        })
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    rows.map(|r| r.map_err(|e| redact_user_home_in_text(&e.to_string()))).collect()
}

fn query_ipus(conn: &Connection) -> Result<Vec<IpuRow>, String> {
    let mut stmt = conn
        .prepare("SELECT n_words, speaker FROM ipus")
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(IpuRow {
                n_words: row.get(0)?,
                speaker: row.get(1).ok(),
            })
        })
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    rows.map(|r| r.map_err(|e| redact_user_home_in_text(&e.to_string()))).collect()
}

// ─── Calcul des stats ─────────────────────────────────────────────────────────

fn compute_stats(
    turns: &[TurnRow],
    pauses: &[PauseRow],
    ipus: &[IpuRow],
) -> (GlobalStats, Vec<SpeakerStats>) {
    let total_speech_ms: i64 = turns.iter().map(|t| (t.end_ms - t.start_ms).max(0)).sum();
    let total_pause_ms: i64 = pauses.iter().map(|p| p.dur_ms).sum();
    let total_media_ms = total_speech_ms + total_pause_ms;
    let total_words: i64 = ipus.iter().map(|i| i.n_words).sum();

    let avg_wpm = if total_speech_ms > 0 {
        total_words as f64 / (total_speech_ms as f64 / 60_000.0)
    } else {
        0.0
    };

    // Per-speaker
    let mut sp_speech: HashMap<String, i64> = HashMap::new();
    let mut sp_turns: HashMap<String, usize> = HashMap::new();
    for t in turns {
        let sp = t.speaker.clone();
        *sp_speech.entry(sp.clone()).or_default() += (t.end_ms - t.start_ms).max(0);
        *sp_turns.entry(sp).or_default() += 1;
    }

    let mut sp_ipus: HashMap<String, usize> = HashMap::new();
    let mut sp_words: HashMap<String, i64> = HashMap::new();
    for i in ipus {
        let sp = i.speaker.clone().unwrap_or_else(|| "unknown".into());
        *sp_ipus.entry(sp.clone()).or_default() += 1;
        *sp_words.entry(sp).or_default() += i.n_words;
    }

    let mut sp_pauses: HashMap<String, usize> = HashMap::new();
    let mut sp_pause_ms: HashMap<String, i64> = HashMap::new();
    for p in pauses {
        let sp = p.speaker.clone().unwrap_or_else(|| "unknown".into());
        *sp_pauses.entry(sp.clone()).or_default() += 1;
        *sp_pause_ms.entry(sp).or_default() += p.dur_ms;
    }

    // Union of all speakers
    let mut all_speakers: Vec<String> = {
        let mut s: std::collections::HashSet<String> = std::collections::HashSet::new();
        for k in sp_speech.keys().chain(sp_ipus.keys()).chain(sp_pauses.keys()) {
            s.insert(k.clone());
        }
        let mut v: Vec<String> = s.into_iter().collect();
        v.sort();
        v
    };
    // Filter out "unknown" if real speakers exist
    if all_speakers.len() > 1 {
        all_speakers.retain(|s| s != "unknown");
    }

    let speaker_stats: Vec<SpeakerStats> = all_speakers
        .into_iter()
        .map(|sp| {
            let speech = *sp_speech.get(&sp).unwrap_or(&0);
            let n_t = *sp_turns.get(&sp).unwrap_or(&0);
            let n_i = *sp_ipus.get(&sp).unwrap_or(&0);
            let n_w = *sp_words.get(&sp).unwrap_or(&0);
            let n_p = *sp_pauses.get(&sp).unwrap_or(&0);
            let pause_ms = *sp_pause_ms.get(&sp).unwrap_or(&0);
            let avg_p = if n_p > 0 { pause_ms as f64 / n_p as f64 } else { 0.0 };
            let wpm = if speech > 0 {
                n_w as f64 / (speech as f64 / 60_000.0)
            } else {
                0.0
            };
            SpeakerStats {
                speaker: sp,
                speech_ms: speech,
                n_turns: n_t,
                n_ipus: n_i,
                n_words: n_w,
                n_pauses: n_p,
                total_pause_ms: pause_ms,
                avg_pause_ms: avg_p,
                words_per_min: wpm,
            }
        })
        .collect();

    let global = GlobalStats {
        total_speech_ms,
        total_silence_ms: total_pause_ms,
        n_turns: turns.len(),
        n_pauses: pauses.len(),
        n_words: total_words,
        total_media_ms,
        avg_words_per_min: avg_wpm,
    };

    (global, speaker_stats)
}

// ─── Histogramme des pauses ───────────────────────────────────────────────────

fn pause_histogram(pauses: &[PauseRow]) -> Vec<(String, usize)> {
    let bins = [
        ("0–0.2 s", 0i64, 200i64),
        ("0.2–0.5 s", 200, 500),
        ("0.5–1 s", 500, 1_000),
        ("1–2 s", 1_000, 2_000),
        ("2–5 s", 2_000, 5_000),
        (">5 s", 5_000, i64::MAX),
    ];
    bins.iter()
        .map(|(label, lo, hi)| {
            let count = pauses
                .iter()
                .filter(|p| p.dur_ms >= *lo && p.dur_ms < *hi)
                .count();
            (label.to_string(), count)
        })
        .collect()
}

// ─── Formatage ───────────────────────────────────────────────────────────────

fn fmt_ms(ms: i64) -> String {
    let s = ms / 1000;
    let min = s / 60;
    let sec = s % 60;
    let rem = (ms % 1000) / 10;
    if min > 0 {
        format!("{min}m {sec:02}.{rem:02}s")
    } else {
        format!("{sec}.{rem:02}s")
    }
}

fn pct(part: i64, total: i64) -> f64 {
    if total <= 0 {
        0.0
    } else {
        part as f64 / total as f64 * 100.0
    }
}

// ─── Génération HTML ─────────────────────────────────────────────────────────

fn build_html(
    run_dir: &str,
    run_id: &str,
    global: &GlobalStats,
    speakers: &[SpeakerStats],
    pauses: &[PauseRow],
    generated_at: &str,
) -> String {
    let histogram = pause_histogram(pauses);

    // Speaker rows
    let sp_rows: String = speakers
        .iter()
        .map(|s| {
            let sp_esc = html_escape(&s.speaker);
            let speech_pct = pct(s.speech_ms, global.total_media_ms);
            format!(
                "<tr>\
<td>{sp_esc}</td>\
<td>{turns}</td>\
<td>{ipus}</td>\
<td>{words}</td>\
<td>{speech}</td>\
<td>{speech_pct:.1}%</td>\
<td>{wpm:.0}</td>\
<td>{n_pauses}</td>\
<td>{total_pause}</td>\
<td>{avg_pause:.3}s</td>\
</tr>",
                sp_esc = sp_esc,
                turns = s.n_turns,
                ipus = s.n_ipus,
                words = s.n_words,
                speech = fmt_ms(s.speech_ms),
                speech_pct = speech_pct,
                wpm = s.words_per_min,
                n_pauses = s.n_pauses,
                total_pause = fmt_ms(s.total_pause_ms),
                avg_pause = s.avg_pause_ms / 1000.0,
            )
        })
        .collect();

    // Histogram rows
    let hist_rows: String = histogram
        .iter()
        .map(|(label, count)| {
            let bar_pct = if let Some(max) = histogram.iter().map(|(_, c)| c).max() {
                if *max > 0 { (*count as f64 / *max as f64 * 100.0) as u32 } else { 0 }
            } else {
                0
            };
            format!(
                "<tr>\
<td>{label}</td>\
<td>{count}</td>\
<td><div class=\"bar\" style=\"width:{bar_pct}%\"></div></td>\
</tr>",
            )
        })
        .collect();

    let global_silence_pct = pct(global.total_silence_ms, global.total_media_ms);
    let global_speech_pct = pct(global.total_speech_ms, global.total_media_ms);
    let run_dir_esc = html_escape(run_dir);

    format!(
        r#"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Rapport prosodique — {run_id}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:#1a202c;background:#f7fafc;padding:32px}}
h1{{font-size:1.5rem;font-weight:700;margin-bottom:4px}}
.meta{{font-size:0.78rem;color:#718096;margin-bottom:24px}}
h2{{font-size:1rem;font-weight:600;margin:24px 0 10px;color:#2d3748}}
.cards{{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}}
.card{{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;min-width:140px}}
.card-val{{font-size:1.4rem;font-weight:700;color:#2b6cb0}}
.card-label{{font-size:0.72rem;color:#718096;margin-top:2px;text-transform:uppercase;letter-spacing:.04em}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:16px}}
th{{background:#edf2f7;text-align:left;padding:8px 12px;font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em;color:#4a5568}}
td{{padding:7px 12px;border-top:1px solid #e2e8f0;font-size:0.82rem}}
.bar-cell{{width:180px}}
.bar{{height:12px;background:#4299e1;border-radius:3px;min-width:2px}}
.footer{{margin-top:32px;font-size:0.72rem;color:#a0aec0}}
</style>
</head>
<body>
<h1>Rapport prosodique</h1>
<p class="meta">Run : <code>{run_id}</code> &nbsp;·&nbsp; {generated_at} &nbsp;·&nbsp; <code>{run_dir_esc}</code></p>
<h2>Statistiques globales</h2>
<div class="cards">
  <div class="card"><div class="card-val">{n_turns}</div><div class="card-label">Tours de parole</div></div>
  <div class="card"><div class="card-val">{n_pauses}</div><div class="card-label">Pauses détectées</div></div>
  <div class="card"><div class="card-val">{n_words}</div><div class="card-label">Mots</div></div>
  <div class="card"><div class="card-val">{total_media}</div><div class="card-label">Durée totale</div></div>
  <div class="card"><div class="card-val">{speech_pct:.0}%</div><div class="card-label">Ratio parole</div></div>
  <div class="card"><div class="card-val">{silence_pct:.0}%</div><div class="card-label">Ratio silence</div></div>
  <div class="card"><div class="card-val">{avg_wpm:.0}</div><div class="card-label">Mots / min</div></div>
</div>
<h2>Par locuteur</h2>
<table>
<thead><tr>
<th>Locuteur</th><th>Tours</th><th>IPU</th><th>Mots</th><th>Parole</th><th>%</th><th>Mots/min</th><th>Pauses</th><th>Durée pauses</th><th>Pause moy.</th>
</tr></thead>
<tbody>{sp_rows}</tbody>
</table>
<h2>Distribution des pauses</h2>
<table>
<thead><tr><th>Durée</th><th>Nb</th><th class="bar-cell">Distribution</th></tr></thead>
<tbody>{hist_rows}</tbody>
</table>
<div class="footer">Généré par LingWhistX · whisperx-studio</div>
</body>
</html>
"#,
        run_id = html_escape(run_id),
        generated_at = html_escape(generated_at),
        run_dir_esc = run_dir_esc,
        n_turns = global.n_turns,
        n_pauses = global.n_pauses,
        n_words = global.n_words,
        total_media = fmt_ms(global.total_media_ms),
        speech_pct = global_speech_pct,
        silence_pct = global_silence_pct,
        avg_wpm = global.avg_words_per_min,
        sp_rows = sp_rows,
        hist_rows = hist_rows,
    )
}

// ─── Commande Tauri ───────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct ExportProsodyReportResponse {
    pub output_path: String,
}

/// Ouvre le rapport HTML dans une fenêtre WebView dédiée et déclenche `window.print()`.
///
/// WX-686 — Le HTML est chargé via le protocole `asset://` (scope $HOME/**).
/// Un `initialization_script` injecte l'appel à `window.print()` dès le DOMContentLoaded.
#[tauri::command]
pub fn open_html_report_for_print(
    app: tauri::AppHandle,
    html_path: String,
) -> Result<(), String> {
    use tauri::WebviewUrl;
    use tauri::WebviewWindowBuilder;

    crate::path_guard::validate_path_string(&html_path)?;
    let path = std::path::PathBuf::from(html_path.trim())
        .canonicalize()
        .map_err(|e| {
            format!(
                "HTML report path not found: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;
    if !path.is_file() {
        return Err("HTML report path is not a file".into());
    }

    // Build an asset:// URL so the WebView can load the local file.
    // The assetProtocol scope in tauri.conf.json includes $HOME/**.
    let asset_url_str = format!(
        "asset://localhost{}",
        path.to_string_lossy()
    );
    let url: tauri::Url = asset_url_str.parse::<tauri::Url>().map_err(|e| {
        format!(
            "Invalid asset URL: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    // Use a deterministic label so re-opening replaces the existing window.
    let label = "print-prosody-report";

    // If a window with this label already exists, focus it and navigate.
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.navigate(url);
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, label, WebviewUrl::CustomProtocol(url.clone()))
        .title("Rapport prosodique — Impression")
        .inner_size(900.0, 720.0)
        .initialization_script(
            "window.addEventListener('DOMContentLoaded', function() { \
                window.print(); \
                window.addEventListener('afterprint', function() { window.close(); }); \
            });",
        )
        .build()
        .map_err(|e| {
            format!(
                "Failed to open print window: {}",
                redact_user_home_in_text(&e.to_string())
            )
        })?;

    Ok(())
}

/// Génère un rapport HTML prosodique auto-contenu à partir de `events.sqlite`.
#[tauri::command]
pub fn export_prosody_report(run_dir: String) -> Result<ExportProsodyReportResponse, String> {
    validate_path_string(&run_dir)?;
    let run_dir_path = PathBuf::from(run_dir.trim())
        .canonicalize()
        .map_err(|e| format!("run_dir: {}", redact_user_home_in_text(&e.to_string())))?;

    // Ensure events.sqlite is imported (lazy)
    ensure_events_sqlite_imported(&run_dir_path)?;

    let db_path = run_dir_path.join(EVENTS_DB_FILE);
    let conn = open_events_connection(&db_path)?;

    let turns = query_turns(&conn)?;
    let pauses = query_pauses(&conn)?;
    let ipus = query_ipus(&conn)?;

    let (global, speakers) = compute_stats(&turns, &pauses, &ipus);

    // Extract run_id from directory name (format: <timestamp>_<short_id> or just the dir name)
    let run_id = run_dir_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "run".into());

    let run_dir_str = run_dir_path.to_string_lossy().to_string();

    // Generate timestamp for filename + report header
    let (generated_at, file_ts) = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let s = secs % 60;
        let m = (secs / 60) % 60;
        let h = (secs / 3600) % 24;
        let days = secs / 86400;
        let (y, mo, d) = epoch_days_to_ymd(days);
        (
            format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02} UTC"),
            format!("{y:04}{mo:02}{d:02}-{h:02}{m:02}{s:02}"),
        )
    };

    let html = build_html(&run_dir_str, &run_id, &global, &speakers, &pauses, &generated_at);

    let output_path = run_dir_path.join(format!("rapport-prosodique-{file_ts}.html"));
    std::fs::write(&output_path, html.as_bytes()).map_err(|e| {
        format!(
            "Unable to write report: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    Ok(ExportProsodyReportResponse {
        output_path: output_path.to_string_lossy().to_string(),
    })
}

/// Convert days since Unix epoch to (year, month, day).
fn epoch_days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    let mut y: u64 = 1970;
    loop {
        let leap = (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400);
        let days_in_year: u64 = if leap { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        y += 1;
    }
    let leap = (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400);
    let month_days: [u64; 12] = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo: u64 = 1;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        mo += 1;
    }
    (y, mo, days + 1)
}
