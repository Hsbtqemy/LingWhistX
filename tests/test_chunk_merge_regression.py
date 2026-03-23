"""
Regression tests for media-level chunk merge: offsets, monotonicity, selection window.

Runs without torch/ASR (fast CI).
"""

from whisperx.chunk_merge import _offset_and_filter_chunk_segments


def test_offset_shift_applies_to_segments() -> None:
    chunk = {
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "a"},
            {"start": 1.0, "end": 2.0, "text": "b"},
        ]
    }
    out = _offset_and_filter_chunk_segments(chunk, chunk_start_sec=100.0, selection_end_sec=None)
    assert len(out) == 2
    assert out[0]["start"] == 100.0
    assert out[0]["end"] == 101.0
    assert out[1]["start"] == 101.0
    assert out[1]["end"] == 102.0


def test_selection_end_filters_late_segments() -> None:
    """Segments whose midpoint is past selection_end are dropped (overlap trimming)."""
    chunk = {
        "segments": [
            {"start": 0.0, "end": 2.0, "text": "keep"},
            {"start": 8.0, "end": 9.0, "text": "drop"},
        ]
    }
    out = _offset_and_filter_chunk_segments(
        chunk,
        chunk_start_sec=0.0,
        selection_end_sec=5.0,
    )
    assert len(out) == 1
    assert out[0]["text"] == "keep"


def test_merged_order_monotonic_after_sort() -> None:
    """Simulate two chunk contributions: after global sort, starts are non-decreasing."""
    c1 = _offset_and_filter_chunk_segments(
        {"segments": [{"start": 0.0, "end": 1.0}]},
        0.0,
        5.0,
    )
    c2 = _offset_and_filter_chunk_segments(
        {"segments": [{"start": 0.0, "end": 1.0}]},
        4.0,
        None,
    )
    merged = c1 + c2
    merged.sort(key=lambda s: (float(s["start"]), float(s["end"])))
    prev = -1.0
    for s in merged:
        st = float(s["start"])
        en = float(s["end"])
        assert st <= en
        assert st >= prev - 1e-3
        prev = max(prev, en)


def test_inverted_end_start_normalized() -> None:
    chunk = {"segments": [{"start": 2.0, "end": 1.0, "text": "x"}]}
    out = _offset_and_filter_chunk_segments(chunk, 10.0, None)
    assert len(out) == 1
    assert out[0]["start"] <= out[0]["end"]
