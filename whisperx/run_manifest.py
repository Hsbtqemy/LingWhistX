"""
Run manifest v1 — métadonnées reproductibles pour un run (spec backlog WX-501).

Convention temps: secondes flottantes, quantifiées à la milliseconde pour stabilité:
    quantize_time_seconds(t) == round(t, 3)
Les exports peuvent aussi convertir en millisecondes entières (arrondi).
Référentiel: temps global du média (pas du chunk), sauf champs explicitement « local ».
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NotRequired, TypedDict

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

RUN_MANIFEST_SCHEMA_VERSION = 1

# Millisecond precision (stable floats in JSON)
TIME_DECIMALS = 3


def quantize_time_seconds(t: float) -> float:
    """Quantize a timestamp in seconds to 1 ms (WhisperX-style stability)."""
    if t != t:  # NaN
        raise ValueError("timestamp is NaN")
    return round(float(t), TIME_DECIMALS)


class MediaFingerprintV1(TypedDict, total=False):
    """Au minimum size + mtime si pas de sha256."""

    sha256: str
    size_bytes: int
    mtime_iso: str


class MediaInfoV1(TypedDict, total=False):
    path: str
    path_relative: str
    fingerprint: MediaFingerprintV1
    duration: float
    sample_rate: int
    channels: int
    format: str
    normalized_audio_path: str | None


class ChunkNoteV1(TypedDict, total=False):
    padding_sec: float
    overlap_sec: float


class ChunkInfoV1(TypedDict):
    """
    Invariant documenté: 0 <= start < end <= media.duration (temps global).
    """

    chunk_id: str
    start: float
    end: float
    local_path: str
    notes: NotRequired[ChunkNoteV1]


class PipelineConfigV1(TypedDict, total=False):
    transcription_model: str
    language: str
    device: str
    compute_type: str
    batch_size: int
    diarize: bool
    min_speakers: int | None
    max_speakers: int | None
    pipeline_chunk_seconds: float | None
    pipeline_chunk_overlap_seconds: float
    analysis: dict[str, Any]
    chunk_state_dir: str | None
    chunk_resume: bool | None
    chunk_jsonl_per_chunk: bool | None
    external_word_timings_json: str | None
    external_word_timings_strict: bool | None


class EnvironmentInfoV1(TypedDict, total=False):
    whisperx_version: str
    python_version: str
    torch_version: str
    platform: str


class RunStatsV1(TypedDict, total=False):
    n_segments: int
    n_words: int
    n_speaker_turns: int
    n_events: int
    n_pauses: int
    n_ipus: int


class RunManifestV1(TypedDict, total=False):
    schema_version: int
    run_id: str
    created_at: str
    input_media: MediaInfoV1
    pipeline: PipelineConfigV1
    env: EnvironmentInfoV1
    artifacts: dict[str, str]
    warnings: list[str]
    stats: RunStatsV1
    chunks: list[ChunkInfoV1]


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_chunk_interval(start: float, end: float, media_duration: float) -> None:
    """
    Invariant ChunkInfo: 0 <= start < end <= media.duration.
    Raises ValueError on violation. Tolérance 1 ms sur la borne droite (quantize / float).
    """
    eps = 1e-3
    if not (0 <= start < end) or end > media_duration + eps:
        raise ValueError(
            f"chunk interval invalid: need 0 <= start < end <= duration, "
            f"got start={start}, end={end}, media_duration={media_duration}"
        )


# ---------------------------------------------------------------------------
# Media probing (lightweight)
# ---------------------------------------------------------------------------


def _probe_duration_seconds_ffprobe(path: str) -> float | None:
    """Durée média en secondes (ffprobe), sans importer whisperx.audio (évite torch au chargement)."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, check=True, text=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    if not out:
        return None
    try:
        d = float(out)
    except ValueError:
        return None
    if d <= 0 or d != d:  # NaN
        return None
    return d


