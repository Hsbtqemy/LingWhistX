"""WX-603 — presets pause et calibration sur fenêtre (gaps intra-locuteur)."""

from whisperx.analysis_calibration import (
    PAUSE_ANALYSIS_PRESETS,
    calibrate_pause_thresholds_from_gaps,
    collect_intra_speaker_gaps,
    prepare_timeline_analysis_config,
    run_pause_calibration,
)
from whisperx.timeline import build_canonical_timeline


def test_quantile_small_gaps_clamped() -> None:
    """Gaps courts (secondes) : quantiles + bornes ignore_below / pause_min."""
    ig, pm, meta = calibrate_pause_thresholds_from_gaps([0.05, 0.08, 0.12, 0.2, 0.35])
    assert 0.04 <= ig <= 0.18
    assert 0.08 <= pm <= 0.55
    assert pm >= ig
    assert meta["n_gaps"] == 5


def test_collect_intra_speaker_gaps_same_speaker() -> None:
    words = [
        {"token": "a", "start": 0.0, "end": 0.1, "speaker": "S0"},
        {"token": "b", "start": 0.5, "end": 0.6, "speaker": "S0"},
        {"token": "c", "start": 1.2, "end": 1.3, "speaker": "S0"},
    ]
    gaps = collect_intra_speaker_gaps(words, 0.0, 2.0)
    assert len(gaps) == 2
    assert abs(gaps[0] - 0.4) < 1e-6
    assert abs(gaps[1] - 0.6) < 1e-6


def test_run_pause_calibration_skipped_short_window() -> None:
    words = [
        {"token": "a", "start": 0.0, "end": 0.1, "speaker": "S0"},
    ]
    meta = run_pause_calibration(words, {"window_sec": 1.0, "start_sec": 0.0})
    assert meta["status"] == "skipped_short_window"


def test_run_pause_calibration_ok_many_gaps() -> None:
    """Fenêtre large + plusieurs gaps intra-locuteur → status ok."""
    words = []
    t = 0.0
    for i in range(8):
        words.append(
            {
                "token": f"w{i}",
                "start": t,
                "end": t + 0.08,
                "score": 0.9,
                "speaker": "S0",
            }
        )
        t += 0.08 + 0.05 + i * 0.02
    meta = run_pause_calibration(words, {"window_sec": 60.0, "start_sec": 0.0})
    assert meta["status"] == "ok"
    assert meta["pause_min"] >= meta["pause_ignore_below"]


def test_prepare_preset_then_normalize_in_timeline() -> None:
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 3.0,
                "text": "x",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.4, "score": 0.9},
                    {"word": "b", "start": 1.0, "end": 1.4, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(result, analysis_config={"analysis_preset": "sport_tv"})
    cfg = tl["analysis"]["config"]
    assert cfg["pause_min"] == PAUSE_ANALYSIS_PRESETS["sport_tv"]["pause_min"]
    assert cfg["pause_ignore_below"] == PAUSE_ANALYSIS_PRESETS["sport_tv"]["pause_ignore_below"]
    assert cfg.get("analysis_preset") == "sport_tv"


def test_prepare_timeline_analysis_config_returns_extras() -> None:
    words = [
        {"token": "a", "start": 0.0, "end": 0.1, "speaker": "S0"},
        {"token": "b", "start": 0.5, "end": 0.6, "speaker": "S0"},
    ]
    base, extras = prepare_timeline_analysis_config({"analysis_preset": "interview"}, words)
    assert extras.get("analysis_preset") == "interview"
    assert base["pause_min"] == PAUSE_ANALYSIS_PRESETS["interview"]["pause_min"]
