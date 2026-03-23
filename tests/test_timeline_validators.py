"""Validateurs timeline WX-502 (8 cas nominaux + 6 rejets)."""

import pytest

from whisperx.timeline_validators import (
    TimelineValidationError,
    remap_word_segment_ids_after_segment_sort,
    sort_temporal_segments,
    validate_segment,
    validate_speaker_turn,
    validate_word,
)


# --- Nominaux (8) ---


def test_validate_word_aligned_nominal() -> None:
    validate_word(
        {"token": "hello", "start": 0.0, "end": 0.5, "alignment_status": "aligned"},
    )


def test_validate_word_interpolated_nominal() -> None:
    validate_word(
        {
            "token": "hi",
            "start": 1.0,
            "end": 1.1,
            "alignment_status": "interpolated",
            "flags": ["interpolated"],
        },
    )


def test_validate_word_missing_nominal() -> None:
    validate_word({"alignment_status": "missing"})


def test_validate_segment_nominal() -> None:
    validate_segment({"text": "a", "start": 0.0, "end": 1.0, "segment_id": "s00000"})


def test_validate_segment_with_flags_nominal() -> None:
    validate_segment(
        {"text": "b", "start": 0.0, "end": 0.5, "flags": ["overlap_zone"], "segment_id": "s00001"},
    )


def test_validate_speaker_turn_nominal() -> None:
    validate_speaker_turn(
        {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0, "turn_id": "t00000", "source": "pyannote"},
    )


def test_validate_word_inside_segment_bounds() -> None:
    validate_word(
        {"token": "x", "start": 0.1, "end": 0.4, "alignment_status": "aligned"},
        segment_bounds=(0.0, 0.5),
        tolerance_sec=0.05,
    )


def test_overlap_two_speakers_allowed() -> None:
    """Deux tours différents peuvent se chevaucher (pas une erreur de validation)."""
    validate_speaker_turn({"speaker": "A", "start": 0.0, "end": 1.0})
    validate_speaker_turn({"speaker": "B", "start": 0.5, "end": 1.5})


# --- Rejets (6) ---


def test_reject_nan_start() -> None:
    with pytest.raises(TimelineValidationError):
        validate_word({"token": "a", "start": float("nan"), "end": 1.0, "alignment_status": "aligned"})


def test_reject_start_ge_end() -> None:
    with pytest.raises(TimelineValidationError):
        validate_word({"token": "a", "start": 1.0, "end": 1.0, "alignment_status": "aligned"})


def test_reject_missing_with_times() -> None:
    with pytest.raises(TimelineValidationError):
        validate_word({"token": "a", "start": 0.0, "end": 0.1, "alignment_status": "missing"})


def test_reject_invalid_alignment_status() -> None:
    with pytest.raises(TimelineValidationError):
        validate_word({"token": "a", "start": 0.0, "end": 0.1, "alignment_status": "bogus"})


def test_reject_segment_inverted() -> None:
    with pytest.raises(TimelineValidationError):
        validate_segment({"text": "a", "start": 2.0, "end": 1.0})


def test_reject_empty_speaker_turn() -> None:
    with pytest.raises(TimelineValidationError):
        validate_speaker_turn({"speaker": "  ", "start": 0.0, "end": 1.0})


def test_sort_and_remap_segment_ids() -> None:
    segs = [
        {"text": "b", "start": 1.0, "end": 2.0, "segment_id": "s00001"},
        {"text": "a", "start": 0.0, "end": 0.5, "segment_id": "s00000"},
    ]
    words = [{"token": "x", "start": 0.0, "end": 0.5, "segment_id": "s00000"}]
    sort_temporal_segments(segs)
    assert segs[0]["start"] == 0.0
    old_to_new = {"s00000": "s00000", "s00001": "s00001"}
    remap_word_segment_ids_after_segment_sort(words, old_to_new)
    assert words[0]["segment_id"] == "s00000"


def test_reject_word_outside_segment_bounds() -> None:
    with pytest.raises(TimelineValidationError):
        validate_word(
            {"token": "x", "start": 0.0, "end": 2.0, "alignment_status": "aligned"},
            segment_bounds=(0.0, 1.0),
            tolerance_sec=0.05,
        )

