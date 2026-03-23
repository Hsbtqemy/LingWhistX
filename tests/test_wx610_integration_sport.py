"""
WX-610 — Scénario type « plateau sportif » : deux locuteurs, chevauchement, pauses serrées.

- Test principal (sans marqueur) : timeline synthétique, déterministe, pas d’audio.
- Test marqué ``integration`` : même assertions pour la suite ``pytest -m integration``.

Les seuils ci-dessous documentent des invariants WX-601/WX-602 (stats vs stats_clean).
Pour un E2E audio réel, voir ``tests/test_pipeline_e2e_real_audio.py`` et ``WHISPERX_RUN_AUDIO_E2E=1``.
"""

from __future__ import annotations

import pytest

from whisperx.timeline import build_canonical_timeline

# Configuration d’analyse « parole dense + bruit court » (style commentaire sportif)
_SPORT_ANALYSIS = {
    "pause_min": 0.15,
    "pause_ignore_below": 0.12,
    "pause_max": None,
    "include_nonspeech": True,
    "nonspeech_min_duration": 0.12,
    "ipu_min_words": 1,
    "ipu_min_duration": 0.0,
    "ipu_bridge_short_gaps_under": 0.25,
}


def _sport_style_two_speakers_overlap_fixture() -> dict:
    """
    Deux segments (commentateurs), tours qui se chevauchent (0.5 s), mots étiquetés par locuteur.
    Simule un duel verbal rapide sans fichier média lourd.
    """
    return {
        "segments": [
            {
                "start": 0.0,
                "end": 12.0,
                "text": "a",
                "speaker": "C_A",
                "words": [
                    {"word": "and", "start": 0.2, "end": 0.35, "score": 0.9, "speaker": "C_A"},
                    {"word": "its", "start": 0.4, "end": 0.55, "score": 0.9, "speaker": "C_A"},
                    {"word": "in", "start": 0.7, "end": 0.85, "score": 0.88, "speaker": "C_A"},
                    {"word": "the", "start": 1.0, "end": 1.15, "score": 0.9, "speaker": "C_A"},
                    {"word": "net", "start": 1.2, "end": 1.45, "score": 0.92, "speaker": "C_A"},
                    {"word": "what", "start": 4.0, "end": 4.25, "score": 0.9, "speaker": "C_A"},
                    {"word": "a", "start": 4.3, "end": 4.4, "score": 0.9, "speaker": "C_A"},
                    {"word": "shot", "start": 4.45, "end": 4.8, "score": 0.91, "speaker": "C_A"},
                ],
            },
            {
                "start": 3.5,
                "end": 12.0,
                "text": "b",
                "speaker": "C_B",
                "words": [
                    {"word": "unbelievable", "start": 3.6, "end": 4.1, "score": 0.87, "speaker": "C_B"},
                    {"word": "pace", "start": 4.15, "end": 4.45, "score": 0.89, "speaker": "C_B"},
                    {"word": "here", "start": 4.5, "end": 4.75, "score": 0.9, "speaker": "C_B"},
                    {"word": "from", "start": 6.0, "end": 6.2, "score": 0.9, "speaker": "C_B"},
                    {"word": "the", "start": 6.25, "end": 6.4, "score": 0.9, "speaker": "C_B"},
                    {"word": "wing", "start": 6.45, "end": 6.8, "score": 0.91, "speaker": "C_B"},
                ],
            },
        ],
        "speaker_turns": [
            {"speaker": "C_A", "start": 0.0, "end": 5.5},
            {"speaker": "C_B", "start": 5.0, "end": 12.0},
        ],
    }


def _assert_sport_metrics_stable(tl: dict) -> None:
    """Invariants documentés (WX-601 / WX-602)."""
    analysis = tl["analysis"]
    st = analysis["stats"]
    sc = analysis["stats_clean"]

    assert st["overlaps"]["n_zones"] >= 1, "scenario sportif attend au moins une zone d’overlap"
    assert st["interaction"]["overlap_time_ratio"] > 0.0

    assert sc["pauses"]["n"] <= st["pauses"]["n"]
    assert sc["ipus"]["n"] <= st["ipus"]["n"]

    n_words_st = sum(v.get("n_words", 0) for v in st["speakers"].values())
    n_words_sc = sum(v.get("n_words", 0) for v in sc["speakers"].values())
    assert n_words_sc <= n_words_st

    for key in ("stats", "stats_clean"):
        inter = analysis[key]["interaction"]
        assert inter["n_transitions"] >= 1
        assert 0.0 <= inter["overlap_time_ratio"] <= 1.0

    # Seuils figés sur la fixture (régression si logique timeline change sans migration)
    assert st["overlaps"]["n_zones"] == 1
    assert st["pauses"]["n"] >= 3


def test_wx610_sport_style_synthetic_timeline_metrics() -> None:
    """Exécuté par la CI par défaut (pas de marqueur integration)."""
    result = _sport_style_two_speakers_overlap_fixture()
    tl = build_canonical_timeline(result, analysis_config=_SPORT_ANALYSIS)
    _assert_sport_metrics_stable(tl)


@pytest.mark.integration
def test_wx610_sport_style_synthetic_timeline_metrics_integration_suite() -> None:
    """Même scénario pour ``pytest -m integration`` (WX-610 backlog)."""
    result = _sport_style_two_speakers_overlap_fixture()
    tl = build_canonical_timeline(result, analysis_config=_SPORT_ANALYSIS)
    _assert_sport_metrics_stable(tl)
