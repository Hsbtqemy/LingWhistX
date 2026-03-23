"""Tests for RTTM / TextGrid / EAF annotation exports from speaker_turns."""

from pathlib import Path

from whisperx.annotation_exports import (
    collect_speaker_turns,
    write_annotation_exports,
    write_eaf,
    write_rttm,
    write_textgrid,
)


def test_collect_speaker_turns_from_timeline() -> None:
    result = {
        "timeline": {
            "speaker_turns": [
                {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
                {"speaker": "SPEAKER_01", "start": 1.0, "end": 2.5},
            ]
        }
    }
    turns = collect_speaker_turns(result)
    assert len(turns) == 2
    assert turns[0]["speaker"] == "SPEAKER_00"


def test_write_annotation_exports_writes_files(tmp_path: Path) -> None:
    result = {
        "timeline": {
            "speaker_turns": [
                {"speaker": "SPEAKER_00", "start": 0.1, "end": 1.2},
            ]
        },
        "segments": [{"start": 0.0, "end": 1.5, "text": "hi", "speaker": "SPEAKER_00"}],
    }
    out = write_annotation_exports(
        str(tmp_path),
        "clip.wav",
        result,
        rttm=True,
        textgrid=True,
        eaf=True,
    )
    assert "rttm" in out and Path(out["rttm"]).is_file()
    assert "textgrid" in out and Path(out["textgrid"]).is_file()
    assert "eaf" in out and Path(out["eaf"]).is_file()

    rttm_text = Path(out["rttm"]).read_text(encoding="utf-8")
    assert "SPEAKER clip" in rttm_text or "SPEAKER" in rttm_text
    assert "SPEAKER_00" in rttm_text

    tg = Path(out["textgrid"]).read_text(encoding="utf-8")
    assert "ooTextFile" in tg
    assert "IntervalTier" in tg
    assert "SPEAKER_00" in tg

    eaf = Path(out["eaf"]).read_text(encoding="utf-8")
    assert "ANNOTATION_DOCUMENT" in eaf
    assert "SPEAKER_00" in eaf


def test_rttm_textgrid_eaf_roundtrip_helpers(tmp_path: Path) -> None:
    turns = [{"speaker": "A", "start": 0.0, "end": 0.5}]
    write_rttm(str(tmp_path / "t.rttm"), "fid", turns)
    write_textgrid(str(tmp_path / "t.TextGrid"), turns, 1.0)
    write_eaf(str(tmp_path / "t.eaf"), turns, 1.0)
    assert (tmp_path / "t.rttm").read_text().strip().startswith("SPEAKER")
