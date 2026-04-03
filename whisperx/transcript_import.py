"""WX-718 — Parsers pour l'import de transcripts existants (SRT, VTT, JSON WhisperX / générique).

Produit des structures compatibles avec build_canonical_timeline de whisperx.timeline.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any


def _timecode_srt_to_sec(tc: str) -> float:
    """HH:MM:SS,mmm → float secondes."""
    tc = tc.strip().replace(",", ".")
    parts = tc.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


def _timecode_vtt_to_sec(tc: str) -> float:
    """HH:MM:SS.mmm ou MM:SS.mmm → float secondes."""
    tc = tc.strip()
    parts = tc.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    if len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(parts[0])


def parse_srt(path: str) -> list[dict[str, Any]]:
    """Parse un fichier SRT. Retourne une liste de segments WhisperX-compatibles."""
    with open(path, encoding="utf-8-sig") as f:
        content = f.read()

    segments: list[dict[str, Any]] = []
    # Chaque bloc : numéro \n HH:MM:SS,mmm --> HH:MM:SS,mmm \n texte(s) \n
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
        # Trouver la ligne timecode (peut ne pas être la 2e si le numéro est absent)
        tc_line = None
        text_lines: list[str] = []
        for i, line in enumerate(lines):
            if "-->" in line:
                tc_line = line
                text_lines = lines[i + 1 :]
                break
        if tc_line is None:
            continue
        match = re.match(
            r"([\d:,]+)\s*-->\s*([\d:,]+)",
            tc_line,
        )
        if not match:
            continue
        start = _timecode_srt_to_sec(match.group(1))
        end = _timecode_srt_to_sec(match.group(2))
        text = " ".join(line.strip() for line in text_lines if line.strip())
        if not text:
            continue
        segments.append({"start": start, "end": end, "text": text})
    return segments


def parse_vtt(path: str) -> list[dict[str, Any]]:
    """Parse un fichier WebVTT. Retourne une liste de segments WhisperX-compatibles."""
    with open(path, encoding="utf-8-sig") as f:
        content = f.read()

    # Supprimer l'en-tête WEBVTT et les métadonnées
    content = re.sub(r"^WEBVTT[^\n]*\n", "", content, count=1)

    segments: list[dict[str, Any]] = []
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if not lines:
            continue
        tc_line = None
        text_lines: list[str] = []
        for i, line in enumerate(lines):
            if "-->" in line:
                tc_line = line
                text_lines = lines[i + 1 :]
                break
        if tc_line is None:
            continue
        # Extraire uniquement les timestamps (ignorer les cue settings après)
        tc_part = tc_line.split(" line:")[0].split(" position:")[0].split(" align:")[0]
        match = re.match(r"([\d:.]+)\s*-->\s*([\d:.]+)", tc_part)
        if not match:
            continue
        start = _timecode_vtt_to_sec(match.group(1))
        end = _timecode_vtt_to_sec(match.group(2))
        # Supprimer les balises HTML (<b>, <i>, <c.speaker>, etc.)
        text = " ".join(
            re.sub(r"<[^>]+>", "", line).strip()
            for line in text_lines
            if line.strip() and not line.strip().startswith("NOTE")
        )
        text = text.strip()
        if not text:
            continue
        segments.append({"start": start, "end": end, "text": text})
    return segments


def parse_json_transcript(path: str) -> list[dict[str, Any]]:
    """
    Parse un JSON de transcript.

    Formats acceptés :
    - WhisperX natif  : { "segments": [...] }
    - timeline.json   : { "speaker_turns": [...] } ou { "segments": [...] }
    - Générique       : liste plate de { "start", "end", "text" }
    """
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return _normalize_segments(data)

    if isinstance(data, dict):
        # WhisperX / générique
        if "segments" in data:
            return _normalize_segments(data["segments"])
        # timeline.json — speaker_turns
        if "speaker_turns" in data:
            turns = data["speaker_turns"]
            segments = []
            for t in turns:
                start = t.get("start") or (t.get("start_ms", 0) / 1000.0)
                end = t.get("end") or (t.get("end_ms", 0) / 1000.0)
                text = t.get("text", "")
                speaker = t.get("speaker")
                seg: dict[str, Any] = {"start": start, "end": end, "text": text}
                if speaker:
                    seg["speaker"] = speaker
                segments.append(seg)
            return segments

    raise ValueError(f"Format JSON non reconnu dans {os.path.basename(path)}")


def _normalize_segments(raw: list[Any]) -> list[dict[str, Any]]:
    """Normalise une liste de segments vers le format WhisperX minimal."""
    segments = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        start = item.get("start") or item.get("startMs", 0) / 1000.0 if "startMs" in item else item.get("start", 0)
        end = item.get("end") or item.get("endMs", 0) / 1000.0 if "endMs" in item else item.get("end", 0)
        text = item.get("text", "")
        seg: dict[str, Any] = {"start": float(start), "end": float(end), "text": str(text)}
        if "speaker" in item and item["speaker"]:
            seg["speaker"] = item["speaker"]
        if "words" in item and isinstance(item["words"], list):
            seg["words"] = item["words"]
        segments.append(seg)
    return segments


def segments_to_whisperx_result(
    segments: list[dict[str, Any]],
    audio_path: str,
    language: str = "unknown",
) -> dict[str, Any]:
    """
    Construit un dict compatible avec le résultat WhisperX (shape attendue par
    build_canonical_timeline et les writers JSON/SRT/VTT).
    """
    return {
        "segments": segments,
        "word_segments": [],
        "language": language,
        "source": "imported_transcript",
        "audio_path": audio_path,
    }


def detect_transcript_format(path: str) -> str:
    """Déduit le format à partir de l'extension. Retourne 'srt', 'vtt' ou 'json'."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".srt":
        return "srt"
    if ext in (".vtt", ".webvtt"):
        return "vtt"
    if ext == ".json":
        return "json"
    raise ValueError(f"Extension non supportée pour l'import : {ext!r} (attendu : .srt, .vtt, .json)")


def load_transcript(path: str) -> list[dict[str, Any]]:
    """Point d'entrée unifié : charge un transcript SRT, VTT ou JSON."""
    fmt = detect_transcript_format(path)
    if fmt == "srt":
        return parse_srt(path)
    if fmt == "vtt":
        return parse_vtt(path)
    return parse_json_transcript(path)
