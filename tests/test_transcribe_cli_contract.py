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
        "pipeline_chunk_seconds": None,
        "pipeline_chunk_overlap_seconds": 0.0,
        "diarize": False,
        "min_speakers": None,
        "max_speakers": None,
        "force_n_speakers": None,
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
        "export_data_science": True,
        "export_annotation_rttm": False,
        "export_annotation_textgrid": False,
        "export_annotation_eaf": False,
        "analyze_only_from": None,
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
    timeline = writes[0][0]["timeline"]
    assert timeline["version"] == 1
    assert timeline["segments"][0]["text"] == "bonjour"
    assert timeline["words"][0]["token"] == "bonjour"
    assert timeline["analysis"]["config"]["pause_min"] == 0.15
    assert timeline["analysis"]["config"]["include_nonspeech"] is True
    assert timeline["analysis"]["config"]["ipu_min_words"] == 1
    assert timeline["analysis"]["config"]["ipu_min_duration"] == 0.0
    assert align_load_calls[0] == "en"
    assert "fr" in align_load_calls


def test_transcribe_merges_pipeline_chunks_with_global_offsets(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)

    calls = []

    def fake_load_audio(_path, sr=16000, start_time=None, duration=None):
        calls.append((sr, start_time, duration))
        marker = 0.0 if start_time is None else float(start_time)
        return [marker]

    class _ChunkModel:
        def transcribe(self, audio, *_args, **_kwargs):
            start_marker = float(audio[0]) if len(audio) > 0 else 0.0
            return {
                "segments": [
                    {
                        "start": 0.0,
                        "end": 0.5,
                        "text": f"chunk-{start_marker:.1f}",
                    }
                ],
                "language": "fr",
            }

    monkeypatch.setattr(transcribe_mod, "load_audio", fake_load_audio)
    monkeypatch.setattr(transcribe_mod, "probe_audio_duration", lambda _path: 5.0)
    monkeypatch.setattr(transcribe_mod, "load_model", lambda *_args, **_kwargs: _ChunkModel())

    args = _base_args(
        tmp_path,
        no_align=True,
        pipeline_chunk_seconds=2.0,
        pipeline_chunk_overlap_seconds=0.5,
    )
    transcribe_mod.transcribe_task(args, parser)

    result = writes[0][0]
    starts = [segment["start"] for segment in result["segments"]]
    assert starts == [0.0, 1.5, 3.0, 4.5]
    assert result["language"] == "fr"
    assert result["timeline"]["segments"][3]["start"] == 4.5
    assert len(calls) == 4


def test_transcribe_rejects_force_n_with_min_max(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)
    monkeypatch.setattr(transcribe_mod, "load_model", lambda *_args, **_kwargs: _DummyModel())

    args = _base_args(
        tmp_path,
        no_align=True,
        diarize=True,
        force_n_speakers=2,
        min_speakers=1,
    )
    with pytest.raises(SystemExit):
        transcribe_mod.transcribe_task(args, parser)


def test_transcribe_rejects_invalid_ipu_options(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)
    monkeypatch.setattr(transcribe_mod, "load_model", lambda *_args, **_kwargs: _DummyModel())

    args = _base_args(
        tmp_path,
        no_align=True,
        analysis_ipu_min_words=0,
    )
    with pytest.raises(SystemExit):
        transcribe_mod.transcribe_task(args, parser)


def test_transcribe_forwards_force_n_speakers_to_diarization(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)
    monkeypatch.setattr(transcribe_mod, "load_model", lambda *_args, **_kwargs: _DummyModel())

    captured = {}

    class _FakeDiarizationPipeline:
        def __init__(self, *_args, **_kwargs):
            captured["init"] = _kwargs

        def __call__(self, _path, **kwargs):
            captured["call"] = kwargs
            return []

    monkeypatch.setattr(transcribe_mod, "DiarizationPipeline", _FakeDiarizationPipeline)
    monkeypatch.setattr(
        transcribe_mod,
        "assign_word_speakers",
        lambda _diarize_segments, result, _speaker_embeddings=None: result,
    )

    args = _base_args(
        tmp_path,
        no_align=True,
        diarize=True,
        force_n_speakers=2,
        hf_token="hf_test_dummy",
    )
    transcribe_mod.transcribe_task(args, parser)

    assert captured["call"]["num_speakers"] == 2
    assert captured["call"]["min_speakers"] is None
    assert captured["call"]["max_speakers"] is None


def test_transcribe_emits_data_science_exports(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    writes = []
    _patch_runtime_dependencies(monkeypatch, writes)
    monkeypatch.setattr(transcribe_mod, "load_model", lambda *_args, **_kwargs: _DummyModel(language="fr"))

    export_calls = []

    def fake_export(**kwargs):
        export_calls.append(kwargs)
        return {}

    monkeypatch.setattr(transcribe_mod, "write_data_science_exports", fake_export)

    args = _base_args(
        tmp_path,
        no_align=True,
        export_data_science=True,
    )
    transcribe_mod.transcribe_task(args, parser)

    assert len(export_calls) == 1
    call = export_calls[0]
    assert call["audio_path"].endswith("input.wav")
    assert call["result"]["pipeline_chunking"]["mode"] == "single_pass"
    assert call["run_metadata"]["config"]["analysis"]["pause_min"] == 0.15


def test_transcribe_analyze_only_skips_model_loading(tmp_path, monkeypatch):
    parser = argparse.ArgumentParser(prog="whisperx")
    source_json = tmp_path / "existing.json"
    source_json.write_text('{"segments":[{"start":0.0,"end":0.5,"text":"hello"}]}', encoding="utf-8")

    monkeypatch.setattr(
        transcribe_mod,
        "load_model",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("load_model must not run")),
    )

    called = {}

    def fake_run_analyze_only(**kwargs):
        called.update(kwargs)

    monkeypatch.setattr(transcribe_mod, "_run_analyze_only", fake_run_analyze_only)

    args = _base_args(
        tmp_path,
        analyze_only_from=str(source_json),
    )
    transcribe_mod.transcribe_task(args, parser)

    assert called["analyze_only_from"] == str(source_json)
    assert called["timeline_analysis_config"]["pause_min"] == 0.15
