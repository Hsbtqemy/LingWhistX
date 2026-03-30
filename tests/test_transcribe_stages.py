"""
WX-684 — Tests unitaires pour les fonctions pures de pipeline_stages.py.

N'importe pas torch ni whisperx.transcribe.
Fonctionne avec le Python système (3.13+) sans venv.
"""

from __future__ import annotations

import pytest
from whisperx.pipeline_stages import (
    build_asr_options,
    build_temperature_sequence,
    postprocess_words,
)


# ─── build_temperature_sequence ──────────────────────────────────────────────


class TestBuildTemperatureSequence:
    def test_no_increment_returns_single_element_list(self):
        temps = build_temperature_sequence(0.0, None)
        assert list(temps) == [0.0]

    def test_no_increment_preserves_value(self):
        temps = build_temperature_sequence(0.5, None)
        assert list(temps) == [0.5]

    def test_with_increment_covers_range(self):
        temps = list(build_temperature_sequence(0.0, 0.2))
        assert len(temps) >= 5
        assert temps[0] == pytest.approx(0.0)
        assert temps[-1] == pytest.approx(1.0, abs=0.01)

    def test_with_increment_strictly_increasing(self):
        temps = list(build_temperature_sequence(0.0, 0.2))
        assert all(a < b for a, b in zip(temps, temps[1:]))

    def test_increment_zero_point_four(self):
        temps = list(build_temperature_sequence(0.0, 0.4))
        # 0.0, 0.4, 0.8, 1.0+eps → 3 ou 4 valeurs selon arrondi
        assert len(temps) >= 3

    def test_no_increment_returns_list(self):
        temps = build_temperature_sequence(0.0, None)
        assert isinstance(temps, list)

    def test_with_increment_returns_tuple(self):
        temps = build_temperature_sequence(0.0, 0.2)
        assert isinstance(temps, tuple)


# ─── build_asr_options ───────────────────────────────────────────────────────

_BASE: dict = dict(
    beam_size=5,
    best_of=7,
    patience=1.0,
    length_penalty=1.0,
    temperatures=[0.0],
    compression_ratio_threshold=2.4,
    log_prob_threshold=-1.0,
    no_speech_threshold=0.6,
    condition_on_previous_text=True,
    initial_prompt=None,
    hotwords=None,
    suppress_tokens_str="-1",
    suppress_numerals=False,
)


class TestBuildAsrOptions:
    def test_returns_expected_keys(self):
        opts = build_asr_options(**_BASE)
        required = {
            "beam_size", "best_of", "patience", "length_penalty", "temperatures",
            "compression_ratio_threshold", "log_prob_threshold", "no_speech_threshold",
            "condition_on_previous_text", "initial_prompt", "hotwords",
            "suppress_tokens", "suppress_numerals",
        }
        assert required.issubset(opts.keys())

    def test_scalar_values_forwarded(self):
        opts = build_asr_options(**_BASE)
        assert opts["beam_size"] == 5
        assert opts["best_of"] == 7
        assert opts["patience"] == pytest.approx(1.0)
        assert opts["temperatures"] == [0.0]

    def test_suppress_tokens_single(self):
        opts = build_asr_options(**_BASE)
        assert opts["suppress_tokens"] == [-1]

    def test_suppress_tokens_multiple(self):
        opts = build_asr_options(**{**_BASE, "suppress_tokens_str": "-1,1,2,50257"})
        assert opts["suppress_tokens"] == [-1, 1, 2, 50257]

    def test_suppress_numerals_forwarded(self):
        opts = build_asr_options(**{**_BASE, "suppress_numerals": True})
        assert opts["suppress_numerals"] is True

    def test_initial_prompt_forwarded(self):
        opts = build_asr_options(**{**_BASE, "initial_prompt": "Locuteur A:"})
        assert opts["initial_prompt"] == "Locuteur A:"

    def test_hotwords_forwarded(self):
        opts = build_asr_options(**{**_BASE, "hotwords": "bonjour,merci"})
        assert opts["hotwords"] == "bonjour,merci"

    def test_condition_on_previous_text_false(self):
        opts = build_asr_options(**{**_BASE, "condition_on_previous_text": False})
        assert opts["condition_on_previous_text"] is False


# ─── postprocess_words ───────────────────────────────────────────────────────


class TestPostprocessWords:
    def test_noop_when_word_segments_present(self):
        ws = [{"word": "bonjour", "start": 0.0, "end": 1.0}]
        result = {"segments": [], "word_segments": ws, "language": "fr"}
        out = postprocess_words(result)
        assert out["word_segments"] is ws

    def test_builds_from_segment_words(self):
        result = {
            "segments": [
                {
                    "start": 0.0, "end": 1.0, "text": "bonjour monde",
                    "words": [
                        {"word": "bonjour", "start": 0.0, "end": 0.5},
                        {"word": "monde", "start": 0.5, "end": 1.0},
                    ],
                }
            ],
            "language": "fr",
        }
        out = postprocess_words(result)
        assert len(out["word_segments"]) == 2
        assert out["word_segments"][0]["word"] == "bonjour"
        assert out["word_segments"][1]["word"] == "monde"

    def test_empty_segments_gives_empty_word_segments(self):
        result: dict = {"segments": [], "language": "en"}
        out = postprocess_words(result)
        assert out["word_segments"] == []

    def test_segments_without_words_gives_empty(self):
        result = {
            "segments": [{"start": 0.0, "end": 1.0, "text": "hello"}],
            "language": "en",
        }
        out = postprocess_words(result)
        assert out["word_segments"] == []

    def test_does_not_mutate_input(self):
        result: dict = {"segments": [], "language": "en"}
        postprocess_words(result)
        assert "word_segments" not in result

    def test_idempotent(self):
        ws = [{"word": "test"}]
        result = {"segments": [], "word_segments": ws, "language": "en"}
        out1 = postprocess_words(result)
        out2 = postprocess_words(out1)
        assert out2["word_segments"] == ws

    def test_multiline_segments(self):
        result = {
            "segments": [
                {"start": 0.0, "end": 0.5, "text": "a", "words": [{"word": "a", "start": 0.0, "end": 0.5}]},
                {"start": 0.5, "end": 1.0, "text": "b", "words": [{"word": "b", "start": 0.5, "end": 1.0}]},
            ],
            "language": "en",
        }
        out = postprocess_words(result)
        assert len(out["word_segments"]) == 2
        assert out["word_segments"][1]["word"] == "b"
