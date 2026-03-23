"""Tests unitaires — WX-607 import timings mots externes (JSON v1)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from whisperx.external_alignment import (
    ExternalAlignmentError,
    apply_external_word_timings_to_result,
    iter_flat_segment_words,
    load_external_word_timings_json,
    validate_external_word_timings_v1,
)


def _valid_timings(words: list[dict]) -> dict:
    return {
        "schema_version": 1,
        "alignment_source": "mfa",
        "words": words,
    }


def test_validate_rejects_wrong_schema_version():
    with pytest.raises(ExternalAlignmentError, match="schema_version"):
        validate_external_word_timings_v1({"schema_version": 2, "alignment_source": "x", "words": [{"start": 0.0, "end": 0.1}]})


def test_validate_rejects_empty_words():
    with pytest.raises(ExternalAlignmentError, match="words"):
        validate_external_word_timings_v1({"schema_version": 1, "alignment_source": "mfa", "words": []})


def test_validate_rejects_end_before_start():
    with pytest.raises(ExternalAlignmentError, match="end doit"):
        validate_external_word_timings_v1(
            {"schema_version": 1, "alignment_source": "mfa", "words": [{"start": 0.5, "end": 0.1}]}
        )


def test_load_external_word_timings_json_roundtrip():
    data = _valid_timings([{"token": "a", "start": 0.0, "end": 0.1}, {"word": "b", "start": 0.1, "end": 0.2}])
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(data, f)
        path = f.name
    try:
        loaded = load_external_word_timings_json(path)
        assert loaded["alignment_source"] == "mfa"
        assert len(loaded["words"]) == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_apply_count_mismatch_raises():
    result = {
        "segments": [
            {"words": [{"word": "hello", "start": 0.0, "end": 0.1}]},
        ]
    }
    timings = _valid_timings(
        [
            {"start": 0.0, "end": 0.05},
            {"start": 0.05, "end": 0.1},
        ]
    )
    with pytest.raises(ExternalAlignmentError, match="Nombre de mots"):
        apply_external_word_timings_to_result(result, timings, source_path="/tmp/x.json")


def test_apply_updates_timestamps_and_flags():
    result = {
        "segments": [
            {
                "words": [
                    {"word": "hello", "start": 0.0, "end": 0.1},
                    {"word": "world", "start": 0.1, "end": 0.2},
                ]
            },
        ]
    }
    timings = _valid_timings(
        [
            {"token": "hello", "start": 0.05, "end": 0.12},
            {"token": "world", "start": 0.12, "end": 0.25},
        ]
    )
    meta = apply_external_word_timings_to_result(result, timings, source_path="/abs/path.json")
    assert meta["n_words_applied"] == 2
    assert meta["match_mode"] == "index_order"
    assert "external_alignment" in result["segments"][0]["words"][0].get("flags", [])
    assert result["segments"][0]["words"][0]["start"] == 0.05
    assert result["segments"][0]["words"][1]["end"] == 0.25


def test_apply_strict_token_mismatch():
    result = {
        "segments": [
            {"words": [{"word": "hello", "start": 0.0, "end": 0.1}]},
        ]
    }
    timings = _valid_timings([{"token": "goodbye", "start": 0.0, "end": 0.1}])
    with pytest.raises(ExternalAlignmentError, match="Token mismatch"):
        apply_external_word_timings_to_result(
            result, timings, source_path="/x.json", strict_token_match=True
        )


def test_iter_flat_segment_words_order():
    result = {
        "segments": [
            {"words": [{"word": "a"}, {"word": "b"}]},
            {"words": [{"word": "c"}]},
        ]
    }
    flat = iter_flat_segment_words(result)
    assert [w.get("word") for w in flat] == ["a", "b", "c"]
