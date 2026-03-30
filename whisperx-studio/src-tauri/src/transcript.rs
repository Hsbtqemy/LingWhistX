//! Lecture, normalisation et export des segments de transcript (JSON, SRT, VTT, TXT).

use std::path::{Path, PathBuf};

use crate::models::{EditableSegment, ExportCorrectionReport, ExportTimingRules};
use crate::time_utils::now_ms;

fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
}

pub(crate) fn load_segments_from_json(value: &serde_json::Value) -> Vec<EditableSegment> {
    let Some(segments) = value
        .get("segments")
        .and_then(|segments| segments.as_array())
    else {
        return vec![];
    };

    let mut result: Vec<EditableSegment> = segments
        .iter()
        .filter_map(|segment| {
            let start = segment.get("start").and_then(parse_f64)?;
            let end = segment.get("end").and_then(parse_f64)?;
            let text = segment
                .get("text")
                .and_then(|text| text.as_str())
                .unwrap_or_default()
                .to_string();
            let speaker = segment
                .get("speaker")
                .and_then(|speaker| speaker.as_str())
                .map(ToOwned::to_owned);

            Some(EditableSegment {
                start,
                end,
                text,
                speaker,
            })
        })
        .collect();

    // Enrich segments missing speakers using speaker_turns (ordinal fallback).
    let missing_count = result.iter().filter(|s| s.speaker.is_none()).count();
    if missing_count > 0 {
        if let Some(turns) = value.get("speaker_turns").and_then(|v| v.as_array()) {
            let turn_speakers: Vec<&str> = turns
                .iter()
                .filter_map(|t| t.get("speaker").and_then(|s| s.as_str()))
                .collect();
            if !turn_speakers.is_empty() {
                // Try temporal matching first, then ordinal fallback
                let turn_intervals: Vec<(f64, f64, &str)> = turns
                    .iter()
                    .filter_map(|t| {
                        let start = t.get("start").and_then(parse_f64)?;
                        let end = t.get("end").and_then(parse_f64)?;
                        let speaker = t.get("speaker").and_then(|s| s.as_str())?;
                        Some((start, end, speaker))
                    })
                    .collect();

                // Detect if segment timestamps are corrupted vs turn timestamps
                let seg_max_end = result.iter().map(|s| s.end).fold(0.0_f64, f64::max);
                let turn_max_end = turn_intervals.iter().map(|t| t.1).fold(0.0_f64, f64::max);
                let timestamps_corrupted = turn_max_end > 0.0 && seg_max_end > turn_max_end * 2.0;

                if timestamps_corrupted {
                    // Ordinal: assign speaker from Nth turn to Nth segment
                    for (i, seg) in result.iter_mut().enumerate() {
                        if seg.speaker.is_none() {
                            if let Some(turn) = turn_intervals.get(i % turn_intervals.len()) {
                                seg.speaker = Some(turn.2.to_owned());
                            }
                        }
                    }
                } else {
                    // Temporal: find best overlapping turn for each segment
                    for seg in result.iter_mut() {
                        if seg.speaker.is_some() {
                            continue;
                        }
                        let seg_mid = (seg.start + seg.end) / 2.0;
                        let mut best_speaker: Option<&str> = None;
                        let mut best_overlap = 0.0_f64;
                        for &(ts, te, sp) in &turn_intervals {
                            let overlap_start = seg.start.max(ts);
                            let overlap_end = seg.end.min(te);
                            let overlap = (overlap_end - overlap_start).max(0.0);
                            if overlap > best_overlap {
                                best_overlap = overlap;
                                best_speaker = Some(sp);
                            }
                        }
                        if best_speaker.is_none() {
                            // Nearest turn by midpoint
                            let mut min_dist = f64::MAX;
                            for &(ts, te, sp) in &turn_intervals {
                                let turn_mid = (ts + te) / 2.0;
                                let dist = (seg_mid - turn_mid).abs();
                                if dist < min_dist {
                                    min_dist = dist;
                                    best_speaker = Some(sp);
                                }
                            }
                        }
                        if let Some(sp) = best_speaker {
                            seg.speaker = Some(sp.to_owned());
                        }
                    }
                }
            }
        }
    }

    result
}

