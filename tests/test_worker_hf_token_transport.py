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
