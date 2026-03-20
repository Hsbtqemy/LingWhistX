import argparse
from pathlib import Path

import pytest

pytest.importorskip("torch")
transcribe_mod = pytest.importorskip("whisperx.transcribe")


class _DummyModel:
    def __init__(self, language: str = "fr") -> None:
        self._language = language

    def transcribe(self, *_args, **_kwargs):
        return {
            "segments": [{"start": 0.0, "end": 1.0, "text": "bonjour"}],
            "language": self._language,
        }


def _base_args(tmp_path: Path, **overrides):
    args = {
        "audio": [str(tmp_path / "input.wav")],
        "model": "small",
        "model_cache_only": False,
        "model_dir": None,
        "device": "cpu",
        "device_index": 0,
        "batch_size": 1,
        "compute_type": "default",
        "output_dir": str(tmp_path / "out"),
        "output_format": "json",
        "verbose": False,
        "task": "transcribe",
        "language": None,
        "align_model": None,
        "interpolate_method": "nearest",
        "no_align": False,
        "return_char_alignments": False,
        "vad_method": "pyannote",
        "vad_onset": 0.5,
        "vad_offset": 0.363,
        "chunk_size": 30,
        "diarize": False,
        "min_speakers": None,
        "max_speakers": None,
        "diarize_model": "pyannote/speaker-diarization-community-1",
        "speaker_embeddings": False,
        "temperature": 0.0,
        "best_of": 7,
        "beam_size": 5,
        "patience": 1.0,
        "length_penalty": 1.0,
        "suppress_tokens": "-1",
        "suppress_numerals": False,
        "initial_prompt": None,
        "hotwords": None,
        "condition_on_previous_text": True,
        "fp16": True,
        "temperature_increment_on_fallback": None,
        "compression_ratio_threshold": 2.4,
        "logprob_threshold": -1.0,
        "no_speech_threshold": 0.6,
        "max_line_width": None,
        "max_line_count": None,
        "highlight_words": False,
        "segment_resolution": "sentence",
        "threads": 0,
        "hf_token": None,
        "print_progress": False,
    }
    args.update(overrides)
    return args


def _patch_runtime_dependencies(monkeypatch, writes):
    def fake_get_writer(_output_format, _output_dir):
        def writer(result, audio_path, writer_args):
            writes.append((result, audio_path, dict(writer_args)))

        return writer

    monkeypatch.setattr(transcribe_mod, "get_writer", fake_get_writer)
    monkeypatch.setattr(transcribe_mod, "load_audio", lambda _path: [0.0, 0.0, 0.0])
    monkeypatch.setattr(transcribe_mod.gc, "collect", lambda: None)
    monkeypatch.setattr(transcribe_mod.torch.cuda, "empty_cache", lambda: None)


def test_transcribe_uses_cli_flags_and_env_hf_token(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)

    captured = {}

    def fake_load_model(*_args, **kwargs):
        captured.update(kwargs)
        return _DummyModel(language="fr")

    monkeypatch.setenv("WHISPERX_HF_TOKEN", "env-token")
    monkeypatch.setattr(transcribe_mod, "load_model", fake_load_model)

    args = _base_args(
        tmp_path,
        no_align=True,
        device="cuda",
        compute_type="default",
        fp16=False,
        condition_on_previous_text=True,
        best_of=9,
        hf_token=None,
    )
    transcribe_mod.transcribe_task(args, parser)

    assert captured["compute_type"] == "float32"
    assert captured["use_auth_token"] == "env-token"
    assert captured["asr_options"]["best_of"] == 9
    assert captured["asr_options"]["condition_on_previous_text"] is True
    assert writes[0][0]["language"] == "fr"
    assert writes[0][2]["segment_resolution"] == "sentence"


def test_transcribe_rejects_chunk_resolution_when_no_align(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)
    monkeypatch.setattr(transcribe_mod, "load_model", lambda *_args, **_kwargs: _DummyModel())

    args = _base_args(
        tmp_path,
        no_align=True,
        segment_resolution="chunk",
    )
    with pytest.raises(SystemExit):
        transcribe_mod.transcribe_task(args, parser)


def test_transcribe_keeps_detected_language_after_alignment(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)
    monkeypatch.setattr(transcribe_mod, "load_model", lambda *_args, **_kwargs: _DummyModel(language="fr"))

    align_load_calls = []

    def fake_load_align_model(language, *_args, **_kwargs):
        align_load_calls.append(language)
        return object(), {"language": language}

    def fake_align(*_args, **_kwargs):
        return {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "bonjour",
                    "words": [{"word": "bonjour", "start": 0.0, "end": 1.0}],
                }
            ],
            "word_segments": [{"word": "bonjour", "start": 0.0, "end": 1.0}],
        }

    monkeypatch.setattr(transcribe_mod, "load_align_model", fake_load_align_model)
    monkeypatch.setattr(transcribe_mod, "align", fake_align)

    args = _base_args(
        tmp_path,
        no_align=False,
        language=None,
    )
    transcribe_mod.transcribe_task(args, parser)

    assert writes[0][0]["language"] == "fr"
    assert align_load_calls[0] == "en"
    assert "fr" in align_load_calls
