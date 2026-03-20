from __future__ import annotations

import math
from typing import Any

from whisperx.schema import (
    CanonicalTimelineAnalysis,
    CanonicalTimelineAnalysisConfig,
    CanonicalTimelineIpu,
    CanonicalTimelineNonSpeechInterval,
    CanonicalTimelineOverlap,
    CanonicalTimelinePause,
    CanonicalTimelineTransition,
    CanonicalTimeline,
    CanonicalTimelineEvent,
    CanonicalTimelineSegment,
    CanonicalTimelineSpeakerTurn,
    CanonicalTimelineWord,
)

TIMELINE_VERSION = 1
TIMESTAMP_DECIMALS = 3
LOW_CONFIDENCE_THRESHOLD = 0.35
EPSILON = 1e-6
DEFAULT_PAUSE_MIN = 0.15
DEFAULT_PAUSE_IGNORE_BELOW = 0.1
DEFAULT_NONSPEECH_MIN_DURATION = 0.15
DEFAULT_IPU_MIN_WORDS = 1
DEFAULT_IPU_MIN_DURATION = 0.0
DEFAULT_IPU_BRIDGE_SHORT_GAPS_UNDER = 0.0


def _as_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        numeric = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            numeric = float(text)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(numeric):
        return None
    return numeric


def _round_ts(value: float) -> float:
    return round(value, TIMESTAMP_DECIMALS)


