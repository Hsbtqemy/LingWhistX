//! WX-671/717 — Export rapport HTML auto-contenu : metadata + stats + transcript + graphiques SVG.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::Connection;
use tauri::Manager;

use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;
use crate::run_events::ensure_events_sqlite_imported;
use crate::run_events::{open_events_connection, EVENTS_DB_FILE};

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ─── Structures de données ────────────────────────────────────────────────────

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

struct WordRow {
    start_ms: i64,
    end_ms: i64,
    token: Option<String>,
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

struct ManifestMeta {
    run_id: String,
    created_at: Option<String>,
    input_media_path: Option<String>,
    duration_sec: Option<f64>,
    artifact_keys: Vec<String>,
    warnings: Vec<String>,
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
    rows.map(|r| r.map_err(|e| redact_user_home_in_text(&e.to_string())))
        .collect()
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
    rows.map(|r| r.map_err(|e| redact_user_home_in_text(&e.to_string())))
        .collect()
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
    rows.map(|r| r.map_err(|e| redact_user_home_in_text(&e.to_string())))
        .collect()
}

fn query_words(conn: &Connection) -> Result<Vec<WordRow>, String> {
    let mut stmt = conn
        .prepare("SELECT start_ms, end_ms, token FROM words ORDER BY start_ms LIMIT 100000")
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(WordRow {
                start_ms: row.get(0)?,
                end_ms: row.get(1)?,
                token: row.get(2).ok(),
            })
        })
        .map_err(|e| redact_user_home_in_text(&e.to_string()))?;
    rows.map(|r| r.map_err(|e| redact_user_home_in_text(&e.to_string())))
        .collect()
}

// ─── Lecture manifest ─────────────────────────────────────────────────────────

fn read_manifest_meta(run_dir: &std::path::Path) -> ManifestMeta {
    let fallback = ManifestMeta {
        run_id: run_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "run".into()),
        created_at: None,
        input_media_path: None,
        duration_sec: None,
        artifact_keys: Vec::new(),
        warnings: Vec::new(),
    };
    let manifest_path = run_dir.join("run_manifest.json");
    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(_) => return fallback,
    };
    let v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return fallback,
    };

    let run_id = v
        .get("run_id")
        .and_then(|x| x.as_str())
        .unwrap_or_else(|| {
            run_dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("run")
        })
        .to_string();

    let created_at = v
        .get("created_at")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    let (input_media_path, duration_sec) = if let Some(im) = v.get("input_media") {
        let path = im
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let dur = im.get("duration").and_then(|x| x.as_f64());
        (path, dur)
    } else {
        (None, None)
    };

    let mut artifact_keys: Vec<String> = Vec::new();
    if let Some(art) = v.get("artifacts").and_then(|x| x.as_object()) {
        artifact_keys = art.keys().cloned().collect();
        artifact_keys.sort();
    }

    let warnings: Vec<String> = v
        .get("warnings")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    ManifestMeta {
        run_id,
        created_at,
        input_media_path,
        duration_sec,
        artifact_keys,
        warnings,
    }
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
        for k in sp_speech
            .keys()
            .chain(sp_ipus.keys())
            .chain(sp_pauses.keys())
        {
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
            let avg_p = if n_p > 0 {
                pause_ms as f64 / n_p as f64
            } else {
                0.0
            };
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

fn fmt_timecode(ms: i64) -> String {
    let total_s = ms / 1000;
    let h = total_s / 3600;
    let m = (total_s % 3600) / 60;
    let s = total_s % 60;
    let cs = (ms % 1000) / 10;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}.{cs:02}")
    } else {
        format!("{m}:{s:02}.{cs:02}")
    }
}

fn pct(part: i64, total: i64) -> f64 {
    if total <= 0 {
        0.0
    } else {
        part as f64 / total as f64 * 100.0
    }
}

// ─── SVG : barres horizontales par locuteur ───────────────────────────────────

