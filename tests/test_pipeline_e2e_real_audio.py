import argparse
import json
import os
import shutil
import urllib.request
from pathlib import Path

import pytest


def _download_audio_sample(target_path: Path) -> None:
    sample_url = os.getenv(
        "WHISPERX_E2E_AUDIO_URL",
        "https://download.pytorch.org/torchaudio/tutorial-assets/Lab41-SRI-VOiCES-src-sp0307-ch127535-sg0042.wav",
    )
    with urllib.request.urlopen(sample_url, timeout=60) as response:
        target_path.write_bytes(response.read())


def _base_args(input_audio: Path, output_dir: Path) -> dict:
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
        "diarize": False,
        "min_speakers": None,
        "max_speakers": None,
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
    }


def test_pipeline_e2e_real_audio(tmp_path):
    if os.getenv("WHISPERX_RUN_AUDIO_E2E") != "1":
        pytest.skip("Set WHISPERX_RUN_AUDIO_E2E=1 to run full pipeline E2E test")
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not found in PATH")

    transcribe_mod = pytest.importorskip("whisperx.transcribe")
    pytest.importorskip("torch")

    input_audio = tmp_path / "sample.wav"
    _download_audio_sample(input_audio)
    assert input_audio.exists() and input_audio.stat().st_size > 0

    output_dir = tmp_path / "out"
    output_dir.mkdir(parents=True, exist_ok=True)

    parser = argparse.ArgumentParser(prog="whisperx")
    args = _base_args(input_audio, output_dir)
    transcribe_mod.transcribe_task(args, parser)

    output_json = output_dir / f"{input_audio.stem}.json"
    assert output_json.exists()

    result = json.loads(output_json.read_text(encoding="utf-8"))
    segments = result.get("segments", [])
    assert segments, "Expected at least one transcript segment"
    assert result.get("language") in {"en", "English", "english"}

    previous_end = 0.0
    found_word_timestamps = False
    for segment in segments:
        start = float(segment["start"])
        end = float(segment["end"])
        assert start <= end
        assert start >= 0.0
        assert end >= previous_end
        previous_end = end
        words = segment.get("words") or []
        if words:
            found_word_timestamps = True

    assert found_word_timestamps, "Expected aligned word timestamps in at least one segment"
