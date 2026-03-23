"""
Intégration audio réelle (WX-507).

Fixtures légères : par défaut téléchargement HTTP (voir ``WHISPERX_E2E_AUDIO_URL``).
Ne pas committer de WAV lourd ; la CI peut définir une URL interne.

Exécution :
  WHISPERX_RUN_AUDIO_E2E=1 pytest tests/test_pipeline_e2e_real_audio.py -m integration

Par défaut la suite complète exclut ``-m integration`` (voir pyproject.toml).
"""

import argparse
import json
import os
import shutil
import time
import urllib.request
from pathlib import Path

import pytest


def _download_audio_sample(target_path: Path) -> None:
    sample_url = os.getenv(
        "WHISPERX_E2E_AUDIO_URL",
        "https://download.pytorch.org/torchaudio/tutorial-assets/Lab41-SRI-VOiCES-src-sp0307-ch127535-sg0042.wav",
    )
    with urllib.request.urlopen(sample_url, timeout=120) as response:
        target_path.write_bytes(response.read())


def _e2e_pipeline_chunk_seconds() -> float | None:
    raw = os.getenv("WHISPERX_E2E_PIPELINE_CHUNK_SECONDS", "").strip()
    if not raw:
        return None
    return float(raw)


def _e2e_pipeline_chunk_overlap_seconds() -> float:
    raw = os.getenv("WHISPERX_E2E_PIPELINE_CHUNK_OVERLAP", "0.0").strip()
    return float(raw) if raw else 0.0


def _full_e2e_args(input_audio: Path, output_dir: Path) -> dict:
    """All keys required by whisperx.transcribe.transcribe_task (aligned with CLI defaults)."""
    chunk_s = _e2e_pipeline_chunk_seconds()
    overlap = _e2e_pipeline_chunk_overlap_seconds()
    return {
        "audio": [str(input_audio)],
        "model": os.getenv("WHISPERX_E2E_MODEL", "tiny.en"),
        "model_cache_only": False,
        "model_dir": os.getenv("WHISPERX_E2E_MODEL_DIR"),
        "device": os.getenv("WHISPERX_E2E_DEVICE", "cpu"),
        "device_index": 0,
        "batch_size": 1,
        "compute_type": os.getenv("WHISPERX_E2E_COMPUTE_TYPE", "default"),
        "output_dir": str(output_dir),
        "output_format": "json",
        "verbose": False,
        "log_level": "warning",
        "task": "transcribe",
        "language": "en",
        "align_model": None,
        "interpolate_method": "nearest",
        "no_align": False,
        "return_char_alignments": False,
        "vad_method": "pyannote",
        "vad_onset": 0.500,
        "vad_offset": 0.363,
        "chunk_size": 30,
        "pipeline_chunk_seconds": chunk_s,
        "pipeline_chunk_overlap_seconds": overlap,
        "diarize": False,
        "min_speakers": None,
        "max_speakers": None,
        "force_n_speakers": None,
        "diarize_model": "pyannote/speaker-diarization-community-1",
        "speaker_embeddings": False,
        "temperature": 0.0,
        "best_of": 5,
        "beam_size": 5,
        "patience": 1.0,
        "length_penalty": 1.0,
        "suppress_tokens": "-1",
        "suppress_numerals": False,
        "initial_prompt": None,
        "hotwords": None,
        "condition_on_previous_text": False,
        "fp16": True,
        "temperature_increment_on_fallback": None,
        "compression_ratio_threshold": 2.4,
        "logprob_threshold": -1.0,
        "no_speech_threshold": 0.6,
        "max_line_width": None,
        "max_line_count": None,
        "highlight_words": False,
        "segment_resolution": "sentence",
        "threads": 1,
        "hf_token": None,
        "print_progress": False,
        "analysis_pause_min": 0.15,
        "analysis_pause_ignore_below": 0.1,
        "analysis_pause_max": None,
        "analysis_include_nonspeech": True,
        "analysis_nonspeech_min_duration": 0.15,
        "analysis_ipu_min_words": 1,
        "analysis_ipu_min_duration": 0.0,
        "analysis_ipu_bridge_short_gaps_under": 0.0,
        "analysis_preset": None,
        "analysis_calibrate_window_sec": None,
        "analysis_calibrate_start_sec": 0.0,
        "chunk_state_dir": None,
        "chunk_resume": False,
        "chunk_jsonl_per_chunk": False,
        "external_word_timings_json": None,
        "external_word_timings_strict": False,
        "analysis_speaker_turn_postprocess_preset": None,
        "analysis_speaker_turn_merge_gap_sec_max": None,
        "analysis_speaker_turn_split_word_gap_sec": None,
        "analysis_word_timestamp_stabilize_mode": "off",
        "analysis_word_ts_neighbor_ratio_low": None,
        "analysis_word_ts_neighbor_ratio_high": None,
        "analysis_word_ts_smooth_max_sec": None,
        "export_data_science": os.getenv("WHISPERX_E2E_EXPORT_DATA_SCIENCE", "true").lower()
        in ("1", "true", "yes"),
        "export_annotation_rttm": False,
        "export_annotation_textgrid": False,
        "export_annotation_eaf": False,
        "analyze_only_from": None,
    }