fn svg_speaker_bars(speakers: &[SpeakerStats], total_ms: i64) -> String {
    if speakers.is_empty() || total_ms <= 0 {
        return String::new();
    }
    // Palette déterministe basée sur l'index
    let palette = [
        "#4299e1", "#48bb78", "#ed8936", "#9f7aea", "#f56565", "#38b2ac", "#ed64a6",
    ];
    let row_h = 22i32;
    let label_w = 100i32;
    let bar_max_w = 380i32;
    let padding = 8i32;
    let height = speakers.len() as i32 * (row_h + 4) + padding * 2;
    let width = label_w + bar_max_w + 80; // +80 pour le texte %

    let mut rows = String::new();
    for (i, sp) in speakers.iter().enumerate() {
        let y = padding + i as i32 * (row_h + 4);
        let ratio = sp.speech_ms as f64 / total_ms as f64;
        let bar_w = (ratio * bar_max_w as f64).round() as i32;
        let color = palette[i % palette.len()];
        let sp_esc = html_escape(&sp.speaker);
        rows.push_str(&format!(
            r##"<text x="{lx}" y="{ty}" fill="#4a5568" font-size="11" text-anchor="end" dominant-baseline="middle">{sp}</text>
<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="3" fill="{color}"/>
<text x="{tx}" y="{ty}" fill="#2d3748" font-size="11" dominant-baseline="middle">{pct:.1}%</text>
"##,
            lx = label_w - 6,
            ty = y + row_h / 2,
            sp = sp_esc,
            bx = label_w,
            by = y,
            bw = bar_w.max(2),
            bh = row_h,
            color = color,
            tx = label_w + bar_w + 6,
            pct = ratio * 100.0,
        ));
    }

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" role="img" aria-label="Temps de parole par locuteur">
{rows}</svg>"##,
        width = width,
        height = height,
        rows = rows,
    )
}

// ─── SVG : histogramme des pauses ────────────────────────────────────────────

fn svg_pause_histogram(histogram: &[(String, usize)]) -> String {
    let max_count = histogram.iter().map(|(_, c)| *c).max().unwrap_or(0);
    if max_count == 0 {
        return String::new();
    }
    let bar_w = 44i32;
    let gap = 8i32;
    let chart_h = 100i32;
    let label_h = 36i32;
    let padding_top = 8i32;
    let n = histogram.len() as i32;
    let width = n * (bar_w + gap) + gap;
    let height = chart_h + label_h + padding_top;
    let palette = "#4299e1";

    let mut bars = String::new();
    for (i, (label, count)) in histogram.iter().enumerate() {
        let ratio = *count as f64 / max_count as f64;
        let bar_h = (ratio * chart_h as f64).round() as i32;
        let x = gap + i as i32 * (bar_w + gap);
        let y = padding_top + chart_h - bar_h;
        let label_esc = html_escape(label);
        bars.push_str(&format!(
            r##"<rect x="{x}" y="{y}" width="{bar_w}" height="{bar_h}" rx="2" fill="{color}"/>
<text x="{cx}" y="{cy}" fill="#2d3748" font-size="10" text-anchor="middle" dominant-baseline="middle">{count}</text>
<text x="{cx}" y="{ly}" fill="#718096" font-size="9" text-anchor="middle" dominant-baseline="middle">{label}</text>
"##,
            x = x,
            y = y,
            bar_w = bar_w,
            bar_h = bar_h.max(2),
            color = palette,
            cx = x + bar_w / 2,
            cy = y - 10,
            count = count,
            ly = padding_top + chart_h + label_h / 2,
            label = label_esc,
        ));
    }

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" role="img" aria-label="Distribution des pauses">
{bars}</svg>"##,
        width = width,
        height = height,
        bars = bars,
    )
}

// ─── Génération HTML ─────────────────────────────────────────────────────────

