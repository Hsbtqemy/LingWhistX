"""Tests — parsing des lignes Progress WhisperX et mapping progression job."""

from __future__ import annotations

import unittest

from worker import WhisperxProgressMapper, parse_whisperx_progress_line


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


if __name__ == "__main__":
    unittest.main()
