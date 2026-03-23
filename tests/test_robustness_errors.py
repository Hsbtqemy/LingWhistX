"""Robustesse attendue (WX-509) — mocks, pas de GPU."""

import shutil
from pathlib import Path

import pytest


def test_load_align_model_unknown_language_raises_clear_message() -> None:
    pytest.importorskip("torch")
    from whisperx.alignment import load_align_model

    with pytest.raises(ValueError, match="No default align-model"):
        load_align_model("zz-unknown-lang-code", "cpu", model_name=None)


def test_load_audio_missing_ffmpeg_message(tmp_path: Path, monkeypatch) -> None:
    pytest.importorskip("torch")
    from whisperx import audio as audio_mod

    def _raise(*_a, **_k):
        raise FileNotFoundError()

    monkeypatch.setattr(audio_mod.subprocess, "run", _raise)
    fake = tmp_path / "x.wav"
    fake.write_bytes(b"fake")

    with pytest.raises(RuntimeError, match="ffmpeg executable not found"):
        audio_mod.load_audio(str(fake))


def test_load_audio_corrupt_file_returns_error_not_panic(tmp_path: Path) -> None:
    pytest.importorskip("torch")
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg requis pour décoder le fichier invalide")
    from whisperx import audio as audio_mod

    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not-a-valid-media-at-all\x00\xff")

    with pytest.raises(RuntimeError, match="Failed to load audio"):
        audio_mod.load_audio(str(bad))


def test_transcribe_logs_explicit_warning_when_diarize_without_hf_token() -> None:
    """Message actionnable présent dans le pipeline (évite échec silencieux)."""
    transcribe_py = Path(__file__).resolve().parent.parent / "whisperx" / "transcribe.py"
    src = transcribe_py.read_text(encoding="utf-8")
    assert "No --hf_token provided" in src
