import json
from pathlib import Path

from whisperx.utils import get_writer

GOLDEN_DIR = Path(__file__).parent / "golden" / "writers"

DEFAULT_WRITER_OPTIONS = {
    "highlight_words": False,
    "max_line_count": None,
    "max_line_width": None,
    "segment_resolution": "sentence",
}


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n")


def _read_golden(name: str) -> str:
    return _normalize_newlines((GOLDEN_DIR / name).read_text(encoding="utf-8"))


def _write_output(
    output_format: str,
    result: dict,
    audio_stem: str,
    tmp_path: Path,
    writer_options: dict,
) -> str:
    writer = get_writer(output_format, str(tmp_path))
    writer(result, f"{audio_stem}.wav", writer_options)
    output_path = tmp_path / f"{audio_stem}.{output_format}"
    return _normalize_newlines(output_path.read_text(encoding="utf-8"))


def _english_result_with_words() -> dict:
    return {
        "language": "en",
        "segments": [
            {
                "start": 0.0,
                "end": 0.9,
                "text": "Hello world",
                "speaker": "SPEAKER_00",
                "words": [
                    {"word": "Hello", "start": 0.0, "end": 0.4},
                    {"word": "world", "start": 0.5, "end": 0.9},
                ],
            },
            {
                "start": 1.0,
                "end": 1.8,
                "text": "Again now",
                "speaker": "SPEAKER_01",
                "words": [
                    {"word": "Again", "start": 1.0, "end": 1.4},
                    {"word": "now", "start": 1.5, "end": 1.8},
                ],
            },
        ],
    }


def _ja_result_with_words() -> dict:
    return {
        "language": "ja",
        "segments": [
            {
                "start": 0.0,
                "end": 0.5,
                "text": "AB",
                "words": [
                    {"word": "A", "start": 0.0, "end": 0.2},
                    {"word": "B", "start": 0.2, "end": 0.5},
                ],
            }
        ],
    }


def test_writer_json_matches_golden(tmp_path):
    result = _english_result_with_words()
    actual = _write_output(
        "json",
        result,
        "english_sentence",
        tmp_path,
        dict(DEFAULT_WRITER_OPTIONS),
    )
    expected = _read_golden("english_sentence.json")
    assert actual == expected.rstrip("\n")
    assert json.loads(actual)["language"] == "en"


def test_writer_srt_sentence_resolution_matches_golden(tmp_path):
    actual = _write_output(
        "srt",
        _english_result_with_words(),
        "english_sentence",
        tmp_path,
        dict(DEFAULT_WRITER_OPTIONS),
    )
    expected = _read_golden("english_sentence.srt")
    assert actual == expected


def test_writer_vtt_sentence_resolution_matches_golden(tmp_path):
    actual = _write_output(
        "vtt",
        _english_result_with_words(),
        "english_sentence",
        tmp_path,
        dict(DEFAULT_WRITER_OPTIONS),
    )
    expected = _read_golden("english_sentence.vtt")
    assert actual == expected


def test_writer_srt_chunk_resolution_matches_golden(tmp_path):
    options = dict(DEFAULT_WRITER_OPTIONS)
    options["segment_resolution"] = "chunk"
    actual = _write_output(
        "srt",
        _english_result_with_words(),
        "english_chunk",
        tmp_path,
        options,
    )
    expected = _read_golden("english_chunk.srt")
    assert actual == expected


def test_writer_vtt_ja_without_spaces_matches_golden(tmp_path):
    actual = _write_output(
        "vtt",
        _ja_result_with_words(),
        "ja_sentence",
        tmp_path,
        dict(DEFAULT_WRITER_OPTIONS),
    )
    expected = _read_golden("ja_sentence.vtt")
    assert actual == expected
