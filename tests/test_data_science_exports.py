import csv
import json
from pathlib import Path

from whisperx.utils import write_data_science_exports


def test_write_data_science_exports_creates_expected_files(tmp_path: Path):
    result = {
        "timeline": {
            "version": 1,
            "segments": [
                {"start": 0.0, "end": 0.5, "text": "hello"},
            ],
            "words": [
                {
                    "speaker": "SPEAKER_00",
                    "token": "hello",
                    "start": 0.0,
                    "end": 0.5,
                    "confidence": 0.9,
                    "flags": ["ok"],
                }
            ],
            "speaker_turns": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5}],
            "events": [{"type": "non_speech", "start": 0.5, "end": 1.0}],
            "analysis": {
                "config": {"pause_min": 0.15},
                "pauses": [
                    {"speaker": "SPEAKER_00", "start": 0.5, "end": 0.8, "dur": 0.3, "type": "intra_speaker_word_gap"}
                ],
                "nonspeech_intervals": [{"start": 0.8, "end": 1.0, "dur": 0.2, "method": "vad_gap"}],
                "ipus": [
                    {"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5, "dur": 0.5, "text": "hello", "n_words": 1}
                ],
                "transitions": [],
                "overlaps": [],
            },
        },
        "pipeline_chunking": {"enabled": False, "mode": "single_pass"},
    }

    outputs = write_data_science_exports(
        output_dir=str(tmp_path),
        audio_path="sample.wav",
        result=result,
        run_metadata={"config": {"model": "small"}},
    )

    for path in outputs.values():
        assert Path(path).is_file()

    assert Path(outputs["timeline_jsonl"]).read_text(encoding="utf-8").strip()
    assert "WEBVTT" in Path(outputs["segments_vtt"]).read_text(encoding="utf-8")
    srt_text = Path(outputs["segments_srt"]).read_text(encoding="utf-8")
    assert "-->" in srt_text
    assert "hello" in srt_text

    words_rows = list(
        csv.DictReader(
            Path(outputs["words_csv"]).read_text(encoding="utf-8").splitlines()
        )
    )
    assert len(words_rows) == 1
    assert words_rows[0]["word"] == "hello"
    assert words_rows[0]["speaker"] == "SPEAKER_00"

    pauses_rows = list(
        csv.DictReader(
            Path(outputs["pauses_csv"]).read_text(encoding="utf-8").splitlines()
        )
    )
    assert len(pauses_rows) == 1
    assert pauses_rows[0]["type"] == "intra_speaker_word_gap"

    ipu_rows = list(
        csv.DictReader(
            Path(outputs["ipu_csv"]).read_text(encoding="utf-8").splitlines()
        )
    )
    assert len(ipu_rows) == 1
    assert ipu_rows[0]["text"] == "hello"
    assert ipu_rows[0]["n_words"] == "1"

    run_payload = json.loads(Path(outputs["run_json"]).read_text(encoding="utf-8"))
    assert run_payload["config"]["model"] == "small"
    assert run_payload["artifacts"]["timelineJson"].endswith(".timeline.json")
    assert run_payload["artifacts"]["timelineJsonl"].endswith(".timeline.jsonl")
    assert run_payload["counts"]["words"] == 1
    assert run_payload["counts"]["ipus"] == 1

    manifest = json.loads(Path(outputs["run_manifest_json"]).read_text(encoding="utf-8"))
    for rel in manifest["artifacts"].values():
        assert (tmp_path / rel).is_file()
