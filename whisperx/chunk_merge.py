"""
Pure helpers for merging media-level transcription chunks (no torch dependency).

WX-604: plan de fenêtres aligné sur transcribe, manifest disque, export JSONL par chunk.
"""

from __future__ import annotations

import json
import os
import tempfile
from typing import Any

from whisperx.utils import as_float

CHUNK_MANIFEST_VERSION = 1
CHUNK_RAW_ARTIFACT_FMT = "chunk_{:04d}.raw.json"


def _offset_words_in_segment(segment: dict[str, Any], delta_sec: float) -> None:
    """Décale les timestamps des mots comme le segment (temps locaux du chunk → timeline globale)."""
    words = segment.get("words")
    if not isinstance(words, list):
        return
    for raw in words:
        if not isinstance(raw, dict):
            continue
        for key in ("start", "end"):
            if raw.get(key) is None:
                continue
            raw[key] = round(as_float(raw.get(key), 0.0) + delta_sec, 3)


def _offset_and_filter_chunk_segments(
    chunk_result: dict[str, Any],
    chunk_start_sec: float,
    selection_end_sec: float | None,
) -> list[dict[str, Any]]:
    merged_segments: list[dict[str, Any]] = []
    for segment in chunk_result.get("segments", []):
        if not isinstance(segment, dict):
            continue
        next_segment = dict(segment)
        raw_words = next_segment.get("words")
        if isinstance(raw_words, list):
            next_segment["words"] = [dict(w) if isinstance(w, dict) else w for w in raw_words]

        start = as_float(next_segment.get("start"), 0.0) + chunk_start_sec
        end = as_float(next_segment.get("end"), start) + chunk_start_sec
        if end < start:
            start, end = end, start
        midpoint = (start + end) / 2.0
        if selection_end_sec is not None and midpoint > selection_end_sec + 1e-6:
            continue
        next_segment["start"] = round(start, 3)
        next_segment["end"] = round(end, 3)
        _offset_words_in_segment(next_segment, chunk_start_sec)
        merged_segments.append(next_segment)
    return merged_segments


def compute_media_chunk_specs(
    duration_sec: float,
    pipeline_chunk_seconds: float,
    pipeline_chunk_overlap_seconds: float,
) -> list[dict[str, Any]]:
    """
    Même découpage que `_transcribe_with_media_chunking` (fenêtres + fin de fichier).
    Retourne une entrée par chunk: index (1-based), start_sec, duration_sec, selection_end_sec.
    """
    step_sec = pipeline_chunk_seconds - pipeline_chunk_overlap_seconds
    if step_sec <= 0:
        raise ValueError("pipeline chunk step must be > 0 seconds")
    specs: list[dict[str, Any]] = []
    chunk_start = 0.0
    chunk_index = 0
    while chunk_start < duration_sec - 1e-6:
        remaining = duration_sec - chunk_start
        chunk_duration = min(pipeline_chunk_seconds, remaining)
        selection_end = None
        if chunk_start + step_sec < duration_sec - 1e-6:
            selection_end = chunk_start + step_sec
        chunk_index += 1
        specs.append(
            {
                "index": chunk_index,
                "start_sec": round(chunk_start, 3),
                "duration_sec": round(chunk_duration, 3),
                "selection_end_sec": round(selection_end, 3) if selection_end is not None else None,
            }
        )
        if chunk_start + pipeline_chunk_seconds >= duration_sec - 1e-6:
            break
        chunk_start += step_sec
    return specs


def chunk_raw_artifact_name(chunk_index: int) -> str:
    return CHUNK_RAW_ARTIFACT_FMT.format(chunk_index)


def new_chunk_manifest(
    audio_path: str,
    duration_sec: float,
    pipeline_chunk_seconds: float,
    overlap_sec: float,
    step_sec: float,
    specs: list[dict[str, Any]],
) -> dict[str, Any]:
    chunks: list[dict[str, Any]] = []
    for s in specs:
        idx = int(s["index"])
        chunks.append(
            {
                "index": idx,
                "start_sec": s["start_sec"],
                "duration_sec": s["duration_sec"],
                "selection_end_sec": s["selection_end_sec"],
                "status": "pending",
                "artifact": chunk_raw_artifact_name(idx),
            }
        )
    return {
        "schema_version": CHUNK_MANIFEST_VERSION,
        "audio_path": os.path.abspath(audio_path),
        "duration_sec": round(float(duration_sec), 3),
        "pipeline_chunk_seconds": round(float(pipeline_chunk_seconds), 3),
        "overlap_seconds": round(float(overlap_sec), 3),
        "step_seconds": round(float(step_sec), 3),
        "chunks": chunks,
    }


def manifest_compatible_with_run(
    manifest: dict[str, Any],
    audio_path: str,
    duration_sec: float,
    pipeline_chunk_seconds: float,
    overlap_sec: float,
) -> bool:
    if manifest.get("schema_version") != CHUNK_MANIFEST_VERSION:
        return False
    if abs(float(manifest.get("duration_sec", 0.0)) - float(duration_sec)) > 0.5:
        return False
    if abs(float(manifest.get("pipeline_chunk_seconds", 0.0)) - float(pipeline_chunk_seconds)) > 1e-2:
        return False
    if abs(float(manifest.get("overlap_seconds", 0.0)) - float(overlap_sec)) > 1e-2:
        return False
    if os.path.basename(str(manifest.get("audio_path", ""))) != os.path.basename(audio_path):
        return False
    return True


def read_chunk_manifest(path: str) -> dict[str, Any] | None:
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else None


def write_chunk_manifest(path: str, manifest: dict[str, Any]) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="chunk_manifest_", suffix=".json", dir=parent or None)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_words_jsonl_for_segments(path: str, segments: list[dict[str, Any]]) -> None:
    """Une ligne JSON par mot (timestamps déjà globaux)."""
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        for seg in segments:
            words = seg.get("words") if isinstance(seg, dict) else None
            if not isinstance(words, list):
                continue
            for w in words:
                if isinstance(w, dict):
                    handle.write(json.dumps(w, ensure_ascii=False) + "\n")


def save_chunk_raw_result(state_dir: str, chunk_index: int, chunk_result: dict[str, Any]) -> str:
    """Écrit le résultat ASR brut (temps locaux) pour reprise."""
    os.makedirs(state_dir, exist_ok=True)
    name = chunk_raw_artifact_name(chunk_index)
    path = os.path.join(state_dir, name)
    payload = {
        "segments": chunk_result.get("segments"),
        "language": chunk_result.get("language"),
    }
    fd, tmp = tempfile.mkstemp(prefix="chunk_raw_", suffix=".json", dir=state_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return path


def load_chunk_raw_result(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}
