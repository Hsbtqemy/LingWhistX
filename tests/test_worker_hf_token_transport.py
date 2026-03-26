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


class _FakePopen:
    last_command = None
    last_env = None

    def __init__(self, command, **kwargs):
        type(self).last_command = command
        type(self).last_env = kwargs.get("env") or {}
        self.stdout = iter([])

    def wait(self):
        return 0


def test_worker_does_not_put_hf_token_in_cli_args(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_whisperx_cli_is_lingwhistx_fork", lambda: True)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_whisperx(
        "input.wav",
        out_dir,
        {"outputFormat": "json", "diarize": True, "hfToken": "  token-from-options  "},
    )

    assert "--hf_token" not in _FakePopen.last_command
    assert _FakePopen.last_env["WHISPERX_HF_TOKEN"] == "token-from-options"
    assert _FakePopen.last_env["HF_TOKEN"] == "token-from-options"
    assert _FakePopen.last_env["HUGGINGFACE_TOKEN"] == "token-from-options"


def test_worker_reads_token_from_env_fallback(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_whisperx_cli_is_lingwhistx_fork", lambda: True)

    monkeypatch.delenv("WHISPERX_HF_TOKEN", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_TOKEN", raising=False)
    monkeypatch.setenv("WHISPERX_STUDIO_HF_TOKEN", "token-from-env")

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_whisperx(
        "input.wav",
        out_dir,
        {"outputFormat": "json", "diarize": True},
    )

    assert "--hf_token" not in _FakePopen.last_command
    assert _FakePopen.last_env["WHISPERX_HF_TOKEN"] == "token-from-env"
    assert _FakePopen.last_env["HF_TOKEN"] == "token-from-env"
    assert _FakePopen.last_env["HUGGINGFACE_TOKEN"] == "token-from-env"


def test_worker_forwards_media_chunking_options(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_whisperx_cli_is_lingwhistx_fork", lambda: True)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_whisperx(
        "input.wav",
        out_dir,
        {
            "outputFormat": "json",
            "pipelineChunkSeconds": 600,
            "pipelineChunkOverlapSeconds": 2.5,
        },
    )

    command = _FakePopen.last_command
    assert "--pipeline_chunk_seconds" in command
    assert "--pipeline_chunk_overlap_seconds" in command
    chunk_idx = command.index("--pipeline_chunk_seconds")
    overlap_idx = command.index("--pipeline_chunk_overlap_seconds")
    assert command[chunk_idx + 1] == "600"
    assert command[overlap_idx + 1] == "2.5"


def test_worker_forwards_diarization_speaker_bounds(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_whisperx_cli_is_lingwhistx_fork", lambda: True)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_whisperx(
        "input.wav",
        out_dir,
        {
            "outputFormat": "json",
            "diarize": True,
            "minSpeakers": 2,
            "maxSpeakers": 3,
        },
    )

    command = _FakePopen.last_command
    assert "--diarize" in command
    assert "--min_speakers" in command
    assert "--max_speakers" in command
    assert "--force_n_speakers" not in command
    assert command[command.index("--min_speakers") + 1] == "2"
    assert command[command.index("--max_speakers") + 1] == "3"


def test_worker_force_n_speakers_overrides_min_max(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_whisperx_cli_is_lingwhistx_fork", lambda: True)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_whisperx(
        "input.wav",
        out_dir,
        {
            "outputFormat": "json",
            "diarize": True,
            "minSpeakers": 2,
            "maxSpeakers": 3,
            "forceNSpeakers": 2,
        },
    )

    command = _FakePopen.last_command
    assert "--diarize" in command
    assert "--force_n_speakers" in command
    assert "--min_speakers" not in command
    assert "--max_speakers" not in command
    assert command[command.index("--force_n_speakers") + 1] == "2"


def test_worker_omits_fork_only_cli_when_upstream_whisperx(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_whisperx_cli_is_lingwhistx_fork", lambda: False)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_whisperx(
        "input.wav",
        out_dir,
        {
            "outputFormat": "json",
            "analysisPauseMin": 0.2,
            "pipelineChunkSeconds": 600,
            "pipelineChunkOverlapSeconds": 2,
        },
    )

    command = _FakePopen.last_command
    assert "--analysis_pause_min" not in command
    assert "--pipeline_chunk_seconds" not in command


def test_worker_forwards_analysis_options(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_whisperx_cli_is_lingwhistx_fork", lambda: True)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_whisperx(
        "input.wav",
        out_dir,
        {
            "outputFormat": "json",
            "analysisPauseMin": 0.2,
            "analysisPauseIgnoreBelow": 0.12,
            "analysisIpuMinWords": 2,
            "analysisIpuMinDuration": 0.4,
        },
    )

    command = _FakePopen.last_command
    assert "--analysis_pause_min" in command
    assert "--analysis_pause_ignore_below" in command
    assert "--analysis_ipu_min_words" in command
    assert "--analysis_ipu_min_duration" in command
    assert command[command.index("--analysis_pause_min") + 1] == "0.2"
    assert command[command.index("--analysis_pause_ignore_below") + 1] == "0.12"
    assert command[command.index("--analysis_ipu_min_words") + 1] == "2"
    assert command[command.index("--analysis_ipu_min_duration") + 1] == "0.4"


def test_worker_runs_analyze_only_mode(tmp_path, monkeypatch):
    worker = _load_worker_module()
    monkeypatch.setattr(worker.subprocess, "Popen", _FakePopen)
    monkeypatch.setattr(worker, "emit_log", lambda *_args, **_kwargs: None)

    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    worker.run_analyze_only(
        "existing.json",
        out_dir,
        {"analysisPauseMin": 0.18},
    )

    command = _FakePopen.last_command
    assert command[:3] == [worker.sys.executable, "-m", "whisperx"]
    assert "--analyze_only_from" in command
    assert command[command.index("--analyze_only_from") + 1] == "existing.json"
    assert "--analysis_pause_min" in command
