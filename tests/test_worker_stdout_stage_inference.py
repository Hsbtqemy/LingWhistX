import importlib.util
from pathlib import Path


def _load_worker_module():
    worker_path = (
        Path(__file__).resolve().parent.parent
        / "whisperx-studio"
        / "python"
        / "worker.py"
    )
    spec = importlib.util.spec_from_file_location("whisperx_studio_worker", worker_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load worker module from {worker_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_infer_whisperx_stdout_stage_align_and_diarize():
    w = _load_worker_module()
    inf = w.infer_whisperx_stdout_stage

    assert inf("INFO:__main__:Performing alignment...") == "wx_align"
    assert inf('Failed to align segment ("x"): no characters') == "wx_align"
    assert (
        inf(
            "New language found (fr)! Previous was (en), loading new alignment model for new language..."
        )
        == "wx_align"
    )

    assert inf("Loading diarization model: pyannote/foo") == "wx_diarize"
    assert inf("Performing diarization...") == "wx_diarize"
    assert inf("Using model: pyannote/speaker-diarization-community-1") == "wx_diarize"


def test_infer_whisperx_stdout_stage_transcribe():
    w = _load_worker_module()
    inf = w.infer_whisperx_stdout_stage

    assert inf("Performing transcription...") == "wx_transcribe"
    assert inf("Performing voice activity detection using Pyannote...") == "wx_transcribe"
    assert inf("Using media chunking: duration=120.00s chunk=30.00s") == "wx_transcribe"
    assert inf("Transcribed chunk #3 at offset 60.00s (window 30.00s).") == "wx_transcribe"
    assert inf("Resuming chunk #2 from artifact (offset 30.00s, window 30.00s).") == "wx_transcribe"
    assert inf("Transcript: [0.0 --> 1.0] hello") == "wx_transcribe"


def test_infer_whisperx_stdout_stage_unknown_returns_none():
    w = _load_worker_module()
    inf = w.infer_whisperx_stdout_stage

    assert inf("random torch tensor op std = x") is None
    assert inf("") is None


def test_parse_live_transcript_line():
    w = _load_worker_module()
    parse = w.parse_live_transcript_line

    s = parse("Transcript: [0.0 --> 1.5] Bonjour le monde")
    assert s is not None
    assert s[0] == 0.0 and s[1] == 1.5 and s[2] == "Bonjour le monde"

    assert parse("Progress: 12%") is None
