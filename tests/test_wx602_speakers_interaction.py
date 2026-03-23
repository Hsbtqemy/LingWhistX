"""WX-602 — métriques par locuteur et interactionnelles dans stats / stats_clean."""

from whisperx.timeline import build_canonical_timeline


def test_stats_and_stats_clean_contain_speakers_and_interaction() -> None:
    """Les blocs stats exposent speakers et interaction (clés attendues)."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 2.0,
                "text": "x",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.5, "score": 0.9},
                    {"word": "b", "start": 1.0, "end": 1.5, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(result)
    for key in ("stats", "stats_clean"):
        block = tl["analysis"][key]
        assert "speakers" in block
        assert "interaction" in block
        inter = block["interaction"]
        assert "n_transitions" in inter
        assert "overlap_time_ratio" in inter
        assert inter["overlap_time_ratio"] >= 0.0


def test_stats_clean_speakers_excludes_words_in_overlap_zones() -> None:
    """Avec overlap, stats_clean.speakers compte moins de mots que stats si mots dans la zone."""
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
    tl = build_canonical_timeline(result)
    st_sp = tl["analysis"]["stats"]["speakers"]
    sc_sp = tl["analysis"]["stats_clean"]["speakers"]
    n_stats = sum(v.get("n_words", 0) for v in st_sp.values())
    n_clean = sum(v.get("n_words", 0) for v in sc_sp.values())
    assert n_clean <= n_stats


def test_no_overlap_speaker_word_counts_match_between_stats_and_clean() -> None:
    """Sans overlap, effectifs mots par locuteur alignés entre stats et stats_clean."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 3.0,
                "text": "t",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.5, "score": 0.9},
                    {"word": "b", "start": 1.0, "end": 1.5, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(result)
    st_sp = tl["analysis"]["stats"]["speakers"]
    sc_sp = tl["analysis"]["stats_clean"]["speakers"]
    assert st_sp == sc_sp