def _assert_data_science_exports(output_dir: Path, audio_stem: str, result: dict) -> None:
    """Exports data-science + manifest : fichiers présents, plages temporelles plausibles."""
    manifest_path = output_dir / "run_manifest.json"
    assert manifest_path.is_file()
    man = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert man.get("schema_version") == 1
    arts = man.get("artifacts") or {}
    for rel in arts.values():
        assert (output_dir / rel).is_file()

    words_csv = output_dir / f"{audio_stem}.words.csv"
    assert words_csv.stat().st_size > 0

    ends = []
    for seg in result.get("segments") or []:
        if isinstance(seg, dict) and seg.get("end") is not None:
            ends.append(float(seg["end"]))
    dur = max(ends) if ends else 0.0

    tl = result.get("timeline") or {}
    analysis = tl.get("analysis") or {}
    for pause in analysis.get("pauses") or []:
        if not isinstance(pause, dict):
            continue
        ps, pe = float(pause.get("start", 0)), float(pause.get("end", 0))
        assert 0 <= ps <= pe
        if dur > 0:
            assert pe <= dur + 1.0
    for ipu in analysis.get("ipus") or []:
        if not isinstance(ipu, dict):
            continue
        a, b = float(ipu.get("start", 0)), float(ipu.get("end", 0))
        assert 0 <= a <= b
        if dur > 0:
            assert b <= dur + 1.0


def _assert_timeline_consistent(result: dict) -> None:
    segments = result.get("segments", [])
    assert segments, "Expected at least one transcript segment"
    previous_end = 0.0
    found_word_timestamps = False
    for segment in segments:
        start = float(segment["start"])
        end = float(segment["end"])
        assert start <= end
        assert start >= 0.0
        assert end >= previous_end - 1e-2
        previous_end = max(previous_end, end)
        words = segment.get("words") or []
        if words:
            found_word_timestamps = True
    assert found_word_timestamps, "Expected aligned word timestamps in at least one segment"