fn normalize_segments(segments: &[EditableSegment]) -> Vec<EditableSegment> {
    segments
        .iter()
        .map(|segment| {
            let mut start = segment.start;
            let mut end = segment.end;
            if start.is_nan() || !start.is_finite() {
                start = 0.0;
            }
            if end.is_nan() || !end.is_finite() {
                end = start;
            }
            if end < start {
                std::mem::swap(&mut start, &mut end);
            }
            EditableSegment {
                start: (start * 1000.0).round() / 1000.0,
                end: (end * 1000.0).round() / 1000.0,
                text: segment.text.clone(),
                speaker: segment.speaker.clone(),
            }
        })
        .collect()
}

fn normalized_export_rules(rules: Option<&ExportTimingRules>) -> (f64, f64, bool) {
    let min_duration_sec = rules
        .and_then(|r| r.min_duration_sec)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.clamp(0.001, 10.0))
        .unwrap_or(0.02);
    let min_gap_sec = rules
        .and_then(|r| r.min_gap_sec)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value.clamp(0.0, 10.0))
        .unwrap_or(0.0);
    let fix_overlaps = rules.and_then(|r| r.fix_overlaps).unwrap_or(true);
    (min_duration_sec, min_gap_sec, fix_overlaps)
}

pub(crate) fn apply_export_timing_rules(
    segments: &[EditableSegment],
    rules: Option<&ExportTimingRules>,
) -> (Vec<EditableSegment>, ExportCorrectionReport) {
    let (min_duration_sec, min_gap_sec, fix_overlaps) = normalized_export_rules(rules);
    let mut normalized = normalize_segments(segments);
    let input_segments = segments.len();

    let was_sorted = normalized.windows(2).all(|pair| {
        let left = &pair[0];
        let right = &pair[1];
        (left.start < right.start)
            || ((left.start - right.start).abs() < f64::EPSILON && left.end <= right.end)
    });
    if !was_sorted {
        normalized.sort_by(|a, b| {
            a.start
                .partial_cmp(&b.start)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    a.end
                        .partial_cmp(&b.end)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
        });
    }

    let mut overlaps_fixed: u32 = 0;
    let mut min_gap_adjustments: u32 = 0;
    let mut min_duration_adjustments: u32 = 0;

    let mut adjusted: Vec<EditableSegment> = Vec::with_capacity(normalized.len());
    let mut previous_end = 0.0f64;
    for (idx, mut segment) in normalized.into_iter().enumerate() {
        if idx == 0 {
            if segment.start < 0.0 {
                segment.start = 0.0;
            }
        } else {
            if fix_overlaps && segment.start < previous_end {
                segment.start = previous_end;
                overlaps_fixed += 1;
            }
            let required_start = previous_end + min_gap_sec;
            if segment.start < required_start {
                segment.start = required_start;
                min_gap_adjustments += 1;
            }
        }

        let min_end = segment.start + min_duration_sec;
        if segment.end < min_end {
            segment.end = min_end;
            min_duration_adjustments += 1;
        }

        segment.start = (segment.start * 1000.0).round() / 1000.0;
        segment.end = (segment.end * 1000.0).round() / 1000.0;
        previous_end = segment.end;
        adjusted.push(segment);
    }

    let mut notes: Vec<String> = Vec::new();
    if !was_sorted {
        notes.push("Segments were reordered by timestamp before export.".into());
    }
    if overlaps_fixed > 0 {
        notes.push(format!("Fixed {overlaps_fixed} overlap(s)."));
    }
    if min_gap_adjustments > 0 {
        notes.push(format!(
            "Applied min-gap adjustments to {min_gap_adjustments} segment(s)."
        ));
    }
    if min_duration_adjustments > 0 {
        notes.push(format!(
            "Extended {min_duration_adjustments} segment(s) to min duration."
        ));
    }
    if notes.is_empty() {
        notes.push("No timing correction needed.".into());
    }

    let report = ExportCorrectionReport {
        input_segments,
        output_segments: adjusted.len(),
        min_duration_sec,
        min_gap_sec,
        fix_overlaps,
        reordered_segments: !was_sorted,
        overlaps_fixed,
        min_gap_adjustments,
        min_duration_adjustments,
        total_adjustments: overlaps_fixed + min_gap_adjustments + min_duration_adjustments,
        notes,
    };
    (adjusted, report)
}