fn build_transcript_html(turns: &[TurnRow], words: &[WordRow]) -> String {
    if turns.is_empty() {
        return "<p class=\"tr-empty\">Aucun tour de parole.</p>".into();
    }

    // Precompute palette by speaker (deterministic)
    let mut speaker_colors: HashMap<&str, &str> = HashMap::new();
    let palette = [
        "#2b6cb0", "#276749", "#c05621", "#553c9a", "#9b2c2c", "#285e61", "#97266d",
    ];
    let mut color_idx = 0usize;

    let mut out = String::new();
    let mut word_cursor = 0usize;

    for turn in turns {
        let sp = turn.speaker.as_str();
        let color = *speaker_colors.entry(sp).or_insert_with(|| {
            let c = palette[color_idx % palette.len()];
            color_idx += 1;
            c
        });

        while word_cursor < words.len() && words[word_cursor].end_ms <= turn.start_ms {
            // advance past words that ended before this turn
            word_cursor += 1;
        }
        let mut wi = word_cursor;
        while wi < words.len() && words[wi].start_ms < turn.end_ms {
            wi += 1;
        }
        let text_content: String = words[word_cursor..wi]
            .iter()
            .filter_map(|w| w.token.as_deref())
            .collect::<Vec<_>>()
            .join(" ");

        let sp_esc = html_escape(sp);
        let tc_start = fmt_timecode(turn.start_ms);
        let tc_end = fmt_timecode(turn.end_ms);

        out.push_str(&format!(
            r#"<div class="tr-turn">
<div class="tr-turn-head">
  <span class="tr-speaker" style="color:{color}">{sp_esc}</span>
  <span class="tr-time">{tc_start} – {tc_end}</span>
</div>
<div class="tr-words">{text}</div>
</div>
"#,
            color = color,
            sp_esc = sp_esc,
            tc_start = tc_start,
            tc_end = tc_end,
            text = if text_content.is_empty() {
                html_escape(&format!("[{} – {}]", tc_start, tc_end))
            } else {
                html_escape(&text_content)
            },
        ));
    }

    out
}

