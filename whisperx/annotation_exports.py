"""
Optional annotation exports: RTTM (NIST), Praat TextGrid, ELAN EAF from canonical speaker_turns.
"""

from __future__ import annotations

import os
import re
import xml.sax.saxutils
from datetime import datetime, timezone
from typing import Any

__all__ = [
    "collect_speaker_turns",
    "write_annotation_exports",
]


def _normalize_turn(raw: Any) -> dict[str, float | str] | None:
    if not isinstance(raw, dict):
        return None
    sp = raw.get("speaker")
    if sp is None:
        return None
    speaker = str(sp).strip()
    if not speaker:
        return None
    try:
        start = float(raw.get("start", 0.0))
        end = float(raw.get("end", 0.0))
    except (TypeError, ValueError):
        return None
    if end < start:
        start, end = end, start
    return {"speaker": speaker, "start": start, "end": end}


def collect_speaker_turns(result: dict[str, Any]) -> list[dict[str, float | str]]:
    """Return speaker turns from timeline.speaker_turns, top-level speaker_turns, or segment speakers."""
    timeline = result.get("timeline")
    if isinstance(timeline, dict):
        st = timeline.get("speaker_turns")
        if isinstance(st, list) and st:
            out = [_normalize_turn(x) for x in st]
            return [x for x in out if x is not None]

    st = result.get("speaker_turns")
    if isinstance(st, list) and st:
        out = [_normalize_turn(x) for x in st]
        return [x for x in out if x is not None]

    segments = result.get("segments")
    if not isinstance(segments, list):
        return []

    turns: list[dict[str, float | str]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        sp = seg.get("speaker")
        if sp is None or not str(sp).strip():
            continue
        try:
            start = float(seg["start"])
            end = float(seg["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end < start:
            start, end = end, start
        speaker = str(sp).strip()
        if turns and turns[-1]["speaker"] == speaker and float(turns[-1]["end"]) >= start - 1e-6:
            turns[-1]["end"] = max(float(turns[-1]["end"]), end)
        else:
            turns.append({"speaker": speaker, "start": start, "end": end})
    return turns


def _file_stem(audio_path: str) -> str:
    return os.path.splitext(os.path.basename(audio_path))[0]


def _safe_rttm_id(name: str) -> str:
    s = re.sub(r"\s+", "_", name.strip())
    return s or "audio"


def _xmax_from_turns(turns: list[dict[str, float | str]], result: dict[str, Any]) -> float:
    mx = 0.0
    for t in turns:
        mx = max(mx, float(t["end"]))
    segs = result.get("segments")
    if isinstance(segs, list):
        for seg in segs:
            if isinstance(seg, dict) and "end" in seg:
                try:
                    mx = max(mx, float(seg["end"]))
                except (TypeError, ValueError):
                    pass
    return mx if mx > 0 else 1.0


def _escape_textgrid_label(text: str) -> str:
    return text.replace('"', '""')


def write_rttm(path: str, file_id: str, turns: list[dict[str, float | str]]) -> None:
    """NIST RTTM-style lines (SPEAKER ...)."""
    fid = _safe_rttm_id(file_id)
    with open(path, "w", encoding="utf-8") as handle:
        for turn in turns:
            start = float(turn["start"])
            dur = max(0.0, float(turn["end"]) - start)
            sp = str(turn["speaker"])
            # SPEAKER file channel start duration ortho type name conf slat
            handle.write(
                f"SPEAKER {fid} 1 {start:.3f} {dur:.3f} <NA> <NA> {sp} <NA> <NA>\n"
            )


def write_textgrid(path: str, turns: list[dict[str, float | str]], xmax: float) -> None:
    """Praat long TextGrid with one IntervalTier `Speaker` (long text file format)."""
    lines: list[str] = [
        'File type = "ooTextFile"',
        'Object class = "TextGrid"',
        "",
        "xmin = 0",
        f"xmax = {xmax:.6f}",
        "tiers? <exists>",
        "size = 1",
        "item []:",
        "    item [1]:",
        '        class = "IntervalTier"',
        '        name = "Speaker"',
        "        xmin = 0",
        f"        xmax = {xmax:.6f}",
        f"        intervals: size = {len(turns)}",
    ]
    for i, turn in enumerate(turns, start=1):
        start = float(turn["start"])
        end = float(turn["end"])
        label = _escape_textgrid_label(str(turn["speaker"]))
        lines.append(f"        intervals [{i}]:")
        lines.append(f"            xmin = {start:.6f}")
        lines.append(f"            xmax = {end:.6f}")
        lines.append(f'            text = "{label}"')
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def write_eaf(path: str, turns: list[dict[str, float | str]], xmax: float) -> None:
    """ELAN EAF 3.0 with one linguistic tier; times in milliseconds."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    times_ms: list[int] = [0, int(round(xmax * 1000))]
    for t in turns:
        times_ms.append(int(round(float(t["start"]) * 1000)))
        times_ms.append(int(round(float(t["end"]) * 1000)))
    times_ms = sorted(set(times_ms))
    slot_by_ms = {ms: f"ts{idx}" for idx, ms in enumerate(times_ms)}

    def slot_id(ms: int) -> str:
        return slot_by_ms[ms]

    header_slots = "".join(
        f'      <TIME_SLOT TIME_SLOT_ID="{slot_id(ms)}" TIME_VALUE="{ms}"/>\n'
        for ms in times_ms
    )

    annotations_xml = []
    for idx, turn in enumerate(turns):
        s_ms = int(round(float(turn["start"]) * 1000))
        e_ms = int(round(float(turn["end"]) * 1000))
        val = xml.sax.saxutils.escape(str(turn["speaker"]))
        annotations_xml.append(
            f'    <ANNOTATION>\n'
            f'      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a{idx}" TIME_SLOT_REF1="{slot_id(s_ms)}" TIME_SLOT_REF2="{slot_id(e_ms)}">\n'
            f"        <ANNOTATION_VALUE>{val}</ANNOTATION_VALUE>\n"
            f"      </ALIGNABLE_ANNOTATION>\n"
            f"    </ANNOTATION>\n"
        )

    body = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<ANNOTATION_DOCUMENT AUTHOR="whisperx" DATE="{now}" VERSION="0" FORMAT="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
        f"  <HEADER TIME_UNITS=\"milliseconds\">\n"
        f"    <TIME_ORDER>\n"
        f"{header_slots}"
        f"    </TIME_ORDER>\n"
        f"  </HEADER>\n"
        f'  <TIER TIER_ID="speaker" LINGUISTIC_TYPE_REF="lt-speaker">\n'
        f"{''.join(annotations_xml)}"
        f"  </TIER>\n"
        f'  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="lt-speaker" TIME_ALIGNABLE="true"/>\n'
        f"</ANNOTATION_DOCUMENT>\n"
    )
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(body)


def write_annotation_exports(
    output_dir: str,
    audio_path: str,
    result: dict[str, Any],
    *,
    rttm: bool = False,
    textgrid: bool = False,
    eaf: bool = False,
) -> dict[str, str]:
    """
    Write selected annotation files next to other exports. Returns map label -> path.
    """
    if not (rttm or textgrid or eaf):
        return {}
    turns = collect_speaker_turns(result)
    stem = _file_stem(audio_path)
    xmax = _xmax_from_turns(turns, result)
    out: dict[str, str] = {}
    os.makedirs(output_dir, exist_ok=True)

    if not turns:
        return {}

    if rttm:
        p = os.path.join(output_dir, f"{stem}.rttm")
        write_rttm(p, stem, turns)
        out["rttm"] = p
    if textgrid:
        p = os.path.join(output_dir, f"{stem}.TextGrid")
        write_textgrid(p, turns, xmax)
        out["textgrid"] = p
    if eaf:
        p = os.path.join(output_dir, f"{stem}.eaf")
        write_eaf(p, turns, xmax)
        out["eaf"] = p
    return out