def _ffprobe_format_and_streams(path: str) -> dict[str, Any] | None:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name",
        "-show_entries",
        "stream=index,codec_type,sample_rate,channels",
        "-of",
        "json",
        path,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, check=True, text=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return None


def fingerprint_file(path: str, *, compute_sha256: bool = False) -> MediaFingerprintV1:
    st = os.stat(path)
    fp: MediaFingerprintV1 = {
        "size_bytes": int(st.st_size),
        "mtime_iso": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
    }
    if compute_sha256:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        fp["sha256"] = h.hexdigest()
    return fp


def build_media_info_v1(
    audio_path: str,
    *,
    output_dir: str | None = None,
    compute_sha256: bool = False,
) -> MediaInfoV1:
    """
    Remplit MediaInfo à partir du fichier média.
    Chemins relatifs: si output_dir est fourni et audio_path est en dessous, enregistre path_relative.
    Si le fichier est absent (chemin fictif en test), retourne un squelette avec duration 0.
    """
    abs_audio = os.path.abspath(audio_path)
    if not os.path.isfile(abs_audio):
        rel = os.path.basename(abs_audio)
        if output_dir:
            try:
                rel = os.path.relpath(abs_audio, os.path.abspath(output_dir))
            except ValueError:
                rel = os.path.basename(abs_audio)
        return {
            "path": abs_audio,
            "path_relative": rel.replace("\\", "/"),
            "fingerprint": {},
            "duration": 0.0,
            "format": "unknown",
            "normalized_audio_path": None,
        }
    rel = os.path.basename(abs_audio)
    if output_dir:
        try:
            rel = os.path.relpath(abs_audio, os.path.abspath(output_dir))
        except ValueError:
            rel = os.path.basename(abs_audio)

    ext = os.path.splitext(abs_audio)[1].lstrip(".").lower() or "unknown"

    fp_data = fingerprint_file(abs_audio, compute_sha256=compute_sha256)

    duration: float | None = None
    sample_rate: int | None = None
    channels: int | None = None
    format_name = ext

    raw = _ffprobe_format_and_streams(abs_audio)
    if raw:
        fmt = raw.get("format") or {}
        if isinstance(fmt, dict):
            d = fmt.get("duration")
            if d is not None:
                try:
                    duration = quantize_time_seconds(float(d))
                except (ValueError, TypeError):
                    duration = None
            fn = fmt.get("format_name")
            if isinstance(fn, str) and fn:
                format_name = fn.split(",")[0].strip()

        for stream in raw.get("streams") or []:
            if not isinstance(stream, dict):
                continue
            if stream.get("codec_type") == "audio":
                sr = stream.get("sample_rate")
                ch = stream.get("channels")
                if sr is not None:
                    try:
                        sample_rate = int(float(sr))
                    except (ValueError, TypeError):
                        pass
                if ch is not None:
                    try:
                        channels = int(ch)
                    except (ValueError, TypeError):
                        pass
                break

    if duration is None:
        d2 = _probe_duration_seconds_ffprobe(abs_audio)
        if d2 is not None:
            duration = quantize_time_seconds(d2)

    if duration is None:
        duration = 0.0

    info: MediaInfoV1 = {
        "path": abs_audio,
        "path_relative": rel.replace("\\", "/"),
        "fingerprint": fp_data,
        "duration": duration,
        "format": format_name,
        "normalized_audio_path": None,
    }
    if sample_rate is not None:
        info["sample_rate"] = sample_rate
    if channels is not None:
        info["channels"] = channels
    return info


