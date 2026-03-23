from __future__ import annotations

from collections import defaultdict
from typing import Any

from whisperx.utils import as_float
from whisperx.schema import (
    AlignmentStatus,
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
from whisperx.analysis_calibration import prepare_timeline_analysis_config
from whisperx.timeline_validators import (
    remap_word_segment_ids_after_segment_sort,
    sort_temporal_segments,
    sort_temporal_speaker_turns,
    sort_temporal_words,
)

TIMELINE_VERSION = 1
TIMESTAMP_DECIMALS = 3
LOW_CONFIDENCE_THRESHOLD = 0.35
EPSILON = 1e-6
SEGMENT_BOUNDARY_TOLERANCE_SEC = 0.05
DEFAULT_PAUSE_MIN = 0.15
DEFAULT_PAUSE_IGNORE_BELOW = 0.1
DEFAULT_ANALYSIS_INCLUDE_NONSPEECH = True
DEFAULT_NONSPEECH_MIN_DURATION = 0.15
DEFAULT_IPU_MIN_WORDS = 1
DEFAULT_IPU_MIN_DURATION = 0.0
DEFAULT_IPU_BRIDGE_SHORT_GAPS_UNDER = 0.0

# WX-605 — post-traitement speaker_turns (fusion / scission). Preset sport duo: paire typique plateau sport.
SPEAKER_TURN_POSTPROCESS_PRESETS: dict[str, dict[str, Any]] = {
    "sport_duo": {
        "merge_gap_sec_max": 0.08,
        "split_word_gap_sec": 0.45,
        "diarization_hint": "min_speakers=2 max_speakers=2",
    },
}

# WX-606 — stabilisation timestamps mots (détection vs voisins + lissage optionnel).
DEFAULT_WORD_TS_RATIO_LOW = 0.25
DEFAULT_WORD_TS_RATIO_HIGH = 4.0
DEFAULT_WORD_TS_SMOOTH_MAX_SEC = 0.02


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


def _append_word_flag(word: CanonicalTimelineWord, flag: str) -> None:
    existing = word.get("flags")
    if isinstance(existing, list):
        _append_flag(existing, flag)
    else:
        word["flags"] = [flag]


def _word_duration_sec(word: CanonicalTimelineWord) -> float:
    s, e = float(word["start"]), float(word["end"])
    return max(0.0, e - s)


def _reference_neighbor_word_duration(
    stream: list[CanonicalTimelineWord], index: int
) -> float | None:
    n = len(stream)
    if n < 2:
        return None
    if index == 0:
        return _word_duration_sec(stream[1])
    if index == n - 1:
        return _word_duration_sec(stream[n - 2])
    left = _word_duration_sec(stream[index - 1])
    right = _word_duration_sec(stream[index + 1])
    return (left + right) / 2.0


def _detect_aberrant_word_timestamps(
    words: list[CanonicalTimelineWord],
    ratio_low: float,
    ratio_high: float,
) -> None:
    """Marque les mots dont la durée est hors plage vs durée de référence des voisins (même flux)."""
    streams: dict[str, list[CanonicalTimelineWord]] = {}
    for w in words:
        sp = _normalize_speaker(w.get("speaker"))
        key = sp if sp is not None else "__global__"
        streams.setdefault(key, []).append(w)
    for stream in streams.values():
        stream.sort(key=lambda x: (float(x["start"]), float(x["end"])))
        for i, w in enumerate(stream):
            ref = _reference_neighbor_word_duration(stream, i)
            if ref is None or ref <= 1e-9:
                continue
            d = _word_duration_sec(w)
            if d < ref * ratio_low or d > ref * ratio_high:
                _append_word_flag(w, "timestamp_aberrant_vs_neighbors")


def _smooth_aberrant_word_timestamps(
    words: list[CanonicalTimelineWord],
    ratio_low: float,
    ratio_high: float,
    max_adj_sec: float,
) -> None:
    """Ajuste légèrement les bornes des mots déjà marqués aberrants (mode smooth uniquement)."""
    streams: dict[str, list[CanonicalTimelineWord]] = {}
    for w in words:
        sp = _normalize_speaker(w.get("speaker"))
        key = sp if sp is not None else "__global__"
        streams.setdefault(key, []).append(w)
    for stream in streams.values():
        stream.sort(key=lambda x: (float(x["start"]), float(x["end"])))
        for i, w in enumerate(stream):
            fl = w.get("flags") or []
            if "timestamp_aberrant_vs_neighbors" not in fl:
                continue
            ref = _reference_neighbor_word_duration(stream, i)
            if ref is None or ref <= 1e-9:
                continue
            prev_w = stream[i - 1] if i > 0 else None
            next_w = stream[i + 1] if i < len(stream) - 1 else None
            s, e = float(w["start"]), float(w["end"])
            d = e - s
            target_d = min(max(d, ref * max(ratio_low * 1.2, 0.05)), ref * min(ratio_high, 3.0))
            target_d = max(0.015, target_d)
            delta = target_d - d
            delta = max(-2.0 * max_adj_sec, min(2.0 * max_adj_sec, delta))
            ns = s - delta / 2.0
            ne = e + delta / 2.0
            if prev_w is not None:
                ns = max(ns, float(prev_w["end"]) + EPSILON)
            if next_w is not None:
                ne = min(ne, float(next_w["start"]) - EPSILON)
            if ne <= ns + 1e-4:
                continue
            w["start"] = _round_ts(ns)
            w["end"] = _round_ts(ne)
            _append_word_flag(w, "timestamp_smoothed")


def _apply_word_timestamp_stabilization(
    words: list[CanonicalTimelineWord],
    config: CanonicalTimelineAnalysisConfig,
) -> None:
    cfg = dict(config)
    mode = cfg.get("word_timestamp_stabilize_mode", "off")
    if mode == "off" or mode is None:
        return
    rl = float(cfg.get("word_ts_neighbor_ratio_low", DEFAULT_WORD_TS_RATIO_LOW))
    rh = float(cfg.get("word_ts_neighbor_ratio_high", DEFAULT_WORD_TS_RATIO_HIGH))
    max_adj = float(cfg.get("word_ts_smooth_max_sec", DEFAULT_WORD_TS_SMOOTH_MAX_SEC))
    if mode == "detect":
        _detect_aberrant_word_timestamps(words, rl, rh)
    elif mode == "smooth":
        _detect_aberrant_word_timestamps(words, rl, rh)
        _smooth_aberrant_word_timestamps(words, rl, rh, max_adj)


def _collect_segments(result: dict[str, Any]) -> list[CanonicalTimelineSegment]:
    canonical_segments: list[CanonicalTimelineSegment] = []
    for seg_idx, raw_segment in enumerate(result.get("segments", []) or []):
        if not isinstance(raw_segment, dict):
            continue
        start = as_float(raw_segment.get("start"))
        end = as_float(raw_segment.get("end"))
        if start is None or end is None:
            continue
        if end < start:
            start, end = end, start
        segment: CanonicalTimelineSegment = {
            "text": _normalize_token(raw_segment.get("text")),
            "start": _round_ts(start),
            "end": _round_ts(end),
            "segment_id": f"s{seg_idx:05d}",
        }
        speaker = _normalize_speaker(raw_segment.get("speaker"))
        if speaker is not None:
            segment["speaker"] = speaker
        confidence = as_float(raw_segment.get("avg_logprob"))
        if confidence is not None:
            segment["confidence"] = round(confidence, 3)
        cid = raw_segment.get("chunk_id")
        if isinstance(cid, str) and cid.strip():
            segment["chunk_id"] = cid.strip()
        raw_flags = raw_segment.get("flags")
        if isinstance(raw_flags, list):
            cleaned = [str(f).strip() for f in raw_flags if str(f).strip()]
            if cleaned:
                segment["flags"] = cleaned
        canonical_segments.append(segment)
    return canonical_segments


def _next_explicit_start(words: list[dict[str, Any]], from_index: int) -> float | None:
    for idx in range(from_index + 1, len(words)):
        next_start = as_float(words[idx].get("start"))
        if next_start is not None:
            return next_start
    return None


def _collect_words_from_segments(result: dict[str, Any]) -> list[CanonicalTimelineWord]:
    words_out: list[CanonicalTimelineWord] = []
    segments = result.get("segments", [])
    if not isinstance(segments, list):
        return words_out

    word_global = 0
    for seg_idx, raw_segment in enumerate(segments):
        if not isinstance(raw_segment, dict):
            continue
        segment_words = raw_segment.get("words")
        if not isinstance(segment_words, list):
            continue

        segment_start = as_float(raw_segment.get("start"))
        segment_end = as_float(raw_segment.get("end"))
        segment_speaker = _normalize_speaker(raw_segment.get("speaker"))
        previous_word_end = segment_start

        for idx, raw_word in enumerate(segment_words):
            if not isinstance(raw_word, dict):
                continue
            token = _normalize_token(raw_word.get("word"))
            if not token:
                continue

            flags: list[str] = []
            start = as_float(raw_word.get("start"))
            end = as_float(raw_word.get("end"))

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

            w_start = _round_ts(float(start))
            w_end = _round_ts(float(end))
            if (
                segment_start is not None
                and segment_end is not None
                and (
                    w_start < segment_start - SEGMENT_BOUNDARY_TOLERANCE_SEC
                    or w_end > segment_end + SEGMENT_BOUNDARY_TOLERANCE_SEC
                )
            ):
                _append_flag(flags, "segment_boundary_ambiguous")

            word: CanonicalTimelineWord = {
                "token": token,
                "start": w_start,
                "end": w_end,
                "word_id": f"w{word_global:06d}",
                "segment_id": f"s{seg_idx:05d}",
            }
            word_global += 1

            confidence = as_float(raw_word.get("score"))
            if confidence is not None:
                word["confidence"] = round(confidence, 3)
                if confidence < LOW_CONFIDENCE_THRESHOLD:
                    _append_flag(flags, "low_confidence")

            speaker = _normalize_speaker(raw_word.get("speaker")) or segment_speaker
            if speaker is not None:
                word["speaker"] = speaker

            norm = raw_word.get("norm")
            if isinstance(norm, str) and norm.strip():
                word["norm"] = norm.strip()

            cid = raw_word.get("chunk_id")
            if isinstance(cid, str) and cid.strip():
                word["chunk_id"] = cid.strip()

            ast: AlignmentStatus = "interpolated" if "interpolated" in flags else "aligned"
            word["alignment_status"] = ast

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

    for widx, raw_word in enumerate(word_segments):
        if not isinstance(raw_word, dict):
            continue
        token = _normalize_token(raw_word.get("word"))
        if not token:
            continue
        start = as_float(raw_word.get("start"))
        end = as_float(raw_word.get("end"))
        if start is None or end is None:
            continue
        if end < start:
            end = start

        word: CanonicalTimelineWord = {
            "token": token,
            "start": _round_ts(start),
            "end": _round_ts(end),
            "word_id": f"w{widx:06d}",
            "alignment_status": "aligned",
        }

        confidence = as_float(raw_word.get("score"))
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
            tf = turn.get("flags")
            lf = last.get("flags")
            if isinstance(tf, list) and tf:
                base = lf if isinstance(lf, list) else []
                last["flags"] = list(dict.fromkeys([*base, *tf]))
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
            start = as_float(raw_turn.get("start"))
            end = as_float(raw_turn.get("end"))
            if speaker is None or start is None or end is None:
                continue
            if end < start:
                start, end = end, start
            tid = raw_turn.get("turn_id")
            turn_id = tid.strip() if isinstance(tid, str) and tid.strip() else f"t{len(turns):05d}"
            src = raw_turn.get("source")
            source = src.strip() if isinstance(src, str) and src.strip() else "pyannote"
            turn: CanonicalTimelineSpeakerTurn = {
                "speaker": speaker,
                "start": start,
                "end": end,
                "turn_id": turn_id,
                "source": source,
            }
            conf = as_float(raw_turn.get("confidence"))
            if conf is not None:
                turn["confidence"] = round(conf, 3)
            rflags = raw_turn.get("flags")
            if isinstance(rflags, list):
                cleaned = [str(f).strip() for f in rflags if str(f).strip()]
                if cleaned:
                    turn["flags"] = cleaned
            turns.append(turn)

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
                    "turn_id": f"t{len(turns):05d}",
                    "source": "segment_guess",
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
        start = as_float(raw_event.get("start"))
        end = as_float(raw_event.get("end"))
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
    pause_min = as_float(source.get("pause_min"))
    if pause_min is None or pause_min < 0:
        pause_min = DEFAULT_PAUSE_MIN

    pause_ignore_below = as_float(source.get("pause_ignore_below"))
    if pause_ignore_below is None or pause_ignore_below < 0:
        pause_ignore_below = DEFAULT_PAUSE_IGNORE_BELOW

    pause_effective_min = max(pause_min, pause_ignore_below)
    include_nonspeech = _as_bool(
        source.get("include_nonspeech"),
        default=DEFAULT_ANALYSIS_INCLUDE_NONSPEECH,
    )

    nonspeech_min_duration = as_float(source.get("nonspeech_min_duration"))
    if nonspeech_min_duration is None or nonspeech_min_duration < 0:
        nonspeech_min_duration = DEFAULT_NONSPEECH_MIN_DURATION

    ipu_min_words = as_float(source.get("ipu_min_words"))
    if ipu_min_words is None or ipu_min_words < 1:
        ipu_min_words_int = DEFAULT_IPU_MIN_WORDS
    else:
        ipu_min_words_int = int(ipu_min_words)

    ipu_min_duration = as_float(source.get("ipu_min_duration"))
    if ipu_min_duration is None or ipu_min_duration < 0:
        ipu_min_duration = DEFAULT_IPU_MIN_DURATION

    ipu_bridge_short_gaps_under = as_float(source.get("ipu_bridge_short_gaps_under"))
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

    pause_max = as_float(source.get("pause_max"))
    if pause_max is not None and pause_max > 0:
        normalized["pause_max"] = round(pause_max, 3)

    st_preset = source.get("speaker_turn_postprocess_preset")
    if isinstance(st_preset, str):
        st_preset = st_preset.strip() or None
    else:
        st_preset = None

    merge_gap = as_float(source.get("speaker_turn_merge_gap_sec_max"))
    split_wgap = as_float(source.get("speaker_turn_split_word_gap_sec"))
    if st_preset and st_preset in SPEAKER_TURN_POSTPROCESS_PRESETS:
        pr = SPEAKER_TURN_POSTPROCESS_PRESETS[st_preset]
        if merge_gap is None:
            merge_gap = as_float(pr.get("merge_gap_sec_max"))
        if split_wgap is None:
            split_wgap = as_float(pr.get("split_word_gap_sec"))
        normalized["speaker_turn_postprocess_preset"] = st_preset

    if merge_gap is not None and merge_gap >= 0:
        normalized["speaker_turn_merge_gap_sec_max"] = round(float(merge_gap), 4)
    if split_wgap is not None and split_wgap > 0:
        normalized["speaker_turn_split_word_gap_sec"] = round(float(split_wgap), 4)

    wmode = source.get("word_timestamp_stabilize_mode", "off")
    if isinstance(wmode, str):
        wmode = wmode.strip().lower() or "off"
    else:
        wmode = "off"
    if wmode in ("detect", "smooth"):
        normalized["word_timestamp_stabilize_mode"] = wmode
        wrl = as_float(source.get("word_ts_neighbor_ratio_low"))
        wrh = as_float(source.get("word_ts_neighbor_ratio_high"))
        wsm = as_float(source.get("word_ts_smooth_max_sec"))
        if wrl is None or wrl <= 0:
            wrl = DEFAULT_WORD_TS_RATIO_LOW
        if wrh is None or wrh <= 1.0:
            wrh = DEFAULT_WORD_TS_RATIO_HIGH
        if wsm is None or wsm <= 0:
            wsm = DEFAULT_WORD_TS_SMOOTH_MAX_SEC
        normalized["word_ts_neighbor_ratio_low"] = round(float(wrl), 4)
        normalized["word_ts_neighbor_ratio_high"] = round(float(wrh), 4)
        normalized["word_ts_smooth_max_sec"] = round(float(wsm), 4)

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
        prev_w: CanonicalTimelineWord | None = None
        for word in ordered_words:
            start = float(word["start"])
            end = float(word["end"])
            if end < start:
                end = start

            if prev_w is None:
                prev_w = word
                continue

            gap = start - float(prev_w["end"])
            if gap <= pause_min + EPSILON:
                if end > float(prev_w["end"]):
                    prev_w = word
                continue
            if pause_max is not None and gap > float(pause_max) + EPSILON:
                if end > float(prev_w["end"]):
                    prev_w = word
                continue

            ctx: dict[str, Any] = {
                "prev_word_id": prev_w.get("word_id"),
                "next_word_id": word.get("word_id"),
                "prev_segment_id": prev_w.get("segment_id"),
                "next_segment_id": word.get("segment_id"),
            }
            pause: CanonicalTimelinePause = {
                "start": _round_ts(float(prev_w["end"])),
                "end": _round_ts(start),
                "dur": _round_ts(gap),
                "type": "intra_speaker_word_gap",
                "context": ctx,
            }
            if speaker_key != "__global__":
                pause["speaker"] = speaker_key
            pauses.append(pause)
            prev_w = word

    pauses.sort(key=lambda pause: (pause["start"], pause["end"], pause.get("speaker", "")))
    return pauses


def _derive_transition_gap_pauses(
    words: list[CanonicalTimelineWord],
    config: CanonicalTimelineAnalysisConfig,
) -> list[CanonicalTimelinePause]:
    """Pauses entre mots de locuteurs distincts (ordre temporel global)."""
    if len(words) < 2:
        return []
    ordered = sorted(
        words,
        key=lambda item: (float(item["start"]), float(item["end"])),
    )
    pause_min = float(config["pause_effective_min"])
    pause_max = config.get("pause_max")
    out: list[CanonicalTimelinePause] = []
    for idx in range(len(ordered) - 1):
        a = ordered[idx]
        b = ordered[idx + 1]
        sp_a = _normalize_speaker(a.get("speaker"))
        sp_b = _normalize_speaker(b.get("speaker"))
        if sp_a is None or sp_b is None or sp_a == sp_b:
            continue
        gap = float(b["start"]) - float(a["end"])
        if gap <= pause_min + EPSILON:
            continue
        if pause_max is not None and gap > float(pause_max) + EPSILON:
            continue
        if gap <= EPSILON:
            continue
        out.append(
            {
                "start": _round_ts(float(a["end"])),
                "end": _round_ts(float(b["start"])),
                "dur": _round_ts(gap),
                "type": "transition_gap",
                "context": {
                    "from_speaker": sp_a,
                    "to_speaker": sp_b,
                    "prev_word_id": a.get("word_id"),
                    "next_word_id": b.get("word_id"),
                    "prev_segment_id": a.get("segment_id"),
                    "next_segment_id": b.get("segment_id"),
                },
            }
        )
    return out


def _global_nonspeech_as_pauses(
    nonspeech_intervals: list[CanonicalTimelineNonSpeechInterval],
) -> list[CanonicalTimelinePause]:
    """Expose les trous VAD comme pauses typées global_nonspeech (spec v1)."""
    out: list[CanonicalTimelinePause] = []
    for it in nonspeech_intervals:
        dur = float(it["dur"])
        if dur <= EPSILON:
            continue
        out.append(
            {
                "start": _round_ts(float(it["start"])),
                "end": _round_ts(float(it["end"])),
                "dur": _round_ts(dur),
                "type": "global_nonspeech",
                "context": {"method": it["method"], "source": "acoustic_gap"},
            }
        )
    return out


_PAUSE_TYPE_PRIORITY: dict[str, int] = {
    "intra_speaker_word_gap": 0,
    "transition_gap": 1,
    "global_nonspeech": 2,
    "intra_word_gap": 0,
}


def _merge_and_number_pauses(pause_lists: list[list[CanonicalTimelinePause]]) -> list[CanonicalTimelinePause]:
    merged: list[CanonicalTimelinePause] = []
    for lst in pause_lists:
        merged.extend(lst)
    merged.sort(
        key=lambda p: (
            p["start"],
            p["end"],
            _PAUSE_TYPE_PRIORITY.get(str(p.get("type", "")), 9),
        )
    )
    deduped: list[CanonicalTimelinePause] = []
    for p in merged:
        if deduped:
            prev = deduped[-1]
            if abs(float(prev["start"]) - float(p["start"])) <= 1e-6 and abs(
                float(prev["end"]) - float(p["end"])
            ) <= 1e-6:
                continue
        deduped.append(p)
    for i, p in enumerate(deduped):
        p["pause_id"] = f"p{i:05d}"
    return deduped


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

        current_words: list[CanonicalTimelineWord] = []
        current_start: float | None = None
        current_end: float | None = None

        def flush_current() -> None:
            nonlocal current_words, current_start, current_end
            if current_start is None or current_end is None:
                current_words = []
                current_start = None
                current_end = None
                return
            duration = max(0.0, current_end - current_start)
            n = len(current_words)
            if n < min_words or duration + EPSILON < min_duration:
                current_words = []
                current_start = None
                current_end = None
                return

            text = " ".join(
                _normalize_token(w.get("token")) for w in current_words if _normalize_token(w.get("token"))
            ).strip()
            wids: list[str] = []
            for w in current_words:
                wid = w.get("word_id")
                if isinstance(wid, str) and wid:
                    wids.append(wid)
            ipu: CanonicalTimelineIpu = {
                "start": _round_ts(current_start),
                "end": _round_ts(current_end),
                "dur": _round_ts(duration),
                "text": text,
                "n_words": n,
            }
            if wids and len(wids) == n:
                ipu["word_ids"] = wids
            ipu_flags: list[str] = []
            if any("interpolated" in (w.get("flags") or []) for w in current_words):
                ipu_flags.append("contains_interpolated")
            if any("timestamp_smoothed" in (w.get("flags") or []) for w in current_words):
                ipu_flags.append("contains_smoothed_timestamps")
            if any("timestamp_aberrant_vs_neighbors" in (w.get("flags") or []) for w in current_words):
                ipu_flags.append("contains_aberrant_timestamps")
            if ipu_flags:
                ipu["flags"] = ipu_flags
            if speaker_key != "__global__":
                ipu["speaker"] = speaker_key
            ipus.append(ipu)

            current_words = []
            current_start = None
            current_end = None

        for word in ordered_words:
            start = float(word["start"])
            end = float(word["end"])
            if end < start:
                end = start

            if current_start is None or current_end is None:
                current_start = start
                current_end = end
                current_words = [word]
                continue

            gap = start - current_end
            if gap > split_threshold + EPSILON:
                flush_current()
                current_start = start
                current_end = end
                current_words = [word]
                continue

            current_end = max(current_end, end)
            current_words.append(word)

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
                "end_prev": _round_ts(from_end),
                "start_next": _round_ts(to_start),
            }
        )
    return transitions