def _normalize_speaker(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    speaker = value.strip()
    return speaker or None


def _normalize_token(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ""
    return str(value).strip()


def _append_flag(flags: list[str], flag: str) -> None:
    if flag not in flags:
        flags.append(flag)


def _collect_segments(result: dict[str, Any]) -> list[CanonicalTimelineSegment]:
    canonical_segments: list[CanonicalTimelineSegment] = []
    for raw_segment in result.get("segments", []):
        if not isinstance(raw_segment, dict):
            continue
        start = _as_float(raw_segment.get("start"))
        end = _as_float(raw_segment.get("end"))
        if start is None or end is None:
            continue
        if end < start:
            start, end = end, start
        segment: CanonicalTimelineSegment = {
            "text": _normalize_token(raw_segment.get("text")),
            "start": _round_ts(start),
            "end": _round_ts(end),
        }
        speaker = _normalize_speaker(raw_segment.get("speaker"))
        if speaker is not None:
            segment["speaker"] = speaker
        confidence = _as_float(raw_segment.get("avg_logprob"))
        if confidence is not None:
            segment["confidence"] = round(confidence, 3)
        canonical_segments.append(segment)
    return canonical_segments


def _next_explicit_start(words: list[dict[str, Any]], from_index: int) -> float | None:
    for idx in range(from_index + 1, len(words)):
        next_start = _as_float(words[idx].get("start"))
        if next_start is not None:
            return next_start
    return None


def _collect_words_from_segments(result: dict[str, Any]) -> list[CanonicalTimelineWord]:
    words_out: list[CanonicalTimelineWord] = []
    segments = result.get("segments", [])
    if not isinstance(segments, list):
        return words_out

    for raw_segment in segments:
        if not isinstance(raw_segment, dict):
            continue
        segment_words = raw_segment.get("words")
        if not isinstance(segment_words, list):
            continue

        segment_start = _as_float(raw_segment.get("start"))
        segment_end = _as_float(raw_segment.get("end"))
        segment_speaker = _normalize_speaker(raw_segment.get("speaker"))
        previous_word_end = segment_start

        for idx, raw_word in enumerate(segment_words):
            if not isinstance(raw_word, dict):
                continue
            token = _normalize_token(raw_word.get("word"))
            if not token:
                continue

            flags: list[str] = []
            start = _as_float(raw_word.get("start"))
            end = _as_float(raw_word.get("end"))

            if start is None:
                if previous_word_end is not None:
                    start = previous_word_end
                    _append_flag(flags, "interpolated")
                elif segment_start is not None:
                    start = segment_start
                    _append_flag(flags, "interpolated")

            if end is None:
                next_start = _next_explicit_start(segment_words, idx)
                if next_start is not None:
                    end = next_start
                    _append_flag(flags, "interpolated")
                elif segment_end is not None:
                    end = segment_end
                    _append_flag(flags, "interpolated")

            if start is None or end is None:
                _append_flag(flags, "unaligned")
                continue

            if end < start:
                end = start
                _append_flag(flags, "corrected_bounds")

            word: CanonicalTimelineWord = {
                "token": token,
                "start": _round_ts(start),
                "end": _round_ts(end),
            }

            confidence = _as_float(raw_word.get("score"))
            if confidence is not None:
                word["confidence"] = round(confidence, 3)
                if confidence < LOW_CONFIDENCE_THRESHOLD:
                    _append_flag(flags, "low_confidence")

            speaker = _normalize_speaker(raw_word.get("speaker")) or segment_speaker
            if speaker is not None:
                word["speaker"] = speaker

            if flags:
                word["flags"] = flags

            words_out.append(word)
            previous_word_end = end

    return words_out


def _collect_words_from_word_segments(result: dict[str, Any]) -> list[CanonicalTimelineWord]:
    words_out: list[CanonicalTimelineWord] = []
    word_segments = result.get("word_segments", [])
    if not isinstance(word_segments, list):
        return words_out

    for raw_word in word_segments:
        if not isinstance(raw_word, dict):
            continue
        token = _normalize_token(raw_word.get("word"))
        if not token:
            continue
        start = _as_float(raw_word.get("start"))
        end = _as_float(raw_word.get("end"))
        if start is None or end is None:
            continue
        if end < start:
            end = start

        word: CanonicalTimelineWord = {
            "token": token,
            "start": _round_ts(start),
            "end": _round_ts(end),
        }

        confidence = _as_float(raw_word.get("score"))
        flags: list[str] = []
        if confidence is not None:
            word["confidence"] = round(confidence, 3)
            if confidence < LOW_CONFIDENCE_THRESHOLD:
                _append_flag(flags, "low_confidence")

        speaker = _normalize_speaker(raw_word.get("speaker"))
        if speaker is not None:
            word["speaker"] = speaker

        if flags:
            word["flags"] = flags

        words_out.append(word)
    return words_out


def _merge_speaker_turns(
    turns: list[CanonicalTimelineSpeakerTurn],
) -> list[CanonicalTimelineSpeakerTurn]:
    if not turns:
        return []

    ordered = sorted(turns, key=lambda turn: (turn["start"], turn["end"], turn["speaker"]))
    merged: list[CanonicalTimelineSpeakerTurn] = []

    for turn in ordered:
        if not merged:
            merged.append(turn.copy())
            continue

        last = merged[-1]
        if turn["speaker"] == last["speaker"] and turn["start"] <= last["end"] + EPSILON:
            if turn["end"] > last["end"]:
                last["end"] = turn["end"]
            continue

        merged.append(turn.copy())

    for turn in merged:
        turn["start"] = _round_ts(turn["start"])
        turn["end"] = _round_ts(turn["end"])
    return merged


def _derive_speaker_turns(
    result: dict[str, Any],
    segments: list[CanonicalTimelineSegment],
) -> list[CanonicalTimelineSpeakerTurn]:
    turns: list[CanonicalTimelineSpeakerTurn] = []

    raw_turns = result.get("speaker_turns")
    if isinstance(raw_turns, list):
        for raw_turn in raw_turns:
            if not isinstance(raw_turn, dict):
                continue
            speaker = _normalize_speaker(raw_turn.get("speaker"))
            start = _as_float(raw_turn.get("start"))
            end = _as_float(raw_turn.get("end"))
            if speaker is None or start is None or end is None:
                continue
            if end < start:
                start, end = end, start
            turns.append({"speaker": speaker, "start": start, "end": end})

    if not turns:
        for segment in segments:
            speaker = segment.get("speaker")
            if speaker is None:
                continue
            turns.append(
                {
                    "speaker": speaker,
                    "start": float(segment["start"]),
                    "end": float(segment["end"]),
                }
            )

    return _merge_speaker_turns(turns)


def _derive_overlap_events(
    turns: list[CanonicalTimelineSpeakerTurn],
) -> list[CanonicalTimelineEvent]:
    if len(turns) < 2:
        return []

    events: list[CanonicalTimelineEvent] = []
    for idx in range(len(turns)):
        left = turns[idx]
        for jdx in range(idx + 1, len(turns)):
            right = turns[jdx]
            if right["start"] >= left["end"]:
                break
            if left["speaker"] == right["speaker"]:
                continue
            start = max(left["start"], right["start"])
            end = min(left["end"], right["end"])
            if end <= start + EPSILON:
                continue
            events.append(
                {
                    "type": "overlap",
                    "start": _round_ts(start),
                    "end": _round_ts(end),
                    "speakers": sorted([left["speaker"], right["speaker"]]),
                }
            )
    return events


def _normalize_existing_events(result: dict[str, Any]) -> list[CanonicalTimelineEvent]:
    raw_events = result.get("events")
    if not isinstance(raw_events, list):
        return []

    events: list[CanonicalTimelineEvent] = []
    for raw_event in raw_events:
        if not isinstance(raw_event, dict):
            continue
        event_type = _normalize_token(raw_event.get("type"))
        start = _as_float(raw_event.get("start"))
        end = _as_float(raw_event.get("end"))
        if not event_type or start is None or end is None:
            continue
        if end < start:
            start, end = end, start
        event: CanonicalTimelineEvent = {
            "type": event_type,
            "start": _round_ts(start),
            "end": _round_ts(end),
        }
        speakers = raw_event.get("speakers")
        if isinstance(speakers, list):
            cleaned_speakers = [
                speaker
                for speaker in (_normalize_speaker(value) for value in speakers)
                if speaker is not None
            ]
            if cleaned_speakers:
                event["speakers"] = sorted(set(cleaned_speakers))
        events.append(event)
    return events


def _dedupe_events(events: list[CanonicalTimelineEvent]) -> list[CanonicalTimelineEvent]:
    deduped: list[CanonicalTimelineEvent] = []
    seen: set[tuple] = set()
    for event in events:
        key = (
            event["type"],
            event["start"],
            event["end"],
            tuple(event.get("speakers", [])),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(event)
    deduped.sort(key=lambda event: (event["start"], event["end"], event["type"]))
    return deduped


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "on"}:
            return True
        if text in {"0", "false", "no", "off"}:
            return False
    return default


def _normalize_analysis_config(
    analysis_config: dict[str, Any] | None,
) -> CanonicalTimelineAnalysisConfig:
    source = analysis_config or {}
    pause_min = _as_float(source.get("pause_min"))
    if pause_min is None or pause_min < 0:
        pause_min = DEFAULT_PAUSE_MIN

    pause_ignore_below = _as_float(source.get("pause_ignore_below"))
    if pause_ignore_below is None or pause_ignore_below < 0:
        pause_ignore_below = DEFAULT_PAUSE_IGNORE_BELOW

    pause_effective_min = max(pause_min, pause_ignore_below)
    include_nonspeech = _as_bool(source.get("include_nonspeech"), default=True)

    nonspeech_min_duration = _as_float(source.get("nonspeech_min_duration"))
    if nonspeech_min_duration is None or nonspeech_min_duration < 0:
        nonspeech_min_duration = DEFAULT_NONSPEECH_MIN_DURATION

    ipu_min_words = _as_float(source.get("ipu_min_words"))
    if ipu_min_words is None or ipu_min_words < 1:
        ipu_min_words_int = DEFAULT_IPU_MIN_WORDS
    else:
        ipu_min_words_int = int(ipu_min_words)

    ipu_min_duration = _as_float(source.get("ipu_min_duration"))
    if ipu_min_duration is None or ipu_min_duration < 0:
        ipu_min_duration = DEFAULT_IPU_MIN_DURATION

    ipu_bridge_short_gaps_under = _as_float(source.get("ipu_bridge_short_gaps_under"))
    if ipu_bridge_short_gaps_under is None or ipu_bridge_short_gaps_under < 0:
        ipu_bridge_short_gaps_under = DEFAULT_IPU_BRIDGE_SHORT_GAPS_UNDER

    normalized: CanonicalTimelineAnalysisConfig = {
        "pause_min": round(pause_min, 3),
        "pause_ignore_below": round(pause_ignore_below, 3),
        "pause_effective_min": round(pause_effective_min, 3),
        "include_nonspeech": include_nonspeech,
        "nonspeech_min_duration": round(nonspeech_min_duration, 3),
        "ipu_min_words": ipu_min_words_int,
        "ipu_min_duration": round(ipu_min_duration, 3),
        "ipu_bridge_short_gaps_under": round(ipu_bridge_short_gaps_under, 3),
    }

    pause_max = _as_float(source.get("pause_max"))
    if pause_max is not None and pause_max > 0:
        normalized["pause_max"] = round(pause_max, 3)
    return normalized


def _derive_lexical_pauses(
    words: list[CanonicalTimelineWord],
    config: CanonicalTimelineAnalysisConfig,
) -> list[CanonicalTimelinePause]:
    if len(words) < 2:
        return []

    streams: dict[str, list[CanonicalTimelineWord]] = {}
    for word in words:
        speaker = _normalize_speaker(word.get("speaker"))
        key = speaker if speaker is not None else "__global__"
        streams.setdefault(key, []).append(word)

    pauses: list[CanonicalTimelinePause] = []
    pause_min = float(config["pause_effective_min"])
    pause_max = config.get("pause_max")
    for speaker_key, stream_words in streams.items():
        ordered_words = sorted(
            stream_words,
            key=lambda item: (float(item["start"]), float(item["end"])),
        )
        previous_end: float | None = None
        for word in ordered_words:
            start = float(word["start"])
            end = float(word["end"])
            if end < start:
                end = start

            if previous_end is None:
                previous_end = end
                continue

            gap = start - previous_end
            if gap <= pause_min + EPSILON:
                previous_end = max(previous_end, end)
                continue
            if pause_max is not None and gap > float(pause_max) + EPSILON:
                previous_end = max(previous_end, end)
                continue

            pause: CanonicalTimelinePause = {
                "start": _round_ts(previous_end),
                "end": _round_ts(start),
                "dur": _round_ts(gap),
                "type": "intra_word_gap",
            }
            if speaker_key != "__global__":
                pause["speaker"] = speaker_key
            pauses.append(pause)
            previous_end = max(previous_end, end)
    pauses.sort(key=lambda pause: (pause["start"], pause["end"], pause.get("speaker", "")))
    return pauses


def _collect_speech_intervals(
    segments: list[CanonicalTimelineSegment],
    words: list[CanonicalTimelineWord],
) -> list[tuple[float, float]]:
    intervals: list[tuple[float, float]] = []
    for segment in segments:
        start = float(segment["start"])
        end = float(segment["end"])
        if end < start:
            start, end = end, start
        intervals.append((start, end))

    if not intervals:
        for word in words:
            start = float(word["start"])
            end = float(word["end"])
            if end < start:
                start, end = end, start
            intervals.append((start, end))

    if not intervals:
        return []

    intervals.sort(key=lambda item: (item[0], item[1]))
    merged: list[tuple[float, float]] = []
    for start, end in intervals:
        if not merged:
            merged.append((start, end))
            continue
        last_start, last_end = merged[-1]
        if start <= last_end + EPSILON:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _derive_nonspeech_intervals(
    segments: list[CanonicalTimelineSegment],
    words: list[CanonicalTimelineWord],
    config: CanonicalTimelineAnalysisConfig,
) -> list[CanonicalTimelineNonSpeechInterval]:
    if not config["include_nonspeech"]:
        return []

    merged_speech = _collect_speech_intervals(segments, words)
    if len(merged_speech) < 2:
        return []

    min_duration = float(config["nonspeech_min_duration"])
    nonspeech_intervals: list[CanonicalTimelineNonSpeechInterval] = []
    for idx in range(1, len(merged_speech)):
        prev_end = merged_speech[idx - 1][1]
        next_start = merged_speech[idx][0]
        gap = next_start - prev_end
        if gap <= min_duration + EPSILON:
            continue
        nonspeech_intervals.append(
            {
                "start": _round_ts(prev_end),
                "end": _round_ts(next_start),
                "dur": _round_ts(gap),
                "method": "vad_gap",
            }
        )
    return nonspeech_intervals


def _nonspeech_events(
    nonspeech_intervals: list[CanonicalTimelineNonSpeechInterval],
) -> list[CanonicalTimelineEvent]:
    events: list[CanonicalTimelineEvent] = []
    for interval in nonspeech_intervals:
        events.append(
            {
                "type": "non_speech",
                "start": interval["start"],
                "end": interval["end"],
            }
        )
    return events


def _derive_ipus(
    words: list[CanonicalTimelineWord],
    config: CanonicalTimelineAnalysisConfig,
) -> list[CanonicalTimelineIpu]:
    if not words:
        return []

    streams: dict[str, list[CanonicalTimelineWord]] = {}
    for word in words:
        speaker = _normalize_speaker(word.get("speaker"))
        key = speaker if speaker is not None else "__global__"
        streams.setdefault(key, []).append(word)

    split_threshold = max(
        float(config["pause_effective_min"]),
        float(config["ipu_bridge_short_gaps_under"]),
    )
    min_words = int(config["ipu_min_words"])
    min_duration = float(config["ipu_min_duration"])

    ipus: list[CanonicalTimelineIpu] = []
    for speaker_key, stream_words in streams.items():
        ordered_words = sorted(
            stream_words,
            key=lambda item: (float(item["start"]), float(item["end"])),
        )
        if not ordered_words:
            continue

        current_tokens: list[str] = []
        current_start: float | None = None
        current_end: float | None = None
        current_count = 0

        def flush_current() -> None:
            nonlocal current_tokens, current_start, current_end, current_count
            if current_start is None or current_end is None:
                current_tokens = []
                current_start = None
                current_end = None
                current_count = 0
                return
            duration = max(0.0, current_end - current_start)
            if current_count < min_words or duration + EPSILON < min_duration:
                current_tokens = []
                current_start = None
                current_end = None
                current_count = 0
                return

            text = " ".join(token for token in current_tokens if token).strip()
            ipu: CanonicalTimelineIpu = {
                "start": _round_ts(current_start),
                "end": _round_ts(current_end),
                "dur": _round_ts(duration),
                "text": text,
                "n_words": current_count,
            }
            if speaker_key != "__global__":
                ipu["speaker"] = speaker_key
            ipus.append(ipu)

            current_tokens = []
            current_start = None
            current_end = None
            current_count = 0

        for word in ordered_words:
            start = float(word["start"])
            end = float(word["end"])
            if end < start:
                end = start
            token = _normalize_token(word.get("token"))

            if current_start is None or current_end is None:
                current_start = start
                current_end = end
                current_tokens = [token]
                current_count = 1
                continue

            gap = start - current_end
            if gap > split_threshold + EPSILON:
                flush_current()
                current_start = start
                current_end = end
                current_tokens = [token]
                current_count = 1
                continue

            current_end = max(current_end, end)
            current_tokens.append(token)
            current_count += 1

        flush_current()

    ipus.sort(key=lambda ipu: (ipu["start"], ipu["end"], ipu.get("speaker", "")))
    return ipus


def _derive_transitions(
    speaker_turns: list[CanonicalTimelineSpeakerTurn],
) -> list[CanonicalTimelineTransition]:
    if len(speaker_turns) < 2:
        return []

    ordered_turns = sorted(
        speaker_turns,
        key=lambda turn: (float(turn["start"]), float(turn["end"]), turn["speaker"]),
    )
    transitions: list[CanonicalTimelineTransition] = []
    for idx in range(len(ordered_turns) - 1):
        left = ordered_turns[idx]
        right = ordered_turns[idx + 1]
        from_speaker = left["speaker"]
        to_speaker = right["speaker"]
        if from_speaker == to_speaker:
            continue

        from_end = float(left["end"])
        to_start = float(right["start"])
        transition_start = min(from_end, to_start)
        transition_end = max(from_end, to_start)
        transitions.append(
            {
                "from": from_speaker,
                "to": to_speaker,
                "gap": _round_ts(to_start - from_end),
                "start": _round_ts(transition_start),
                "end": _round_ts(transition_end),
            }
        )
    return transitions


def _derive_overlaps_from_events(
    events: list[CanonicalTimelineEvent],
) -> list[CanonicalTimelineOverlap]:
    overlaps: list[CanonicalTimelineOverlap] = []
    for event in events:
        if event["type"] != "overlap":
            continue
        start = float(event["start"])
        end = float(event["end"])
        if end <= start + EPSILON:
            continue
        overlap: CanonicalTimelineOverlap = {
            "speakers": sorted(event.get("speakers", [])),
            "start": _round_ts(start),
            "end": _round_ts(end),
            "dur": _round_ts(end - start),
        }
        overlaps.append(overlap)
    return overlaps


def build_canonical_timeline(
    result: dict[str, Any],
    analysis_config: dict[str, Any] | None = None,
) -> CanonicalTimeline:
    segments = _collect_segments(result)
    words = _collect_words_from_segments(result)
    if not words:
        words = _collect_words_from_word_segments(result)
    speaker_turns = _derive_speaker_turns(result, segments)
    normalized_analysis_config = _normalize_analysis_config(analysis_config)
    pauses = _derive_lexical_pauses(words, normalized_analysis_config)
    nonspeech_intervals = _derive_nonspeech_intervals(
        segments,
        words,
        normalized_analysis_config,
    )
    events = _dedupe_events(
        _normalize_existing_events(result)
        + _derive_overlap_events(speaker_turns)
        + _nonspeech_events(nonspeech_intervals)
    )
    ipus = _derive_ipus(words, normalized_analysis_config)
    transitions = _derive_transitions(speaker_turns)
    overlaps = _derive_overlaps_from_events(events)

    timeline: CanonicalTimeline = {
        "version": TIMELINE_VERSION,
        "words": words,
        "segments": segments,
        "speaker_turns": speaker_turns,
        "events": events,
    }
    analysis: CanonicalTimelineAnalysis = {
        "config": normalized_analysis_config,
        "pauses": pauses,
        "nonspeech_intervals": nonspeech_intervals,
        "ipus": ipus,
        "transitions": transitions,
        "overlaps": overlaps,
    }
    timeline["analysis"] = analysis
    return timeline
