"""Acceptance WX-503 : pauses typées, transitions, IPU word_ids."""

from whisperx.analysis import build_pauses
from whisperx.timeline import build_canonical_timeline


def test_two_speakers_alternating_no_intra_pause_small_gap():
    """Deux locuteurs enchaînés sans silence > seuil : pas de pause intra ; transitions possibles."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 0.5,
                "text": "a",
                "speaker": "SPEAKER_00",
                "words": [{"word": "a", "start": 0.0, "end": 0.5, "score": 0.9}],
            },
            {
                "start": 0.5,
                "end": 1.0,
                "text": "b",
                "speaker": "SPEAKER_01",
                "words": [{"word": "b", "start": 0.5, "end": 1.0, "score": 0.9}],
            },
        ],
        "speaker_turns": [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5},
            {"speaker": "SPEAKER_01", "start": 0.5, "end": 1.0},
        ],
    }
    tl = build_canonical_timeline(
        result,
        analysis_config={"pause_min": 0.15, "pause_ignore_below": 0.12},
    )
    analysis = tl["analysis"]
    intra = [p for p in analysis["pauses"] if p["type"] == "intra_speaker_word_gap"]
    assert len(intra) == 0
    trans = [p for p in analysis["pauses"] if p["type"] == "transition_gap"]
    assert len(trans) == 0
    for tr in analysis["transitions"]:
        assert "end_prev" in tr and "start_next" in tr


def test_build_pauses_matches_timeline():
    """API analysis.build_pauses cohérente avec la timeline complète."""
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "x",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.2, "score": 0.9},
                    {"word": "b", "start": 0.5, "end": 1.0, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(result, analysis_config={"pause_min": 0.15, "pause_ignore_below": 0.1})
    cfg = tl["analysis"]["config"]
    pauses_api = build_pauses(tl["words"], tl["segments"], cfg)
    assert len(pauses_api) == len(tl["analysis"]["pauses"])


def test_ipu_word_ids_match_n_words():
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "a b",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.4, "score": 0.9},
                    {"word": "b", "start": 0.4, "end": 1.0, "score": 0.9},
                ],
            }
        ],
    }
    tl = build_canonical_timeline(result)
    ipus = tl["analysis"]["ipus"]
    assert ipus
    for ipu in ipus:
        if ipu.get("word_ids"):
            assert len(ipu["word_ids"]) == ipu["n_words"]
