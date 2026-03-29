"""Tests — parsing des lignes Progress WhisperX et mapping progression job."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from worker import (
    WhisperxProgressMapper,
    _normalize_output_format_for_cli,
    collect_output_files,
    parse_whisperx_progress_line,
)


class TestParseWhisperxProgressLine(unittest.TestCase):
    def test_matches_standard(self) -> None:
        self.assertAlmostEqual(parse_whisperx_progress_line("Progress: 42.50%...") or 0, 42.5)
        self.assertAlmostEqual(parse_whisperx_progress_line("progress: 7%") or 0, 7.0)

    def test_no_match(self) -> None:
        self.assertIsNone(parse_whisperx_progress_line("Transcript: [0 --> 1] hello"))
        self.assertIsNone(parse_whisperx_progress_line(""))


class TestWhisperxProgressMapper(unittest.TestCase):
    def test_transcription_ramp(self) -> None:
        m = WhisperxProgressMapper()
        self.assertIsNone(m.feed(0.0))
        self.assertEqual(m.feed(100.0), 65)

    def test_phase_reset_align_or_chunk(self) -> None:
        m = WhisperxProgressMapper()
        self.assertEqual(m.feed(100.0), 65)
        self.assertIsNone(m.feed(0.0))
        self.assertEqual(m.feed(100.0), 90)

    def test_third_reset_uses_remaining_span(self) -> None:
        m = WhisperxProgressMapper()
        self.assertEqual(m.feed(100.0), 65)
        self.assertIsNone(m.feed(0.0))
        self.assertEqual(m.feed(100.0), 90)
        self.assertIsNone(m.feed(0.0))
        self.assertEqual(m.feed(100.0), 95)

    def test_diarize_linear_mapping(self) -> None:
        """0–100 % WhisperX diarisation → reliquat job jusqu’à 95 % (sans reset de phase)."""
        m = WhisperxProgressMapper()
        self.assertEqual(m.feed(100.0), 65)
        self.assertEqual(m.feed(50.0, "wx_diarize"), 80)
        self.assertEqual(m.feed(100.0, "wx_diarize"), 95)


class TestNormalizeOutputFormat(unittest.TestCase):
    def test_multi_adds_json(self) -> None:
        fmt, forced = _normalize_output_format_for_cli({"outputFormat": "srt,vtt"})
        self.assertTrue(forced)
        self.assertEqual(fmt, "json,srt,vtt")

    def test_multi_keeps_json(self) -> None:
        fmt, forced = _normalize_output_format_for_cli({"outputFormat": "json,srt"})
        self.assertFalse(forced)
        self.assertEqual(fmt, "json,srt")

    def test_all(self) -> None:
        fmt, forced = _normalize_output_format_for_cli({"outputFormat": "all"})
        self.assertFalse(forced)
        self.assertEqual(fmt, "all")


class TestCollectOutputFiles(unittest.TestCase):
    def test_skips_chunk_resume_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "clip.aligned.json").write_text("{}", encoding="utf-8")
            (root / "chunk_0001.raw.json").write_text("{}", encoding="utf-8")
            (root / "foo.chunk_0002.jsonl").write_text("", encoding="utf-8")
            (root / "chunk_manifest.json").write_text("{}", encoding="utf-8")
            out = collect_output_files(root)
            self.assertEqual(len(out), 2)
            self.assertTrue(any(p.endswith("clip.aligned.json") for p in out))
            self.assertTrue(any(p.endswith("chunk_manifest.json") for p in out))


if __name__ == "__main__":
    unittest.main()
