"""Tests for whisperx.cli orchestrator (argv normalization, config, run directories)."""

from pathlib import Path

from whisperx.cli import (
    allocate_run_directory,
    extract_config_path,
    flatten_config_for_defaults,
    load_config_file,
    normalize_legacy_argv,
    write_run_manifest,
)


def test_normalize_legacy_argv_inserts_run() -> None:
    assert normalize_legacy_argv(["whisperx", "a.wav"]) == ["whisperx", "run", "a.wav"]
    assert normalize_legacy_argv(["whisperx", "run", "a.wav"]) == ["whisperx", "run", "a.wav"]
    assert normalize_legacy_argv(["whisperx", "--model", "tiny", "a.wav"]) == [
        "whisperx",
        "run",
        "--model",
        "tiny",
        "a.wav",
    ]


def test_extract_config_path() -> None:
    assert extract_config_path(["x", "--config", "cfg.yaml"]) == "cfg.yaml"
    assert extract_config_path(["x", "run", "a.wav"]) is None


def test_flatten_config_merges_whisperx_section() -> None:
    cfg = {"whisperx": {"model": "base", "device": "cpu"}, "note": "x"}
    flat = flatten_config_for_defaults(cfg)
    assert flat["model"] == "base"
    assert flat["device"] == "cpu"
    assert flat["note"] == "x"


def test_load_config_yaml(tmp_path: Path) -> None:
    p = tmp_path / "c.yaml"
    p.write_text("model: medium\ndevice: cpu\n", encoding="utf-8")
    d = load_config_file(str(p))
    assert d["model"] == "medium"
    assert d["device"] == "cpu"


def test_load_config_toml(tmp_path: Path) -> None:
    p = tmp_path / "c.toml"
    p.write_text('model = "large"\ndevice = "cpu"\n', encoding="utf-8")
    d = load_config_file(str(p))
    assert d["model"] == "large"


def test_immutable_run_layout(tmp_path: Path) -> None:
    run_dir, run_id = allocate_run_directory(str(tmp_path))
    assert run_dir.is_dir()
    assert run_id in str(run_dir)
    assert (tmp_path / "runs").is_dir()

    manifest = write_run_manifest(
        run_dir,
        run_id,
        ["whisperx", "run", "a.wav"],
        None,
        {"model": "small"},
    )
    assert manifest.is_file()
    text = manifest.read_text(encoding="utf-8")
    assert run_id in text
    assert "runId" in text