def _derive_overlaps_from_events(
    events: list[CanonicalTimelineEvent],
) -> list[CanonicalTimelineOverlap]:
    overlaps: list[CanonicalTimelineOverlap] = []
    oidx = 0
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
            "overlap_id": f"o{oidx:05d}",
        }
        oidx += 1
        overlaps.append(overlap)
    return overlaps


def _intervals_overlap_time(a0: float, a1: float, b0: float, b1: float) -> bool:
    """Chevauchement strict d'intervalles [a0,a1] et [b0,b1] (temps positifs)."""
    if a1 <= a0 + EPSILON or b1 <= b0 + EPSILON:
        return False
    return not (a1 <= b0 + EPSILON or a0 >= b1 - EPSILON)


def _apply_overlap_context_flags(
    pauses: list[CanonicalTimelinePause],
    ipus: list[CanonicalTimelineIpu],
    overlaps: list[CanonicalTimelineOverlap],
) -> None:
    """WX-601: marque pauses/IPU qui intersectent une zone d overlap (metriques defendables avec stats_clean)."""
    if not overlaps:
        return
    for pause in pauses:
        ps = float(pause["start"])
        pe = float(pause["end"])
        for ov in overlaps:
            if _intervals_overlap_time(ps, pe, float(ov["start"]), float(ov["end"])):
                fl = list(pause.get("flags") or [])
                if "overlap_context" not in fl:
                    fl.append("overlap_context")
                pause["flags"] = fl
                break
    for ipu in ipus:
        ia = float(ipu["start"])
        ib = float(ipu["end"])
        for ov in overlaps:
            if _intervals_overlap_time(ia, ib, float(ov["start"]), float(ov["end"])):
                fl = list(ipu.get("flags") or [])
                if "overlap_context" not in fl:
                    fl.append("overlap_context")
                ipu["flags"] = fl
                break


