"""Tests run manifest v1 (WX-501): temps, chunks, sérialisation."""

import json
import os
from pathlib import Path

import pytest

from whisperx.run_manifest import (
    RUN_MANIFEST_SCHEMA_VERSION,
    RunManifestBuildInput,
    build_media_info_v1,
    build_run_manifest_v1,
    chunks_from_pipeline_chunking,
    quantize_time_seconds,
    validate_chunk_interval,
    write_json_atomic,
    write_run_manifest_v1_file,
)


def test_quantize_time_seconds() -> None:
    assert quantize_time_seconds(1.23456) == 1.235
    assert quantize_time_seconds(0.0) == 0.0
    with pytest.raises(ValueError):
        quantize_time_seconds(float("nan"))


def test_validate_chunk_interval() -> None:
    validate_chunk_interval(0.0, 1.0, 10.0)
    validate_chunk_interval(0.0, 10.0, 10.0)
    with pytest.raises(ValueError):
        validate_chunk_interval(1.0, 1.0, 10.0)
    with pytest.raises(ValueError):
        validate_chunk_interval(0.0, 11.0, 10.0)


def test_chunks_from_pipeline_chunking_windows() -> None:
    pc = {
        "enabled": True,
        "overlap_seconds": 0.5,
        "windows": [
            {"index": 1, "start": 0.0, "duration": 30.0, "selection_end": 29.5, "emitted_segments": 5},
            {"index": 2, "start": 29.5, "duration": 30.0, "selection_end": None, "emitted_segments": 3},
        ],
    }
    chunks = chunks_from_pipeline_chunking(pc, media_duration=60.0)
    assert len(chunks) == 2
    assert chunks[0]["chunk_id"] == "chunk_0001"
    assert chunks[0]["start"] == 0.0
    assert chunks[0]["end"] == 30.0
    assert chunks[1]["start"] == 29.5
    assert chunks[1]["end"] == 59.5


def test_build_run_manifest_artifacts_relative(tmp_path: Path) -> None:
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF")

    metadata = {
        "generatedAt": "2026-01-01T00:00:00+00:00",
        "config": {
            "model": "small",
            "language": "fr",
            "device": "cpu",
            "compute_type": "float32",
            "batch_size": 8,
            "diarize": False,
            "analysis": {"pause_min": 0.15, "pause_ignore_below": 0.1},
        },
        "counts": {
            "segments": 2,
            "words": 10,
            "speakerTurns": 1,
            "events": 0,
            "pauses": 1,
            "ipus": 2,
        },
    }
    inp = RunManifestBuildInput(
        output_dir=str(tmp_path),
        audio_path=str(audio),
        artifact_keys_to_rel_path={
            "run_json": "x.run.json",
            "timeline_json": "x.timeline.json",
            "words_csv": "x.words.csv",
            "pauses_csv": "x.pauses.csv",
            "ipu_csv": "x.ipu.csv",
        },
        run_metadata=metadata,
        run_id="20260101T000000Z_abc12345",
        warnings=["test_warning"],
        pipeline_chunking=None,
    )
    m = build_run_manifest_v1(inp)
    assert m["schema_version"] == RUN_MANIFEST_SCHEMA_VERSION
    assert m["run_id"] == "20260101T000000Z_abc12345"
    assert m["warnings"] == ["test_warning"]
    for v in m["artifacts"].values():
        assert not os.path.isabs(v)
        assert ".." not in v
    assert m["stats"]["n_words"] == 10


def test_write_run_manifest_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "m.json"
    write_json_atomic(p, {"schema_version": 1, "ok": True})
    assert p.is_file()
    assert json.loads(p.read_text(encoding="utf-8"))["ok"] is True
    out = write_run_manifest_v1_file(
        str(tmp_path),
        {"schema_version": 1, "run_id": "r1", "created_at": "2026-01-01T00:00:00+00:00"},
        filename="run_manifest.json",
    )
    assert Path(out).name == "run_manifest.json"


def test_build_media_info_fingerprint(tmp_path: Path) -> None:
    f = tmp_path / "t.mp3"
    f.write_bytes(b"hello")
    info = build_media_info_v1(str(f), output_dir=str(tmp_path))
    assert "fingerprint" in info
    assert info["fingerprint"]["size_bytes"] == 5
    assert "mtime_iso" in info["fingerprint"]
