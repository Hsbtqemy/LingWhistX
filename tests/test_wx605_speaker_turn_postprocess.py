"""WX-605 — post-traitement speaker_turns (fusion / scission)."""

from whisperx.timeline import SPEAKER_TURN_POSTPROCESS_PRESETS, build_canonical_timeline


def test_merge_adjacent_same_speaker_short_gap() -> None:
    """Deux tours A avec petit trou: fusion + flag."""
    result = {
        "speaker_turns": [
            {"speaker": "SPEAKER_A", "start": 0.0, "end": 1.0},
            {"speaker": "SPEAKER_A", "start": 1.05, "end": 2.0},
        ],
        "segments": [],
    }
    tl = build_canonical_timeline(
        result,
        analysis_config={"speaker_turn_merge_gap_sec_max": 0.1},
    )
    turns = tl["speaker_turns"]
    assert len(turns) == 1
    assert turns[0]["speaker"] == "SPEAKER_A"
    assert turns[0]["end"] >= 2.0 - 1e-3
    assert "speaker_turn_merged_adjacent" in (turns[0].get("flags") or [])


def test_split_turn_on_long_word_gap() -> None:
    """Un tour A avec silence > Y entre mots: deux tours."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 5.0,
                "text": "a b",
                "speaker": "A",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.4, "score": 0.9},
                    {"word": "b", "start": 2.0, "end": 2.4, "score": 0.9},
                ],
            }
        ],
        "speaker_turns": [{"speaker": "A", "start": 0.0, "end": 5.0}],
    }
    tl = build_canonical_timeline(
        result,
        analysis_config={"speaker_turn_split_word_gap_sec": 0.5},
    )
    turns = tl["speaker_turns"]
    assert len(turns) == 2
    assert all("speaker_turn_split_word_gap" in (t.get("flags") or []) for t in turns)


def test_sport_duo_preset_sets_thresholds_in_config() -> None:
    """Preset sport_duo: seuils dans analysis.config."""
    result = {
        "segments": [],
        "speaker_turns": [{"speaker": "A", "start": 0.0, "end": 1.0}],
    }
    tl = build_canonical_timeline(
        result,
        analysis_config={"speaker_turn_postprocess_preset": "sport_duo"},
    )
    cfg = tl["analysis"]["config"]
    assert cfg.get("speaker_turn_postprocess_preset") == "sport_duo"
    assert "speaker_turn_merge_gap_sec_max" in cfg
    assert "speaker_turn_split_word_gap_sec" in cfg
    assert cfg["speaker_turn_merge_gap_sec_max"] == SPEAKER_TURN_POSTPROCESS_PRESETS["sport_duo"]["merge_gap_sec_max"]


def test_overlap_scenario_unchanged_without_postprocess_flags() -> None:
    """Sans post-traitement speaker_turn, scénario overlap inchangé (régression WX-601)."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 2.0,
                "text": "x",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.4, "score": 0.9},
                    {"word": "b", "start": 1.1, "end": 1.5, "score": 0.9},
                ],
            }
        ],
        "speaker_turns": [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
            {"speaker": "SPEAKER_01", "start": 0.9, "end": 2.0},
        ],
    }
    tl = build_canonical_timeline(result, analysis_config={"pause_min": 0.15, "pause_ignore_below": 0.12})
    tagged = [p for p in tl["analysis"]["pauses"] if p.get("flags") and "overlap_context" in p["flags"]]
    assert tagged
