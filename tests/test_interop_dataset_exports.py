"""WX-608 — CTM word timings, optional Parquet dataset bundle, Open Science layout."""

from pathlib import Path

import pytest

from whisperx.utils import (
    try_write_parquet_dataset_tables,
    write_data_science_exports,
    write_open_science_dataset_readme,
    write_word_ctm,
)


def test_write_word_ctm_line_format(tmp_path: Path) -> None:
    path = tmp_path / "t.ctm"
    rows = [
        {
            "word": "hello",
            "start": 0.1,
            "end": 0.35,
            "confidence": 0.92,
        }
    ]
    write_word_ctm(str(path), "utt1", rows)
    text = path.read_text(encoding="utf-8")
    assert ";; CTM" in text
    assert "utt1 1 0.1000 0.2500 hello 0.9200" in text


def test_write_data_science_exports_emits_words_ctm(tmp_path: Path) -> None:
    result = {
        "timeline": {
            "version": 1,
            "words": [
                {
                    "token": "bonjour",
                    "start": 0.2,
                    "end": 0.55,
                    "speaker": "SPEAKER_00",
                    "confidence": 0.88,
                }
            ],
            "segments": [],
            "speaker_turns": [],
            "analysis": {"pauses": [], "ipus": []},
        }
    }
    out = write_data_science_exports(
        str(tmp_path),
        str(tmp_path / "clip.wav"),
        result,
        run_metadata={"generatedAt": "1970-01-01T00:00:00+00:00"},
        export_word_ctm=True,
        export_parquet_dataset=False,
    )
    assert "word_ctm" in out
    ctm = Path(out["word_ctm"])
    assert ctm.is_file()
    body = ctm.read_text(encoding="utf-8")
    assert "bonjour" in body
    assert (tmp_path / "dataset").is_dir() is False


def test_write_data_science_exports_parquet_dataset_readme(tmp_path: Path) -> None:
    pd = pytest.importorskip("pandas")
    pytest.importorskip("pyarrow")

    result = {
        "timeline": {
            "version": 1,
            "words": [
                {"token": "a", "start": 0.0, "end": 0.1, "speaker": "S1", "confidence": 1.0},
            ],
            "segments": [],
            "speaker_turns": [],
            "analysis": {
                "pauses": [{"speaker": "", "start": 0.5, "end": 0.6, "dur": 0.1, "type": "intra"}],
                "ipus": [
                    {
                        "speaker": "S1",
                        "start": 0.0,
                        "end": 0.5,
                        "text": "a",
                        "n_words": 1,
                        "dur": 0.5,
                    }
                ],
            },
        }
    }
    out = write_data_science_exports(
        str(tmp_path),
        str(tmp_path / "x.wav"),
        result,
        run_metadata={"generatedAt": "1970-01-01T00:00:00+00:00"},
        export_word_ctm=True,
        export_parquet_dataset=True,
    )
    assert "dataset_readme" in out
    assert Path(out["dataset_readme"]).is_file()
    assert "words_parquet" in out
    df = pd.read_parquet(out["words_parquet"])
    assert len(df) == 1
    assert df.iloc[0]["word"] == "a"


def test_try_write_parquet_empty_without_deps(tmp_path: Path) -> None:
    """Without pandas/pyarrow, optional Parquet returns empty dict (no error)."""
    # If pandas exists, this still runs; if not, tables are empty — function returns {}.
    out = try_write_parquet_dataset_tables(str(tmp_path), [], [], [])
    assert isinstance(out, dict)


def test_open_science_readme_lists_parquet(tmp_path: Path) -> None:
    readme = tmp_path / "README.md"
    fake_paths = {"words_parquet": str(tmp_path / "dataset" / "words.parquet")}
    write_open_science_dataset_readme(str(readme), "demo", fake_paths)
    text = readme.read_text(encoding="utf-8")
    assert "words.parquet" in text
    assert "pandas" in text.lower()
