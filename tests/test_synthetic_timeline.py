"""Timeline synthétique sans audio (WX-506)."""

from whisperx.timeline import build_canonical_timeline


def test_one_speaker_pause_thresholds() -> None:
    """Pauses 0.10 / 0.15 / 0.50 vs seuils min 0.15, ignore 0.12."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 10.0,
                "text": "t",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.5, "score": 0.9},
                    {"word": "b", "start": 0.62, "end": 0.7, "score": 0.9},
                    {"word": "c", "start": 0.85, "end": 1.0, "score": 0.9},
                    {"word": "d", "start": 1.5, "end": 2.0, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(
        result,
        analysis_config={"pause_min": 0.15, "pause_ignore_below": 0.12},
    )
    pauses = tl["analysis"]["pauses"]
    types = {p["type"] for p in pauses}
    assert "intra_speaker_word_gap" in types


def test_two_speakers_alternate_zero_word_gap() -> None:
    """Enchaînement A puis B sans trou entre mots : pas de transition_gap ni pause intra."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "a",
                "speaker": "SPEAKER_00",
                "words": [{"word": "a", "start": 0.0, "end": 1.0, "score": 0.9}],
            },
            {
                "start": 1.0,
                "end": 2.0,
                "text": "b",
                "speaker": "SPEAKER_01",
                "words": [{"word": "b", "start": 1.0, "end": 2.0, "score": 0.9}],
            },
        ],
    }
    tl = build_canonical_timeline(result, analysis_config={"pause_min": 0.15, "pause_ignore_below": 0.12})
    trans_types = {p["type"] for p in tl["analysis"]["pauses"]}
    assert "transition_gap" not in trans_types
    assert not any(p["type"] == "intra_speaker_word_gap" for p in tl["analysis"]["pauses"])
    assert tl["analysis"]["transitions"]


def test_overlap_speakers_cross_window() -> None:
    """Overlap A fin 1.0, B début 0.9 → zone commune ~0.1."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "a",
                "speaker": "SPEAKER_00",
                "words": [{"word": "a", "start": 0.0, "end": 1.0, "score": 0.9}],
            },
            {
                "start": 0.9,
                "end": 2.0,
                "text": "b",
                "speaker": "SPEAKER_01",
                "words": [{"word": "b", "start": 0.9, "end": 2.0, "score": 0.9}],
            },
        ],
        "speaker_turns": [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
            {"speaker": "SPEAKER_01", "start": 0.9, "end": 2.0},
        ],
    }
    tl = build_canonical_timeline(result)
    ev_overlap = [e for e in tl["events"] if e.get("type") == "overlap"]
    assert ev_overlap


def test_interpolated_word_gets_flag_and_ipu_flag() -> None:
    """Mot sans start explicite : interpolation + IPU contains_interpolated."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 2.0,
                "text": "x",
                "speaker": "S0",
                "words": [
                    {"word": "first", "start": 0.0, "end": 0.2, "score": 0.9},
                    {"word": "gap", "end": 0.5, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(result)
    flags_word = []
    for w in tl["words"]:
        if w.get("token") == "gap":
            flags_word = list(w.get("flags") or [])
    assert "interpolated" in flags_word
    ipus = tl["analysis"]["ipus"]
    assert any(ipu.get("flags") and "contains_interpolated" in ipu["flags"] for ipu in ipus)


def test_missing_alignment_word_skipped_in_stream() -> None:
    """Token vide ignoré — ne casse pas la timeline."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "t",
                "speaker": "S0",
                "words": [
                    {"word": "ok", "start": 0.0, "end": 0.5, "score": 0.9},
                    {"word": "", "start": 0.5, "end": 0.6, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(result)
    assert len(tl["words"]) == 1
    assert tl["words"][0]["token"] == "ok"