def pipeline_from_run_config(config: dict[str, Any] | None) -> PipelineConfigV1:
    """Mappe un snapshot de config CLI/run vers PipelineConfigV1."""
    if not config:
        return {}
    analysis = config.get("analysis")
    if not isinstance(analysis, dict):
        analysis = {}
    return {
        "transcription_model": str(config.get("model", "")),
        "language": str(config.get("language") or "auto"),
        "device": str(config.get("device", "")),
        "compute_type": str(config.get("compute_type", "")),
        "batch_size": int(config.get("batch_size", 0)),
        "diarize": bool(config.get("diarize", False)),
        "min_speakers": config.get("min_speakers"),
        "max_speakers": config.get("max_speakers"),
        "pipeline_chunk_seconds": config.get("pipeline_chunk_seconds"),
        "pipeline_chunk_overlap_seconds": float(config.get("pipeline_chunk_overlap_seconds") or 0.0),
        "analysis": {
            "pause_min": analysis.get("pause_min"),
            "pause_ignore_below": analysis.get("pause_ignore_below"),
            "pause_max": analysis.get("pause_max"),
            "include_nonspeech": analysis.get("include_nonspeech"),
            "nonspeech_min_duration": analysis.get("nonspeech_min_duration"),
            "ipu_min_words": analysis.get("ipu_min_words"),
            "ipu_min_duration": analysis.get("ipu_min_duration"),
            "ipu_bridge_short_gaps_under": analysis.get("ipu_bridge_short_gaps_under"),
            "analysis_preset": analysis.get("analysis_preset"),
            "calibration": analysis.get("calibration"),
            "speaker_turn_postprocess_preset": analysis.get("speaker_turn_postprocess_preset"),
            "speaker_turn_merge_gap_sec_max": analysis.get("speaker_turn_merge_gap_sec_max"),
            "speaker_turn_split_word_gap_sec": analysis.get("speaker_turn_split_word_gap_sec"),
            "word_timestamp_stabilize_mode": analysis.get("word_timestamp_stabilize_mode"),
            "word_ts_neighbor_ratio_low": analysis.get("word_ts_neighbor_ratio_low"),
            "word_ts_neighbor_ratio_high": analysis.get("word_ts_neighbor_ratio_high"),
            "word_ts_smooth_max_sec": analysis.get("word_ts_smooth_max_sec"),
        },
        "chunk_state_dir": config.get("chunk_state_dir"),
        "chunk_resume": config.get("chunk_resume"),
        "chunk_jsonl_per_chunk": config.get("chunk_jsonl_per_chunk"),
        "external_word_timings_json": config.get("external_word_timings_json"),
        "external_word_timings_strict": config.get("external_word_timings_strict"),
    }


def environment_info_v1() -> EnvironmentInfoV1:
    import importlib.metadata
    import platform

    try:
        wx_ver = importlib.metadata.version("whisperx")
    except Exception:
        wx_ver = "unknown"

    try:
        import torch

        torch_version = getattr(torch, "__version__", "unknown")
    except ImportError:
        torch_version = "unavailable"

    return {
        "whisperx_version": wx_ver,
        "python_version": platform.python_version(),
        "torch_version": torch_version,
        "platform": platform.platform(),
    }


