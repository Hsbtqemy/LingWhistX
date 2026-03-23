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

    segments
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
        .collect()
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
