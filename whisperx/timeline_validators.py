"""
Validateurs timeline v1 (WX-502) — segments, mots, tours locuteur.

Les tours peuvent se chevaucher (overlap diarisation) ; ce n'est pas une erreur.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

from whisperx.schema import CanonicalTimelineSegment, CanonicalTimelineSpeakerTurn

DEFAULT_SEGMENT_TOLERANCE_SEC = 0.05


class TimelineValidationError(ValueError):
    """Erreur de validation d'un objet timeline."""


def _finite(x: Any) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(float(x))


def validate_interval(start: Any, end: Any) -> None:
    """Intervalle temporel strict pour analyses (pas NaN / None, start < end)."""
    if not _finite(start) or not _finite(end):
        raise TimelineValidationError("interval start/end must be finite numbers")
    if float(end) <= float(start):
        raise TimelineValidationError(f"interval requires start < end, got {start} >= {end}")


def validate_segment(
    segment: Mapping[str, Any],
    *,
    require_segment_id: bool = False,
) -> None:
    """Valide un segment canonique (start < end, texte UTF-8, pas de NaN)."""
    start = segment.get("start")
    end = segment.get("end")
    text = segment.get("text")
    if not isinstance(text, str):
        raise TimelineValidationError("segment.text must be a string")
    if not _finite(start) or not _finite(end):
        raise TimelineValidationError("segment start/end must be finite numbers")
    start_f = float(start)
    end_f = float(end)
    if end_f <= start_f:
        raise TimelineValidationError(f"segment requires start < end, got {start_f} >= {end_f}")
    if require_segment_id:
        sid = segment.get("segment_id")
        if not isinstance(sid, str) or not sid.strip():
            raise TimelineValidationError("segment.segment_id required when require_segment_id=True")


def validate_word(
    word: Mapping[str, Any],
    *,
    segment_bounds: tuple[float, float] | None = None,
    tolerance_sec: float = DEFAULT_SEGMENT_TOLERANCE_SEC,
) -> None:
    """
    Valide un mot canonique.

    - token non vide (sauf si alignment_status == missing explicitement).
    - Si alignment_status != missing: start/end finis, start < end.
    - Si alignment_status == missing: pas de temps fiable (start/end absents ou ignorés).
    - Si segment_bounds fourni (start, end), vérifie que le mot est dans [seg - tol, seg + tol]
      (flag implicite `segment_boundary_ambiguous` géré dans la timeline, pas ici).
    """
    status = word.get("alignment_status", "aligned")
    if status not in ("aligned", "interpolated", "missing"):
        raise TimelineValidationError(f"invalid alignment_status: {status!r}")

    if status == "missing":
        if _finite(word.get("start")) or _finite(word.get("end")):
            raise TimelineValidationError("alignment_status missing must not have finite start/end")
        return

    token = word.get("token")
    if not isinstance(token, str) or not token.strip():
        raise TimelineValidationError("word.token must be non-empty for aligned/interpolated words")

    start = word.get("start")
    end = word.get("end")
    if not _finite(start) or not _finite(end):
        raise TimelineValidationError("aligned/interpolated words require finite start and end")
    sf = float(start)
    ef = float(end)
    if ef <= sf:
        raise TimelineValidationError(f"word requires start < end, got {sf} >= {ef}")

    if segment_bounds is not None:
        seg_lo, seg_hi = segment_bounds
        if sf < seg_lo - tolerance_sec - 1e-9 or ef > seg_hi + tolerance_sec + 1e-9:
            raise TimelineValidationError(
                f"word [{sf},{ef}] outside segment [{seg_lo},{seg_hi}] "
                f"with tolerance {tolerance_sec}s"
            )


def validate_speaker_turn(turn: Mapping[str, Any]) -> None:
    """
    Valide un tour locuteur. Les chevauchements entre tours différents sont autorisés.
    """
    speaker = turn.get("speaker")
    if not isinstance(speaker, str) or not speaker.strip():
        raise TimelineValidationError("speaker_turn.speaker must be non-empty")
    start = turn.get("start")
    end = turn.get("end")
    if not _finite(start) or not _finite(end):
        raise TimelineValidationError("speaker_turn start/end must be finite")
    sf = float(start)
    ef = float(end)
    if ef <= sf:
        raise TimelineValidationError(f"speaker_turn requires start < end, got {sf} >= {ef}")


def sort_temporal_segments(segments: list[CanonicalTimelineSegment]) -> None:
    """Tri stable par (start, end, text)."""
    segments.sort(key=lambda s: (float(s["start"]), float(s["end"]), s.get("text", "")))


def sort_temporal_words(words: list[Mapping[str, Any]]) -> None:
    """Tri stable par (start, end, token)."""
    words.sort(
        key=lambda w: (
            float(w["start"]),
            float(w["end"]),
            w.get("token", ""),
        )
    )


def sort_temporal_speaker_turns(turns: list[CanonicalTimelineSpeakerTurn]) -> None:
    """Tri stable par (start, end, speaker)."""
    turns.sort(
        key=lambda t: (
            float(t["start"]),
            float(t["end"]),
            t.get("speaker", ""),
        )
    )


def remap_word_segment_ids_after_segment_sort(
    words: list[Mapping[str, Any]],
    old_id_to_new: dict[str, str],
) -> None:
    """Met à jour segment_id sur chaque mot après renumerotation des segments."""
    for w in words:
        sid = w.get("segment_id")
        if isinstance(sid, str) and sid in old_id_to_new:
            w["segment_id"] = old_id_to_new[sid]
