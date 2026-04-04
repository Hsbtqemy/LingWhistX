"""Configuration d'analyse pour build_canonical_timeline — sans dépendre de transcribe/diarize/pyannote.

WX-718 : `import_transcript` (cli) doit pouvoir importer cette fonction sans charger whisperx.transcribe
(qui tire pyannote.audio → torchcodec / FFmpeg au import).
"""

from __future__ import annotations

from typing import Any


def build_timeline_analysis_config(
    *,
    analysis_pause_min: float,
    analysis_pause_ignore_below: float,
    analysis_pause_max: float | None,
    analysis_include_nonspeech: bool,
    analysis_nonspeech_min_duration: float,
    analysis_ipu_min_words: int,
    analysis_ipu_min_duration: float,
    analysis_ipu_bridge_short_gaps_under: float,
    analysis_preset: str | None,
    analysis_calibrate_window_sec: float | None,
    analysis_calibrate_start_sec: float,
    analysis_speaker_turn_postprocess_preset: str | None,
    analysis_speaker_turn_merge_gap_sec_max: float | None,
    analysis_speaker_turn_split_word_gap_sec: float | None,
    wts_mode: str,
    analysis_word_ts_neighbor_ratio_low: float | None,
    analysis_word_ts_neighbor_ratio_high: float | None,
    analysis_word_ts_smooth_max_sec: float | None,
) -> dict[str, Any]:
    """Construit le dict passé à build_canonical_timeline comme analysis_config."""
    timeline_analysis_config: dict[str, Any] = {
        "pause_min": analysis_pause_min,
        "pause_ignore_below": analysis_pause_ignore_below,
        "pause_max": analysis_pause_max,
        "include_nonspeech": analysis_include_nonspeech,
        "nonspeech_min_duration": analysis_nonspeech_min_duration,
        "ipu_min_words": analysis_ipu_min_words,
        "ipu_min_duration": analysis_ipu_min_duration,
        "ipu_bridge_short_gaps_under": analysis_ipu_bridge_short_gaps_under,
    }
    if isinstance(analysis_preset, str) and analysis_preset.strip():
        timeline_analysis_config["analysis_preset"] = analysis_preset.strip()
    if analysis_calibrate_window_sec is not None and analysis_calibrate_window_sec > 0:
        timeline_analysis_config["calibration"] = {
            "window_sec": float(analysis_calibrate_window_sec),
            "start_sec": float(analysis_calibrate_start_sec),
        }
    if analysis_speaker_turn_postprocess_preset:
        timeline_analysis_config["speaker_turn_postprocess_preset"] = analysis_speaker_turn_postprocess_preset
    if analysis_speaker_turn_merge_gap_sec_max is not None:
        timeline_analysis_config["speaker_turn_merge_gap_sec_max"] = float(
            analysis_speaker_turn_merge_gap_sec_max
        )
    if analysis_speaker_turn_split_word_gap_sec is not None:
        timeline_analysis_config["speaker_turn_split_word_gap_sec"] = float(
            analysis_speaker_turn_split_word_gap_sec
        )
    if wts_mode != "off":
        timeline_analysis_config["word_timestamp_stabilize_mode"] = wts_mode
    if analysis_word_ts_neighbor_ratio_low is not None:
        timeline_analysis_config["word_ts_neighbor_ratio_low"] = float(analysis_word_ts_neighbor_ratio_low)
    if analysis_word_ts_neighbor_ratio_high is not None:
        timeline_analysis_config["word_ts_neighbor_ratio_high"] = float(analysis_word_ts_neighbor_ratio_high)
    if analysis_word_ts_smooth_max_sec is not None:
        timeline_analysis_config["word_ts_smooth_max_sec"] = float(analysis_word_ts_smooth_max_sec)
    return timeline_analysis_config
