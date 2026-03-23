"""Tests unitaires purs (WX-505) — temps, intervalles, quantize."""

import pytest

from whisperx.run_manifest import quantize_time_seconds
from whisperx.timeline_validators import (
    TimelineValidationError,
    sort_temporal_segments,
    validate_interval,
)


def test_quantize_time_chain_no_drift() -> None:
    t = 0.0
    for _ in range(1000):
        t = quantize_time_seconds(t + 0.001)
    assert t == pytest.approx(1.0, abs=0.002)


def test_validate_interval_rejects() -> None:
    validate_interval(0.0, 0.001)
    with pytest.raises(TimelineValidationError):
        validate_interval(1.0, 1.0)
    with pytest.raises(TimelineValidationError):
        validate_interval(float("nan"), 1.0)


def test_sort_temporal_segments_stable_order() -> None:
    segs = [
        {"text": "b", "start": 1.0, "end": 2.0, "segment_id": "s00001"},
        {"text": "a", "start": 0.0, "end": 0.5, "segment_id": "s00000"},
    ]
    sort_temporal_segments(segs)
    assert [s["segment_id"] for s in segs] == ["s00000", "s00001"]