@pytest.mark.integration
def test_pipeline_e2e_real_audio(tmp_path, monkeypatch):
    if os.getenv("WHISPERX_RUN_AUDIO_E2E") != "1":
        pytest.skip("Set WHISPERX_RUN_AUDIO_E2E=1 to run full pipeline E2E test")
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not found in PATH")

    monkeypatch.delenv("WHISPERX_E2E_PIPELINE_CHUNK_SECONDS", raising=False)
    monkeypatch.delenv("WHISPERX_E2E_PIPELINE_CHUNK_OVERLAP", raising=False)

    transcribe_mod = pytest.importorskip("whisperx.transcribe")
    pytest.importorskip("torch")

    input_audio = tmp_path / "sample.wav"
    _download_audio_sample(input_audio)
    assert input_audio.exists() and input_audio.stat().st_size > 0

    output_dir = tmp_path / "out"
    output_dir.mkdir(parents=True, exist_ok=True)

    parser = argparse.ArgumentParser(prog="whisperx")
    args = _full_e2e_args(input_audio, output_dir)

    t0 = time.perf_counter()
    transcribe_mod.transcribe_task(args, parser)
    elapsed = time.perf_counter() - t0
    max_sec = float(os.getenv("WHISPERX_E2E_MAX_WALL_SECONDS", "0") or "0")
    if max_sec > 0:
        assert elapsed < max_sec, f"E2E wall time {elapsed:.1f}s exceeds cap {max_sec}s"

    output_json = output_dir / f"{input_audio.stem}.json"
    assert output_json.exists()

    result = json.loads(output_json.read_text(encoding="utf-8"))
    assert result.get("language") in {"en", "English", "english"}
    _assert_timeline_consistent(result)
    pc = result.get("pipeline_chunking") or {}
    assert pc.get("enabled") is False


def test_pipeline_e2e_media_chunking(tmp_path, monkeypatch):
    """Long-format regression: media-level chunks with global offset merge (requires ffmpeg + models)."""
    if os.getenv("WHISPERX_RUN_AUDIO_E2E") != "1":
        pytest.skip("Set WHISPERX_RUN_AUDIO_E2E=1")
    if os.getenv("WHISPERX_RUN_CHUNK_MERGE_E2E", "").strip() not in ("1", "true", "yes"):
        pytest.skip("Set WHISPERX_RUN_CHUNK_MERGE_E2E=1 to run chunked media E2E (slower)")
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not found in PATH")

    transcribe_mod = pytest.importorskip("whisperx.transcribe")
    pytest.importorskip("torch")

    chunk_sec = float(os.getenv("WHISPERX_E2E_PIPELINE_CHUNK_SECONDS", "8"))
    overlap_sec = float(os.getenv("WHISPERX_E2E_PIPELINE_CHUNK_OVERLAP", "1"))
    monkeypatch.setenv("WHISPERX_E2E_PIPELINE_CHUNK_SECONDS", str(chunk_sec))
    monkeypatch.setenv("WHISPERX_E2E_PIPELINE_CHUNK_OVERLAP", str(overlap_sec))

    input_audio = tmp_path / "sample.wav"
    _download_audio_sample(input_audio)
    output_dir = tmp_path / "out_chunk"
    output_dir.mkdir(parents=True, exist_ok=True)

    parser = argparse.ArgumentParser(prog="whisperx")
    args = _full_e2e_args(input_audio, output_dir)
    assert args["pipeline_chunk_seconds"] == chunk_sec

    t0 = time.perf_counter()
    transcribe_mod.transcribe_task(args, parser)
    elapsed = time.perf_counter() - t0
    max_sec = float(os.getenv("WHISPERX_E2E_CHUNK_MAX_WALL_SECONDS", "0") or "0")
    if max_sec > 0:
        assert elapsed < max_sec, f"Chunked E2E wall time {elapsed:.1f}s exceeds cap {max_sec}s"

    output_json = output_dir / f"{input_audio.stem}.json"
    result = json.loads(output_json.read_text(encoding="utf-8"))
    _assert_timeline_consistent(result)
    if os.getenv("WHISPERX_E2E_EXPORT_DATA_SCIENCE", "true").lower() in ("1", "true", "yes"):
        _assert_data_science_exports(output_dir, input_audio.stem, result)

    pc = result.get("pipeline_chunking") or {}
    if pc.get("enabled") is True:
        assert pc.get("mode") == "chunked"
        windows = pc.get("windows") or []
        assert len(windows) >= 1
    else:
        pytest.skip(
            "Media shorter than chunk window; chunking not exercised (probe returned short duration)."
        )