def _mean_float(xs: list[float]) -> float:
    return float(sum(xs) / len(xs)) if xs else 0.0


def _median_float(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    n = len(s)
    mid = n // 2
    if n % 2:
        return float(s[mid])
    return float((s[mid - 1] + s[mid]) / 2.0)


def _p90_float(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = max(0, min(len(s) - 1, int(round(0.9 * (len(s) - 1)))))
    return float(s[idx])


def _compute_timeline_analysis_stats(
    pauses: list[CanonicalTimelinePause],
    ipus: list[CanonicalTimelineIpu],
    overlaps: list[CanonicalTimelineOverlap],
    *,
    exclude_overlap_context: bool,
) -> dict[str, Any]:
    """Agregats pauses/IPU ; si exclude_overlap_context, exclut les objets tagues overlap_context."""

    def _pause_keep(p: CanonicalTimelinePause) -> bool:
        if not exclude_overlap_context:
            return True
        return "overlap_context" not in (p.get("flags") or [])

    def _ipu_keep(i: CanonicalTimelineIpu) -> bool:
        if not exclude_overlap_context:
            return True
        return "overlap_context" not in (i.get("flags") or [])

    p_sel = [p for p in pauses if _pause_keep(p)]
    i_sel = [i for i in ipus if _ipu_keep(i)]

    p_durs = [float(p["dur"]) for p in p_sel if p.get("dur") is not None]
    i_durs = [float(i["dur"]) for i in i_sel if i.get("dur") is not None]
    i_words = [int(i["n_words"]) for i in i_sel if i.get("n_words") is not None]

    ov_dur = sum(float(o["dur"]) for o in overlaps if o.get("dur") is not None)

    return {
        "pauses": {
            "n": len(p_sel),
            "mean_dur": round(_mean_float(p_durs), 4) if p_durs else 0.0,
            "median_dur": round(_median_float(p_durs), 4) if p_durs else 0.0,
            "p90_dur": round(_p90_float(p_durs), 4) if p_durs else 0.0,
        },
        "ipus": {
            "n": len(i_sel),
            "mean_dur": round(_mean_float(i_durs), 4) if i_durs else 0.0,
            "median_dur": round(_median_float(i_durs), 4) if i_durs else 0.0,
            "mean_n_words": round(_mean_float([float(x) for x in i_words]), 4) if i_words else 0.0,
        },
        "overlaps": {
            "n_zones": len(overlaps),
            "total_dur": round(ov_dur, 4),
        },
    }


def _word_touches_overlap_zone(word: CanonicalTimelineWord, overlaps: list[CanonicalTimelineOverlap]) -> bool:
    if not overlaps:
        return False
    ws = float(word["start"])
    we = float(word["end"])
    for ov in overlaps:
        if _intervals_overlap_time(ws, we, float(ov["start"]), float(ov["end"])):
            return True
    return False


def _timeline_duration_sec(
    words: list[CanonicalTimelineWord],
    segments: list[CanonicalTimelineSegment],
) -> float:
    t = 0.0
    for w in words:
        t = max(t, float(w["end"]))
    for seg in segments:
        if seg.get("end") is not None:
            t = max(t, float(seg["end"]))
    return t


def _metrics_by_speaker(
    words: list[CanonicalTimelineWord],
    overlaps: list[CanonicalTimelineOverlap],
    *,
    exclude_words_touching_overlap: bool,
) -> dict[str, Any]:
    """WX-602 v1: debit (mots/min) et duree de parole par locuteur."""
    by_sp: dict[str, list[CanonicalTimelineWord]] = defaultdict(list)
    for w in words:
        if exclude_words_touching_overlap and _word_touches_overlap_zone(w, overlaps):
            continue
        sp = w.get("speaker")
        key = sp.strip() if isinstance(sp, str) and sp.strip() else "__unassigned__"
        by_sp[key].append(w)

    out: dict[str, Any] = {}
    for sp, ws in sorted(by_sp.items()):
        speech = 0.0
        for w in ws:
            a = float(w["start"])
            b = float(w["end"])
            if b < a:
                a, b = b, a
            speech += max(0.0, b - a)
        n = len(ws)
        wpm = (n / (speech / 60.0)) if speech > EPSILON else 0.0
        out[sp] = {
            "n_words": n,
            "speech_dur_sec": round(speech, 4),
            "words_per_min": round(wpm, 4),
        }
    return out


def _metrics_interaction(
    transitions: list[CanonicalTimelineTransition],
    overlaps: list[CanonicalTimelineOverlap],
    duration_sec: float,
) -> dict[str, Any]:
    """WX-602 v1: transitions, chevauchements, gaps signes."""
    dur = duration_sec if duration_sec > EPSILON else 1.0
    ov_dur = sum(float(o["dur"]) for o in overlaps if o.get("dur") is not None)
    gaps: list[float] = []
    for tr in transitions:
        if tr.get("gap") is None:
            continue
        gaps.append(float(tr["gap"]))
    neg = [g for g in gaps if g < -EPSILON]
    pos = [g for g in gaps if g >= -EPSILON]
    return {
        "n_transitions": len(transitions),
        "n_overlap_like_transitions": len(neg),
        "mean_gap_sec": round(_mean_float(gaps), 4) if gaps else 0.0,
        "mean_positive_gap_sec": round(_mean_float(pos), 4) if pos else 0.0,
        "overlap_time_ratio": round(ov_dur / dur, 4),
    }


def _enrich_stats_speaker_interaction(
    block: dict[str, Any],
    words: list[CanonicalTimelineWord],
    transitions: list[CanonicalTimelineTransition],
    overlaps: list[CanonicalTimelineOverlap],
    segments: list[CanonicalTimelineSegment],
    *,
    exclude_words_touching_overlap: bool,
) -> None:
    duration_sec = _timeline_duration_sec(words, segments)
    block["speakers"] = _metrics_by_speaker(
        words,
        overlaps,
        exclude_words_touching_overlap=exclude_words_touching_overlap,
    )
    block["interaction"] = _metrics_interaction(transitions, overlaps, duration_sec)


def _finalize_timeline_ordering(
    segments: list[CanonicalTimelineSegment],
    words: list[CanonicalTimelineWord],
    speaker_turns: list[CanonicalTimelineSpeakerTurn],
) -> None:
    """Tri (start,end) et renumerotation segment_id coherente avec les mots."""
    if not segments:
        sort_temporal_words(words)
        sort_temporal_speaker_turns(speaker_turns)
        return
    for seg in segments:
        oid = seg.get("segment_id")
        if isinstance(oid, str):
            seg["_old_seg_id"] = oid
    sort_temporal_segments(segments)
    old_to_new: dict[str, str] = {}
    for i, seg in enumerate(segments):
        oid = seg.pop("_old_seg_id", None)
        nid = f"s{i:05d}"
        if isinstance(oid, str):
            old_to_new[oid] = nid
        seg["segment_id"] = nid
    remap_word_segment_ids_after_segment_sort(words, old_to_new)
    sort_temporal_words(words)
    sort_temporal_speaker_turns(speaker_turns)


def _copy_speaker_turn(turn: CanonicalTimelineSpeakerTurn) -> CanonicalTimelineSpeakerTurn:
    ct: dict[str, Any] = dict(turn)
    if "flags" in ct and isinstance(ct["flags"], list):
        ct["flags"] = list(ct["flags"])
    return ct  # type: ignore[return-value]


def _append_speaker_turn_flag(turn: CanonicalTimelineSpeakerTurn, flag: str) -> None:
    existing = turn.get("flags")
    if isinstance(existing, list):
        if flag not in existing:
            existing.append(flag)
    else:
        turn["flags"] = [flag]


def _renumber_speaker_turn_ids(turns: list[CanonicalTimelineSpeakerTurn]) -> None:
    for i, turn in enumerate(turns):
        turn["turn_id"] = f"t{i:05d}"


def _merge_adjacent_same_speaker_short_gap(
    turns: list[CanonicalTimelineSpeakerTurn],
    merge_max_sec: float,
) -> list[CanonicalTimelineSpeakerTurn]:
    """Fusionne deux tours consécutifs même locuteur si 0 <= gap < merge_max_sec."""
    if not turns:
        return []
    ordered = sorted(
        turns,
        key=lambda t: (float(t["start"]), float(t["end"]), t["speaker"]),
    )
    out: list[CanonicalTimelineSpeakerTurn] = []
    for turn in ordered:
        if not out:
            out.append(_copy_speaker_turn(turn))
            continue
        last = out[-1]
        if turn["speaker"] == last["speaker"]:
            gap = float(turn["start"]) - float(last["end"])
            if gap >= -EPSILON and gap < merge_max_sec:
                if float(turn["end"]) > float(last["end"]):
                    last["end"] = _round_ts(float(turn["end"]))
                _append_speaker_turn_flag(last, "speaker_turn_merged_adjacent")
                continue
        out.append(_copy_speaker_turn(turn))
    return out


def _split_turns_by_word_gap(
    turns: list[CanonicalTimelineSpeakerTurn],
    words: list[CanonicalTimelineWord],
    split_gap_sec: float,
) -> list[CanonicalTimelineSpeakerTurn]:
    """Découpe un tour si le silence entre deux mots du même locuteur dépasse split_gap_sec."""
    out: list[CanonicalTimelineSpeakerTurn] = []
    for turn in turns:
        sp = turn["speaker"]
        ts, te = float(turn["start"]), float(turn["end"])
        tw: list[CanonicalTimelineWord] = []
        for w in words:
            if w.get("speaker") != sp:
                continue
            ws, we = float(w["start"]), float(w["end"])
            if we > ts + EPSILON and ws < te - EPSILON:
                tw.append(w)
        tw.sort(key=lambda x: float(x["start"]))
        if len(tw) < 2:
            out.append(_copy_speaker_turn(turn))
            continue
        runs: list[list[CanonicalTimelineWord]] = []
        cur: list[CanonicalTimelineWord] = [tw[0]]
        for i in range(len(tw) - 1):
            gap = float(tw[i + 1]["start"]) - float(tw[i]["end"])
            if gap > split_gap_sec:
                runs.append(cur)
                cur = [tw[i + 1]]
            else:
                cur.append(tw[i + 1])
        runs.append(cur)
        if len(runs) == 1:
            out.append(_copy_speaker_turn(turn))
            continue
        for run in runs:
            nt = _copy_speaker_turn(turn)
            rs = max(ts, float(run[0]["start"]))
            re = min(te, float(run[-1]["end"]))
            nt["start"] = _round_ts(rs)
            nt["end"] = _round_ts(re)
            _append_speaker_turn_flag(nt, "speaker_turn_split_word_gap")
            out.append(nt)
    return out


def _postprocess_speaker_turns_if_config(
    speaker_turns: list[CanonicalTimelineSpeakerTurn],
    words: list[CanonicalTimelineWord],
    config: CanonicalTimelineAnalysisConfig,
) -> None:
    cfg = dict(config)
    merge_max = cfg.get("speaker_turn_merge_gap_sec_max")
    split_gap = cfg.get("speaker_turn_split_word_gap_sec")
    if merge_max is None and split_gap is None:
        return
    if merge_max is not None:
        speaker_turns[:] = _merge_adjacent_same_speaker_short_gap(speaker_turns, float(merge_max))
    if split_gap is not None:
        speaker_turns[:] = _split_turns_by_word_gap(speaker_turns, words, float(split_gap))
    _renumber_speaker_turn_ids(speaker_turns)


def build_canonical_timeline(
    result: dict[str, Any],
    analysis_config: dict[str, Any] | None = None,
) -> CanonicalTimeline:
    segments = _collect_segments(result)
    words = _collect_words_from_segments(result)
    if not words:
        words = _collect_words_from_word_segments(result)
    speaker_turns = _derive_speaker_turns(result, segments)
    _finalize_timeline_ordering(segments, words, speaker_turns)
    prepared_config, analysis_config_extras = prepare_timeline_analysis_config(
        analysis_config, words
    )
    normalized_analysis_config = _normalize_analysis_config(prepared_config)
    if "analysis_preset" in analysis_config_extras:
        normalized_analysis_config["analysis_preset"] = analysis_config_extras["analysis_preset"]
    if "pause_calibration" in analysis_config_extras:
        normalized_analysis_config["pause_calibration"] = analysis_config_extras["pause_calibration"]
    _postprocess_speaker_turns_if_config(speaker_turns, words, normalized_analysis_config)
    sort_temporal_speaker_turns(speaker_turns)
    _apply_word_timestamp_stabilization(words, normalized_analysis_config)
    sort_temporal_words(words)
    lexical_pauses = _derive_lexical_pauses(words, normalized_analysis_config)
    transition_gap_pauses = _derive_transition_gap_pauses(words, normalized_analysis_config)
    nonspeech_intervals = _derive_nonspeech_intervals(
        segments,
        words,
        normalized_analysis_config,
    )
    global_nonspeech_pauses = _global_nonspeech_as_pauses(nonspeech_intervals)
    pauses = _merge_and_number_pauses(
        [lexical_pauses, transition_gap_pauses, global_nonspeech_pauses],
    )
    events = _dedupe_events(
        _normalize_existing_events(result)
        + _derive_overlap_events(speaker_turns)
        + _nonspeech_events(nonspeech_intervals)
    )
    ipus = _derive_ipus(words, normalized_analysis_config)
    transitions = _derive_transitions(speaker_turns)
    overlaps = _derive_overlaps_from_events(events)
    _apply_overlap_context_flags(pauses, ipus, overlaps)
    stats = _compute_timeline_analysis_stats(pauses, ipus, overlaps, exclude_overlap_context=False)
    stats_clean = _compute_timeline_analysis_stats(pauses, ipus, overlaps, exclude_overlap_context=True)
    _enrich_stats_speaker_interaction(
        stats, words, transitions, overlaps, segments, exclude_words_touching_overlap=False
    )
    _enrich_stats_speaker_interaction(
        stats_clean, words, transitions, overlaps, segments, exclude_words_touching_overlap=True
    )

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
        "stats": stats,
        "stats_clean": stats_clean,
    }
    timeline["analysis"] = analysis
    return timeline
