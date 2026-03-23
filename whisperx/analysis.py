"""
API d’analyse timeline v1 (WX-503) — wrappers autour des primitives `timeline`.

Les implémentations vivent dans `timeline.py` ; ce module expose des noms stables
`build_pauses`, `build_ipus`, `build_transitions`, `build_overlaps` pour scripts et tests.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from whisperx.timeline import (
    _derive_ipus,
    _derive_lexical_pauses,
    _derive_nonspeech_intervals,
    _derive_overlaps_from_events,
    _derive_transition_gap_pauses,
    _derive_transitions,
    _global_nonspeech_as_pauses,
    _merge_and_number_pauses,
)

if TYPE_CHECKING:
    from whisperx.schema import (
        CanonicalTimelineAnalysisConfig,
        CanonicalTimelineEvent,
        CanonicalTimelineIpu,
        CanonicalTimelineOverlap,
        CanonicalTimelinePause,
        CanonicalTimelineSegment,
        CanonicalTimelineSpeakerTurn,
        CanonicalTimelineWord,
    )


def build_pauses(
    words: list["CanonicalTimelineWord"],
    segments: list["CanonicalTimelineSegment"],
    config: "CanonicalTimelineAnalysisConfig",
) -> list["CanonicalTimelinePause"]:
    """Pauses fusionnées : intra locuteur, transition inter-locuteurs, nonspeech global."""
    lexical = _derive_lexical_pauses(words, config)
    transition = _derive_transition_gap_pauses(words, config)
    nonspeech_intervals = _derive_nonspeech_intervals(segments, words, config)
    global_ns = _global_nonspeech_as_pauses(nonspeech_intervals)
    return _merge_and_number_pauses([lexical, transition, global_ns])


def build_ipus(
    words: list["CanonicalTimelineWord"],
    config: "CanonicalTimelineAnalysisConfig",
) -> list["CanonicalTimelineIpu"]:
    return _derive_ipus(words, config)


def build_transitions(
    speaker_turns: list["CanonicalTimelineSpeakerTurn"],
) -> list[dict]:
    return _derive_transitions(speaker_turns)


def build_overlaps(
    events: list["CanonicalTimelineEvent"],
) -> list["CanonicalTimelineOverlap"]:
    return _derive_overlaps_from_events(events)
