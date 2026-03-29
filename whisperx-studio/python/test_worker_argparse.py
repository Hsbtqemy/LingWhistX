"""Tests — argparse du worker (WX-639) et contrat --output_format via _normalize_output_format_for_cli."""

from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

from worker import _normalize_output_format_for_cli, parse_args


class TestParseArgs(unittest.TestCase):
    """Le worker n'expose pas `--output_format` dans parse_args() : la valeur CLI WhisperX est dérivée via _normalize_output_format_for_cli(options)."""

    def test_minimal_argv(self) -> None:
        argv = [
            "worker.py",
            "--job-id",
            "job-1",
            "--input-path",
            "/media/in.wav",
            "--output-dir",
            "/out",
        ]
        with patch.object(sys, "argv", argv):
            ns = parse_args()
        self.assertEqual(ns.job_id, "job-1")
        self.assertEqual(ns.input_path, "/media/in.wav")
        self.assertEqual(ns.output_dir, "/out")
        self.assertEqual(ns.mode, "mock")
        self.assertIsNone(ns.options_json)

    def test_mode_choices(self) -> None:
        for mode in ("mock", "whisperx", "analyze_only"):
            with self.subTest(mode=mode):
                argv = [
                    "worker.py",
                    "--job-id",
                    "j",
                    "--input-path",
                    "/in",
                    "--output-dir",
                    "/out",
                    "--mode",
                    mode,
                ]
                with patch.object(sys, "argv", argv):
                    ns = parse_args()
                self.assertEqual(ns.mode, mode)

    def test_invalid_mode_exits(self) -> None:
        argv = [
            "worker.py",
            "--job-id",
            "j",
            "--input-path",
            "/in",
            "--output-dir",
            "/out",
            "--mode",
            "not_a_mode",
        ]
        with patch.object(sys, "argv", argv):
            with redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    parse_args()


class TestOutputFormatContract(unittest.TestCase):
    """Garde-fous contre une régression des formats acceptés côté options JSON (puis CLI WhisperX)."""

    def test_single_format(self) -> None:
        fmt, forced = _normalize_output_format_for_cli({"outputFormat": "srt"})
        self.assertTrue(forced)
        self.assertEqual(fmt, "json,srt")

    def test_empty_string_defaults(self) -> None:
        fmt, forced = _normalize_output_format_for_cli({"outputFormat": ""})
        self.assertFalse(forced)
        self.assertEqual(fmt, "all")


if __name__ == "__main__":
    unittest.main()