def chunks_from_pipeline_chunking(
    pipeline_chunking: dict[str, Any] | None,
    media_duration: float,
) -> list[ChunkInfoV1]:
    """
    Construit ChunkInfoV1[] depuis result['pipeline_chunking'].
    Le pipeline actuel utilise `windows` (start, duration, index) ; pas de wav par chunk sur disque.
    """
    if not pipeline_chunking or not isinstance(pipeline_chunking, dict):
        return []
    raw_chunks = pipeline_chunking.get("chunks")
    raw_windows = pipeline_chunking.get("windows")
    rows: list[dict[str, Any]] = []
    if isinstance(raw_chunks, list) and raw_chunks:
        rows = [c for c in raw_chunks if isinstance(c, dict)]
    elif isinstance(raw_windows, list) and raw_windows:
        for w in raw_windows:
            if not isinstance(w, dict):
                continue
            start = float(w.get("start", 0.0))
            dur = w.get("duration")
            if dur is None:
                continue
            end = start + float(dur)
            idx = int(w.get("index", 0))
            rows.append(
                {
                    "chunk_id": f"chunk_{idx:04d}",
                    "start": start,
                    "end": end,
                    "local_path": "",
                    "notes": {
                        "overlap_sec": float(pipeline_chunking.get("overlap_seconds") or 0.0),
                        "padding_sec": 0.0,
                    },
                }
            )
    out: list[ChunkInfoV1] = []
    for i, c in enumerate(rows):
        cid = str(c.get("chunk_id", f"chunk_{i:04d}"))
        start = float(c.get("start", 0.0))
        end = float(c.get("end", 0.0))
        local_path = str(c.get("local_path", c.get("path", "")))
        if media_duration > 0:
            validate_chunk_interval(start, end, media_duration)
        chunk: ChunkInfoV1 = {
            "chunk_id": cid,
            "start": quantize_time_seconds(start),
            "end": quantize_time_seconds(end),
            "local_path": local_path,
        }
        raw_notes = c.get("notes")
        if isinstance(raw_notes, dict):
            notes = ChunkNoteV1()
            if raw_notes.get("padding_sec") is not None:
                notes["padding_sec"] = float(raw_notes["padding_sec"])
            if raw_notes.get("overlap_sec") is not None:
                notes["overlap_sec"] = float(raw_notes["overlap_sec"])
            if notes:
                chunk["notes"] = notes
        out.append(chunk)
    return out


@dataclass
class RunManifestBuildInput:
    output_dir: str
    audio_path: str
    artifact_keys_to_rel_path: dict[str, str]
    run_metadata: dict[str, Any]
    run_id: str | None
    warnings: list[str]
    pipeline_chunking: dict[str, Any] | None


def build_run_manifest_v1(inp: RunManifestBuildInput) -> dict[str, Any]:
    """
    Produit un dict JSON-sérialisable (snake_case) pour run_manifest.json.
    Les chemins dans artifacts sont relatifs au dossier de sortie du run.
    """
    rid = inp.run_id or f"adhoc_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    created = inp.run_metadata.get("generatedAt") or datetime.now(timezone.utc).isoformat()

    media = build_media_info_v1(inp.audio_path, output_dir=inp.output_dir)
    cfg_snapshot = inp.run_metadata.get("config")
    if not isinstance(cfg_snapshot, dict):
        cfg_snapshot = {}

    stats_raw = inp.run_metadata.get("counts")
    stats: RunStatsV1 = {}
    if isinstance(stats_raw, dict):
        stats = {
            "n_segments": int(stats_raw.get("segments", 0)),
            "n_words": int(stats_raw.get("words", 0)),
            "n_speaker_turns": int(stats_raw.get("speakerTurns", 0)),
            "n_events": int(stats_raw.get("events", 0)),
            "n_pauses": int(stats_raw.get("pauses", 0)),
            "n_ipus": int(stats_raw.get("ipus", 0)),
        }

    manifest: dict[str, Any] = {
        "schema_version": RUN_MANIFEST_SCHEMA_VERSION,
        "run_id": rid,
        "created_at": created,
        "input_media": dict(media),
        "pipeline": dict(pipeline_from_run_config(cfg_snapshot)),
        "env": dict(environment_info_v1()),
        "artifacts": dict(inp.artifact_keys_to_rel_path),
        "warnings": list(inp.warnings),
        "stats": stats,
    }

    chunks = chunks_from_pipeline_chunking(inp.pipeline_chunking, float(media.get("duration") or 0.0))
    if chunks:
        manifest["chunks"] = [dict(c) for c in chunks]

    return manifest


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    """Écriture atomique: fichier temporaire dans le même répertoire puis replace."""
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def write_run_manifest_v1_file(output_dir: str, manifest: dict[str, Any], filename: str = "run_manifest.json") -> str:
    """Écrit run_manifest.json sous output_dir. Retourne le chemin absolu."""
    out = Path(output_dir) / filename
    write_json_atomic(out, manifest)
    return str(out)