// Rapport HTML : regroupe tout le contexte stats ; découper en structs n’apporte pas de clarté ici.
#[allow(clippy::too_many_arguments)]
fn build_html(
    meta: &ManifestMeta,
    run_dir: &str,
    global: &GlobalStats,
    speakers: &[SpeakerStats],
    pauses: &[PauseRow],
    turns: &[TurnRow],
    words: &[WordRow],
    generated_at: &str,
) -> String {
    let histogram = pause_histogram(pauses);
    let svg_speakers = svg_speaker_bars(speakers, global.total_media_ms);
    let svg_pauses = svg_pause_histogram(&histogram);

    // Speaker rows (table)
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

    let global_silence_pct = pct(global.total_silence_ms, global.total_media_ms);
    let global_speech_pct = pct(global.total_speech_ms, global.total_media_ms);
    let run_dir_esc = html_escape(run_dir);

    // Metadata rows
    let meta_rows = {
        let mut rows = String::new();
        rows.push_str(&format!(
            "<tr><th>Run ID</th><td><code>{}</code></td></tr>",
            html_escape(&meta.run_id)
        ));
        if let Some(ca) = &meta.created_at {
            rows.push_str(&format!(
                "<tr><th>Créé le</th><td>{}</td></tr>",
                html_escape(ca)
            ));
        }
        if let Some(mp) = &meta.input_media_path {
            rows.push_str(&format!(
                "<tr><th>Média</th><td><code>{}</code></td></tr>",
                html_escape(mp)
            ));
        }
        if let Some(dur) = meta.duration_sec {
            rows.push_str(&format!(
                "<tr><th>Durée (manifest)</th><td>{}</td></tr>",
                fmt_ms((dur * 1000.0) as i64)
            ));
        }
        if !meta.artifact_keys.is_empty() {
            rows.push_str(&format!(
                "<tr><th>Artifacts</th><td>{}</td></tr>",
                html_escape(&meta.artifact_keys.join(", "))
            ));
        }
        rows.push_str(&format!(
            "<tr><th>Dossier run</th><td><code>{}</code></td></tr>",
            run_dir_esc
        ));
        rows.push_str(&format!(
            "<tr><th>Rapport généré</th><td>{}</td></tr>",
            html_escape(generated_at)
        ));
        rows
    };

    // Warnings (if any)
    let warnings_html = if meta.warnings.is_empty() {
        String::new()
    } else {
        let items: String = meta
            .warnings
            .iter()
            .map(|w| format!("<li>{}</li>", html_escape(w)))
            .collect();
        format!("<div class=\"warn-box\"><strong>Avertissements</strong><ul>{items}</ul></div>")
    };

    // Transcript HTML
    let transcript_html = build_transcript_html(turns, words);

    format!(
        r##"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Rapport — {run_id_esc}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:#1a202c;background:#f7fafc;padding:32px;max-width:960px;margin:0 auto}}
h1{{font-size:1.5rem;font-weight:700;margin-bottom:4px}}
.meta{{font-size:0.78rem;color:#718096;margin-bottom:16px}}
h2{{font-size:1rem;font-weight:600;margin:28px 0 10px;color:#2d3748;padding-top:4px;border-top:2px solid #e2e8f0}}
nav.toc{{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin-bottom:24px;display:flex;gap:16px;flex-wrap:wrap}}
nav.toc a{{font-size:0.82rem;color:#2b6cb0;text-decoration:none;font-weight:500}}
nav.toc a:hover{{text-decoration:underline}}
.cards{{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px}}
.card{{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;min-width:140px}}
.card-val{{font-size:1.4rem;font-weight:700;color:#2b6cb0}}
.card-label{{font-size:0.72rem;color:#718096;margin-top:2px;text-transform:uppercase;letter-spacing:.04em}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:16px}}
th{{background:#edf2f7;text-align:left;padding:8px 12px;font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em;color:#4a5568}}
td{{padding:7px 12px;border-top:1px solid #e2e8f0;font-size:0.82rem}}
.meta-table th{{width:160px;font-weight:600;color:#4a5568;background:#f7fafc}}
.meta-table td code{{font-size:0.78rem;background:#edf2f7;padding:1px 4px;border-radius:3px}}
.svg-wrap{{margin:12px 0;overflow-x:auto}}
.warn-box{{background:#fff5f5;border:1px solid #fc8181;border-radius:8px;padding:12px;margin-bottom:16px;font-size:0.82rem;color:#c53030}}
.warn-box ul{{margin-top:6px;padding-left:18px}}
.tr-turn{{border-left:3px solid #e2e8f0;padding:8px 12px;margin-bottom:8px;background:#fff;border-radius:0 6px 6px 0}}
.tr-turn-head{{display:flex;gap:12px;align-items:baseline;margin-bottom:4px}}
.tr-speaker{{font-weight:700;font-size:0.82rem;min-width:80px}}
.tr-time{{font-size:0.72rem;color:#718096;font-variant-numeric:tabular-nums;font-family:monospace}}
.tr-words{{font-size:0.88rem;line-height:1.5;color:#2d3748}}
.tr-empty{{color:#718096;font-style:italic;font-size:0.82rem}}
.footer{{margin-top:32px;font-size:0.72rem;color:#a0aec0;text-align:center}}
@media print{{nav.toc{{display:none}}.footer{{page-break-inside:avoid}}}}
</style>
</head>
<body>
<h1>Rapport de transcription</h1>
<p class="meta">Run : <strong>{run_id_esc}</strong></p>

<nav class="toc" aria-label="Table des matières">
  <a href="#sec-meta">Métadonnées</a>
  <a href="#sec-global">Stats globales</a>
  <a href="#sec-speakers">Par locuteur</a>
  <a href="#sec-pauses">Pauses</a>
  <a href="#sec-transcript">Transcript</a>
</nav>

{warnings_html}

<h2 id="sec-meta">Métadonnées du run</h2>
<table class="meta-table">
<tbody>{meta_rows}</tbody>
</table>

<h2 id="sec-global">Statistiques globales</h2>
<div class="cards">
  <div class="card"><div class="card-val">{n_turns}</div><div class="card-label">Tours de parole</div></div>
  <div class="card"><div class="card-val">{n_pauses}</div><div class="card-label">Pauses détectées</div></div>
  <div class="card"><div class="card-val">{n_words}</div><div class="card-label">Mots</div></div>
  <div class="card"><div class="card-val">{total_media}</div><div class="card-label">Durée totale</div></div>
  <div class="card"><div class="card-val">{speech_pct:.0}%</div><div class="card-label">Ratio parole</div></div>
  <div class="card"><div class="card-val">{silence_pct:.0}%</div><div class="card-label">Ratio silence</div></div>
  <div class="card"><div class="card-val">{avg_wpm:.0}</div><div class="card-label">Mots / min</div></div>
</div>

<h2 id="sec-speakers">Temps de parole par locuteur</h2>
<div class="svg-wrap">{svg_speakers}</div>
<table>
<thead><tr>
<th>Locuteur</th><th>Tours</th><th>IPU</th><th>Mots</th><th>Parole</th><th>%</th><th>Mots/min</th><th>Pauses</th><th>Durée pauses</th><th>Pause moy.</th>
</tr></thead>
<tbody>{sp_rows}</tbody>
</table>

<h2 id="sec-pauses">Distribution des pauses</h2>
<div class="svg-wrap">{svg_pauses}</div>

<h2 id="sec-transcript">Transcript complet</h2>
{transcript_html}

<div class="footer">Généré par LingWhistX · whisperx-studio · {generated_at_esc}</div>
</body>
</html>
"##,
        run_id_esc = html_escape(&meta.run_id),
        warnings_html = warnings_html,
        meta_rows = meta_rows,
        n_turns = global.n_turns,
        n_pauses = global.n_pauses,
        n_words = global.n_words,
        total_media = fmt_ms(global.total_media_ms),
        speech_pct = global_speech_pct,
        silence_pct = global_silence_pct,
        avg_wpm = global.avg_words_per_min,
        svg_speakers = svg_speakers,
        sp_rows = sp_rows,
        svg_pauses = svg_pauses,
        transcript_html = transcript_html,
        generated_at_esc = html_escape(generated_at),
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
pub fn open_html_report_for_print(app: tauri::AppHandle, html_path: String) -> Result<(), String> {
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
    let asset_url_str = format!("asset://localhost{}", path.to_string_lossy());
    let url: tauri::Url = asset_url_str.parse::<tauri::Url>().map_err(|e| {
        format!(
            "Invalid asset URL: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    let label = "print-prosody-report";

    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.navigate(url);
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, label, WebviewUrl::CustomProtocol(url.clone()))
        .title("Rapport de transcription — Impression")
        .inner_size(960.0, 800.0)
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

/// Génère un rapport HTML auto-contenu à partir de `events.sqlite` et `run_manifest.json`.
#[tauri::command]
pub fn export_prosody_report(run_dir: String) -> Result<ExportProsodyReportResponse, String> {
    validate_path_string(&run_dir)?;
    let run_dir_path = PathBuf::from(run_dir.trim())
        .canonicalize()
        .map_err(|e| format!("run_dir: {}", redact_user_home_in_text(&e.to_string())))?;

    // Manifest metadata (best-effort)
    let meta = read_manifest_meta(&run_dir_path);

    // Ensure events.sqlite is imported (lazy)
    ensure_events_sqlite_imported(&run_dir_path)?;

    let db_path = run_dir_path.join(EVENTS_DB_FILE);
    let conn = open_events_connection(&db_path)?;

    let turns = query_turns(&conn)?;
    let pauses = query_pauses(&conn)?;
    let ipus = query_ipus(&conn)?;
    let words = query_words(&conn)?;

    let (global, speakers) = compute_stats(&turns, &pauses, &ipus);

    let run_dir_str = run_dir_path.to_string_lossy().to_string();

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

    let html = build_html(
        &meta,
        &run_dir_str,
        &global,
        &speakers,
        &pauses,
        &turns,
        &words,
        &generated_at,
    );

    let output_path = run_dir_path.join(format!("rapport-{file_ts}.html"));
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
    let month_days: [u64; 12] = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
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
