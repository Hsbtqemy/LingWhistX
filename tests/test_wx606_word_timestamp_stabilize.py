"""WX-606 — détection timestamps aberrants vs voisins + lissage optionnel."""

from whisperx.timeline import build_canonical_timeline


def _three_word_segment() -> dict:
    return {
        "segments": [
            {
                "start": 0.0,
                "end": 5.0,
                "text": "a b c",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.2, "score": 0.9},
                    {"word": "b", "start": 0.5, "end": 0.501, "score": 0.9},
                    {"word": "c", "start": 1.0, "end": 1.2, "score": 0.9},
                ],
            }
        ],
    }


def test_off_by_default_no_stabilization_flags() -> None:
    tl = build_canonical_timeline(_three_word_segment())
    for w in tl["words"]:
        fl = w.get("flags") or []
        assert "timestamp_aberrant_vs_neighbors" not in fl
        assert "timestamp_smoothed" not in fl


def test_detect_flags_short_middle_word() -> None:
    tl = build_canonical_timeline(
        _three_word_segment(),
        analysis_config={
            "word_timestamp_stabilize_mode": "detect",
            "word_ts_neighbor_ratio_low": 0.2,
            "word_ts_neighbor_ratio_high": 4.0,
        },
    )
    flags_mid = tl["words"][1].get("flags") or []
    assert "timestamp_aberrant_vs_neighbors" in flags_mid


def test_smooth_adds_smoothed_flag() -> None:
    tl = build_canonical_timeline(
        _three_word_segment(),
        analysis_config={
            "word_timestamp_stabilize_mode": "smooth",
            "word_ts_neighbor_ratio_low": 0.2,
            "word_ts_neighbor_ratio_high": 4.0,
            "word_ts_smooth_max_sec": 0.05,
        },
    )
    smoothed = [w for w in tl["words"] if "timestamp_smoothed" in (w.get("flags") or [])]
    assert smoothed, "expected at least one smoothed word"
    ipus = tl["analysis"]["ipus"]
    assert any(
        "contains_smoothed_timestamps" in (ipu.get("flags") or []) for ipu in ipus
    )


def test_detect_ipu_marks_aberrant() -> None:
    tl = build_canonical_timeline(
        _three_word_segment(),
        analysis_config={"word_timestamp_stabilize_mode": "detect"},
    )
    assert any(
        "contains_aberrant_timestamps" in (ipu.get("flags") or [])
        for ipu in tl["analysis"]["ipus"]
    )