pub(crate) fn build_transcript_json(
    language: Option<String>,
    segments: &[EditableSegment],
) -> serde_json::Value {
    let normalized_segments = normalize_segments(segments);
    let segment_values = normalized_segments
        .iter()
        .map(|segment| {
            let mut map = serde_json::Map::new();
            map.insert("start".into(), serde_json::json!(segment.start));
            map.insert("end".into(), serde_json::json!(segment.end));
            map.insert("text".into(), serde_json::json!(segment.text));
            if let Some(speaker) = &segment.speaker {
                if !speaker.trim().is_empty() {
                    map.insert("speaker".into(), serde_json::json!(speaker));
                }
            }
            serde_json::Value::Object(map)
        })
        .collect::<Vec<serde_json::Value>>();

    let mut root = serde_json::Map::new();
    if let Some(lang) = language {
        if !lang.trim().is_empty() {
            root.insert("language".into(), serde_json::json!(lang.trim()));
        }
    }
    root.insert("segments".into(), serde_json::Value::Array(segment_values));
    root.insert("editedBy".into(), serde_json::json!("whisperx-studio"));
    serde_json::Value::Object(root)
}

pub(crate) fn edited_path_with_ext(source_path: &Path, extension_without_dot: &str) -> PathBuf {
    let parent = source_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = source_path
        .file_stem()
        .and_then(|raw| raw.to_str())
        .unwrap_or("transcript");
    let base = if stem.ends_with(".edited") {
        stem.to_string()
    } else {
        format!("{stem}.edited")
    };
    parent.join(format!("{base}.{extension_without_dot}"))
}

pub(crate) fn draft_path_for_source(source_path: &Path) -> PathBuf {
    let parent = source_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = source_path
        .file_stem()
        .and_then(|raw| raw.to_str())
        .unwrap_or("transcript");
    let base = if stem.ends_with(".draft") {
        stem.to_string()
    } else {
        format!("{stem}.draft")
    };
    parent.join(format!("{base}.json"))
}

pub(crate) fn build_transcript_draft_json(
    source_path: &Path,
    language: Option<String>,
    segments: &[EditableSegment],
) -> serde_json::Value {
    let mut payload = build_transcript_json(language, segments);
    if let serde_json::Value::Object(ref mut root) = payload {
        root.insert("draft".into(), serde_json::json!(true));
        root.insert(
            "sourcePath".into(),
            serde_json::json!(source_path.to_string_lossy().to_string()),
        );
        root.insert("autosavedAtMs".into(), serde_json::json!(now_ms()));
    }
    payload
}

fn format_timestamp(seconds: f64, decimal_marker: char) -> String {
    let mut total_ms = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = total_ms / 3_600_000;
    total_ms -= hours * 3_600_000;
    let minutes = total_ms / 60_000;
    total_ms -= minutes * 60_000;
    let secs = total_ms / 1_000;
    total_ms -= secs * 1_000;
    format!("{hours:02}:{minutes:02}:{secs:02}{decimal_marker}{total_ms:03}")
}

pub(crate) fn to_srt_text(segments: &[EditableSegment]) -> String {
    let normalized = normalize_segments(segments);
    let mut out = String::new();
    for (index, segment) in normalized.iter().enumerate() {
        let start = format_timestamp(segment.start, ',');
        let end = format_timestamp(segment.end, ',');
        let text = if let Some(speaker) = &segment.speaker {
            if speaker.trim().is_empty() {
                segment.text.clone()
            } else {
                format!("[{speaker}] {}", segment.text)
            }
        } else {
            segment.text.clone()
        };

        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            index + 1,
            start,
            end,
            text.replace("-->", "->")
        ));
    }
    out
}

pub(crate) fn to_vtt_text(segments: &[EditableSegment]) -> String {
    let normalized = normalize_segments(segments);
    let mut out = String::from("WEBVTT\n\n");
    for segment in &normalized {
        let start = format_timestamp(segment.start, '.');
        let end = format_timestamp(segment.end, '.');
        let text = if let Some(speaker) = &segment.speaker {
            if speaker.trim().is_empty() {
                segment.text.clone()
            } else {
                format!("[{speaker}] {}", segment.text)
            }
        } else {
            segment.text.clone()
        };
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            start,
            end,
            text.replace("-->", "->")
        ));
    }
    out
}

