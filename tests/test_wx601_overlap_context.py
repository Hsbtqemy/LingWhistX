"""WX-601 — overlap_context sur pauses/IPU + stats / stats_clean."""

from whisperx.timeline import build_canonical_timeline


def test_pause_in_overlap_zone_gets_overlap_context_flag() -> None:
    """Pause intra-locuteur qui croise [0.9,1.0] (overlap deux tours) est taguée."""
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
    assert tagged, "expected at least one pause overlapping the overlap zone"


def test_stats_clean_excludes_overlap_tagged_pauses_from_counts() -> None:
    """stats_clean.pauses.n <= stats.pauses.n lorsque des pauses sont en overlap."""
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
    st = tl["analysis"]["stats"]
    sc = tl["analysis"]["stats_clean"]
    assert "pauses" in st and "pauses" in sc
    assert sc["pauses"]["n"] <= st["pauses"]["n"]


def test_no_overlap_stats_match_clean() -> None:
    """Sans overlap, effectifs pauses/IPU alignés entre stats et stats_clean."""
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
    st = tl["analysis"]["stats"]
    sc = tl["analysis"]["stats_clean"]
    assert st["pauses"]["n"] == sc["pauses"]["n"]
    assert st["ipus"]["n"] == sc["ipus"]["n"]
    assert st["overlaps"]["n_zones"] == 0
