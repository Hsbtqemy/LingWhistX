"""Tests merge chunk média (WX-508 / WX-604) — complète test_chunk_merge_regression.py."""

import json
from pathlib import Path

from whisperx.chunk_merge import (
    _offset_and_filter_chunk_segments,
    compute_media_chunk_specs,
    manifest_compatible_with_run,
    new_chunk_manifest,
    read_chunk_manifest,
    write_chunk_manifest,
    write_words_jsonl_for_segments,
)


def test_offset_shifts_words_inside_segments() -> None:
    """Les mots suivent l’offset global du chunk (pas seulement start/end segment)."""
    chunk = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "a",
                "words": [
                    {"word": "hello", "start": 0.1, "end": 0.5, "score": 0.9},
                    {"word": "world", "start": 0.5, "end": 0.9, "score": 0.9},
                ],
            },
        ],
    }
    out = _offset_and_filter_chunk_segments(chunk, chunk_start_sec=50.0, selection_end_sec=None)
    assert len(out) == 1
    w = out[0]["words"]
    assert w[0]["start"] == 50.1
    assert w[0]["end"] == 50.5
    assert w[1]["start"] == 50.5
    assert w[1]["end"] == 50.9
    assert chunk["segments"][0]["words"][0]["start"] == 0.1


def test_chunk_merge_does_not_mutate_source_words() -> None:
    chunk = {
        "segments": [
            {
                "start": 0.0,
                "end": 0.5,
                "words": [{"word": "x", "start": 0.0, "end": 0.4, "score": 0.9}],
            },
        ],
    }
    _offset_and_filter_chunk_segments(chunk, 10.0, None)
    assert chunk["segments"][0]["words"][0]["start"] == 0.0


def test_words_monotonic_after_chunk_merge_simulation() -> None:
    """Deux fenêtres avec offset : les mots globaux restent ordonnés par start."""
    c1 = _offset_and_filter_chunk_segments(
        {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "words": [{"word": "a", "start": 0.0, "end": 1.0, "score": 0.9}],
                },
            ],
        },
        0.0,
        5.0,
    )
    c2 = _offset_and_filter_chunk_segments(
        {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "words": [{"word": "b", "start": 0.0, "end": 1.0, "score": 0.9}],
                },
            ],
        },
        4.0,
        None,
    )
    all_starts = []
    for seg in c1 + c2:
        for w in seg.get("words") or []:
            if isinstance(w, dict) and w.get("start") is not None:
                all_starts.append(float(w["start"]))
    assert all_starts == sorted(all_starts)


def test_compute_media_chunk_specs_long_file_four_windows() -> None:
    """100 s, fenêtre 30 s, chevauchement 5 s → 4 fenêtres (aligné transcribe)."""
    specs = compute_media_chunk_specs(100.0, 30.0, 5.0)
    assert len(specs) == 4
    assert specs[0]["index"] == 1 and specs[0]["start_sec"] == 0.0
    assert specs[-1]["start_sec"] == 75.0


def test_manifest_roundtrip(tmp_path: Path) -> None:
    specs = compute_media_chunk_specs(10.0, 5.0, 1.0)
    m = new_chunk_manifest("/tmp/audio.wav", 10.0, 5.0, 1.0, 4.0, specs)
    path = tmp_path / "chunk_manifest.json"
    write_chunk_manifest(str(path), m)
    loaded = read_chunk_manifest(str(path))
    assert loaded is not None
    assert loaded["schema_version"] == m["schema_version"]
    assert len(loaded["chunks"]) == len(specs)


def test_manifest_compatible_requires_same_shape() -> None:
    specs = compute_media_chunk_specs(100.0, 30.0, 5.0)
    m = new_chunk_manifest("x.wav", 100.0, 30.0, 5.0, 25.0, specs)
    assert manifest_compatible_with_run(m, "x.wav", 100.0, 30.0, 5.0)
    assert not manifest_compatible_with_run(m, "y.wav", 100.0, 30.0, 5.0)


def test_merge_two_windows_no_duplicate_word_timestamps() -> None:
    """Deux fenêtres avec overlap: filtre selection_end évite doublons de mots aux frontières."""
    c1 = _offset_and_filter_chunk_segments(
        {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "words": [{"word": "a", "start": 0.0, "end": 0.5, "score": 0.9}],
                },
            ],
        },
        0.0,
        5.0,
    )
    c2 = _offset_and_filter_chunk_segments(
        {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "words": [{"word": "b", "start": 0.0, "end": 0.5, "score": 0.9}],
                },
            ],
        },
        4.0,
        None,
    )
    merged = c1 + c2
    starts = []
    for seg in merged:
        for w in seg.get("words") or []:
            if isinstance(w, dict) and w.get("start") is not None:
                starts.append(round(float(w["start"]), 3))
    assert len(starts) == len(set(starts))


def test_write_words_jsonl_per_chunk(tmp_path: Path) -> None:
    segs = [
        {
            "start": 0.0,
            "end": 1.0,
            "words": [{"word": "x", "start": 0.0, "end": 0.4, "score": 0.9}],
        }
    ]
    p = tmp_path / "t.chunk_0001.jsonl"
    write_words_jsonl_for_segments(str(p), segs)
    lines = p.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["word"] == "x"