pub(crate) fn to_txt_text(segments: &[EditableSegment]) -> String {
    let normalized = normalize_segments(segments);
    let mut out = String::new();
    for segment in &normalized {
        let line = if let Some(speaker) = &segment.speaker {
            if speaker.trim().is_empty() {
                segment.text.clone()
            } else {
                format!("[{speaker}] {}", segment.text)
            }
        } else {
            segment.text.clone()
        };
        out.push_str(line.trim());
        out.push('\n');
    }
    out
}

fn csv_escape_cell(value: &str) -> String {
    let needs_quote =
        value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r');
    if needs_quote {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub(crate) fn to_csv_text(segments: &[EditableSegment]) -> String {
    let normalized = normalize_segments(segments);
    let mut out = String::from("start_sec,end_sec,text,speaker\n");
    for segment in &normalized {
        let sp = segment.speaker.as_deref().unwrap_or("");
        out.push_str(&format!(
            "{:.6},{},{},{}\n",
            segment.start,
            segment.end,
            csv_escape_cell(&segment.text),
            csv_escape_cell(sp)
        ));
    }
    out
}

// ─── WX-670 : Annotation exports (TextGrid / ELAN EAF) ───────────────────────

/// Convert days since Unix epoch (1970-01-01) to (year, month, day).
fn epoch_days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    // Algorithm: Gregorian calendar from epoch days
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

fn escape_textgrid_label(s: &str) -> String {
    s.replace('"', "\"\"")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Group segments by speaker (preserving original order within each speaker).
fn group_by_speaker(segments: &[EditableSegment]) -> Vec<(String, Vec<&EditableSegment>)> {
    let mut order: Vec<String> = Vec::new();
    let mut map: std::collections::HashMap<String, Vec<&EditableSegment>> =
        std::collections::HashMap::new();
    for seg in segments {
        let sp = seg.speaker.as_deref().unwrap_or("unknown").to_string();
        if !map.contains_key(&sp) {
            order.push(sp.clone());
        }
        map.entry(sp).or_default().push(seg);
    }
    let mut ordered = order;
    ordered.sort();
    ordered
        .into_iter()
        .map(|sp| {
            let mut segs = map.remove(&sp).unwrap_or_default();
            segs.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
            (sp, segs)
        })
        .collect()
}

/// Build a gapless interval list (xmin, xmax, text) for one speaker over [0, xmax].
fn build_intervals(segs: &[&EditableSegment], xmax: f64) -> Vec<(f64, f64, String)> {
    let mut result = Vec::new();
    let mut cursor: f64 = 0.0;
    for seg in segs {
        let s = seg.start.max(0.0);
        let e = seg.end.min(xmax);
        if s > cursor + 1e-6 {
            result.push((cursor, s, String::new()));
        }
        result.push((s, e, seg.text.trim().to_string()));
        cursor = e;
    }
    if cursor < xmax - 1e-6 {
        result.push((cursor, xmax, String::new()));
    }
    if result.is_empty() {
        result.push((0.0, xmax, String::new()));
    }
    result
}

pub(crate) fn to_textgrid_text(segments: &[EditableSegment]) -> String {
    let xmax = segments
        .iter()
        .map(|s| s.end)
        .fold(1.0_f64, f64::max);

    let by_speaker = group_by_speaker(segments);
    let n_tiers = by_speaker.len();

    let mut out = format!(
        "File type = \"ooTextFile\"\nObject class = \"TextGrid\"\n\nxmin = 0\nxmax = {xmax:.6}\ntiers? <exists>\nsize = {n_tiers}\nitem []:\n"
    );
    for (tier_idx, (sp, segs)) in by_speaker.iter().enumerate() {
        let intervals = build_intervals(segs, xmax);
        let n_intervals = intervals.len();
        let tier_name = escape_textgrid_label(sp);
        out.push_str(&format!(
            "    item [{idx}]:\n        class = \"IntervalTier\"\n        name = \"{tier_name}\"\n        xmin = 0\n        xmax = {xmax:.6}\n        intervals: size = {n_intervals}\n",
            idx = tier_idx + 1,
        ));
        for (i, (imin, imax, text)) in intervals.iter().enumerate() {
            let label = escape_textgrid_label(text);
            out.push_str(&format!(
                "        intervals [{i}]:\n            xmin = {imin:.6}\n            xmax = {imax:.6}\n            text = \"{label}\"\n",
                i = i + 1,
            ));
        }
    }
    out
}

pub(crate) fn to_eaf_text(segments: &[EditableSegment]) -> String {
    let xmax = segments
        .iter()
        .map(|s| s.end)
        .fold(1.0_f64, f64::max);

    let by_speaker = group_by_speaker(segments);

    // Collect all unique time values (ms)
    let mut times_ms: Vec<u64> = vec![0, (xmax * 1000.0).round() as u64];
    for seg in segments {
        times_ms.push((seg.start * 1000.0).round() as u64);
        times_ms.push((seg.end * 1000.0).round() as u64);
    }
    times_ms.sort_unstable();
    times_ms.dedup();
    let slot_by_ms: std::collections::HashMap<u64, String> = times_ms
        .iter()
        .enumerate()
        .map(|(idx, &ms)| (ms, format!("ts{idx}")))
        .collect();

    let slot_id = |ms: u64| slot_by_ms.get(&ms).cloned().unwrap_or_default();

    // ISO-8601 UTC timestamp without chrono dependency
    let now = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let s = secs % 60;
        let m = (secs / 60) % 60;
        let h = (secs / 3600) % 24;
        let days = secs / 86400;
        // Approximate Gregorian date from epoch days
        let (y, mo, d) = epoch_days_to_ymd(days);
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}+00:00")
    };

    let header_slots: String = times_ms
        .iter()
        .map(|&ms| {
            format!(
                "      <TIME_SLOT TIME_SLOT_ID=\"{}\" TIME_VALUE=\"{}\"/>\n",
                slot_id(ms),
                ms
            )
        })
        .collect();

    let mut tiers_xml = String::new();
    let mut ann_counter: usize = 0;
    for (sp, segs) in &by_speaker {
        let tier_id = xml_escape(sp);
        let mut anns = String::new();
        for seg in segs {
            let s_ms = (seg.start * 1000.0).round() as u64;
            let e_ms = (seg.end * 1000.0).round() as u64;
            let val = xml_escape(seg.text.trim());
            anns.push_str(&format!(
                "    <ANNOTATION>\n      <ALIGNABLE_ANNOTATION ANNOTATION_ID=\"a{ann_counter}\" TIME_SLOT_REF1=\"{ts1}\" TIME_SLOT_REF2=\"{ts2}\">\n        <ANNOTATION_VALUE>{val}</ANNOTATION_VALUE>\n      </ALIGNABLE_ANNOTATION>\n    </ANNOTATION>\n",
                ts1 = slot_id(s_ms),
                ts2 = slot_id(e_ms),
            ));
            ann_counter += 1;
        }
        tiers_xml.push_str(&format!(
            "  <TIER TIER_ID=\"{tier_id}\" LINGUISTIC_TYPE_REF=\"lt-speaker\">\n{anns}  </TIER>\n"
        ));
    }

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<ANNOTATION_DOCUMENT AUTHOR=\"whisperx\" DATE=\"{now}\" VERSION=\"0\" FORMAT=\"3.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n\
  <HEADER TIME_UNITS=\"milliseconds\">\n\
    <TIME_ORDER>\n\
{header_slots}\
    </TIME_ORDER>\n\
  </HEADER>\n\
{tiers_xml}\
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID=\"lt-speaker\" TIME_ALIGNABLE=\"true\"/>\n\
</ANNOTATION_DOCUMENT>\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EditableSegment;

    fn seg(start: f64, end: f64, text: &str) -> EditableSegment {
        EditableSegment {
            start,
            end,
            text: text.into(),
            speaker: None,
        }
    }

    #[test]
    fn normalize_segments_swaps_inverted_bounds() {
        let out = normalize_segments(&[seg(5.0, 1.0, "a")]);
        assert_eq!(out.len(), 1);
        assert!(out[0].start <= out[0].end);
        assert!((out[0].start - 1.0).abs() < 0.001);
        assert!((out[0].end - 5.0).abs() < 0.001);
    }

    #[test]
    fn apply_export_fixes_overlap() {
        let segments = vec![seg(0.0, 2.0, "a"), seg(1.0, 3.0, "b")];
        let (fixed, report) = apply_export_timing_rules(&segments, None);
        assert!(fixed[1].start >= fixed[0].end);
        assert!(report.overlaps_fixed >= 1);
    }

    #[test]
    fn to_txt_joins_lines() {
        let t = to_txt_text(&[seg(0.0, 1.0, "hello"), seg(1.0, 2.0, "world")]);
        assert!(t.contains("hello"));
        assert!(t.contains("world"));
    }
}
