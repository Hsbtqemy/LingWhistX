"""Tests — module partagé log_sanitize (chemins, USERPROFILE, masquage --hf_token)."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from log_sanitize import (
    _apply_env_redactions,
    format_command_for_log,
    sanitize_exception_message,
    sanitize_log_line,
    sanitize_path_for_log,
)


class TestLogSanitize(unittest.TestCase):
    def test_format_command_masks_hf_token(self) -> None:
        cmd = ["python", "-m", "whisperx", "in.wav", "--hf_token", "secret123"]
        out = format_command_for_log(cmd)
        self.assertIn("***", out)
        self.assertNotIn("secret123", out)

    def test_format_command_masks_hf_token_equals_form(self) -> None:
        cmd = ["whisperx", "in.wav", "--hf_token=secret456"]
        out = format_command_for_log(cmd)
        self.assertIn("--hf_token=***", out)
        self.assertNotIn("secret456", out)

    def test_sanitize_path_under_home(self) -> None:
        home = str(Path.home())
        p = str(Path(home) / "Documents" / "a.wav")
        out = sanitize_path_for_log(p)
        self.assertTrue(out.startswith("~"))
        self.assertNotIn(home, out)

    def test_sanitize_log_line_replaces_home(self) -> None:
        home = str(Path.home())
        line = f"error reading {home}/foo/bar.txt"
        self.assertNotIn(home, sanitize_log_line(line))

    def test_sanitize_log_line_replaces_userprofile_when_distinct(self) -> None:
        fake_profile = "C:\\Users\\TestUser"
        line = f"open {fake_profile}\\AppData\\x.txt failed"
        with patch.dict(os.environ, {"USERPROFILE": fake_profile}, clear=False):
            out = sanitize_log_line(line)
        self.assertNotIn(fake_profile, out)
        self.assertIn("~", out)

    def test_sanitize_log_line_replaces_localappdata_when_distinct(self) -> None:
        fake_local = "C:\\Users\\X\\AppData\\Local\\Temp\\t"
        line = f"failed: {fake_local}\\a.txt"
        with patch.dict(os.environ, {"LOCALAPPDATA": fake_local}, clear=False):
            out = sanitize_log_line(line)
        self.assertNotIn(fake_local, out)
        self.assertIn("~LOCALAPPDATA", out)

    def test_sanitize_log_line_replaces_appdata_roaming_when_distinct(self) -> None:
        fake_roam = "C:\\Users\\X\\AppData\\Roaming\\App"
        line = f"config {fake_roam}\\x.json"
        with patch.dict(os.environ, {"APPDATA": fake_roam}, clear=False):
            out = sanitize_log_line(line)
        self.assertNotIn(fake_roam, out)
        self.assertIn("~APPDATA", out)

    def test_sanitize_log_line_replaces_xdg_config_when_set(self) -> None:
        fake_xdg = "/custom/xdg-config"
        line = f"err: {fake_xdg}/foo"
        with patch.dict(os.environ, {"XDG_CONFIG_HOME": fake_xdg}, clear=False):
            out = sanitize_log_line(line)
        self.assertNotIn(fake_xdg, out)
        self.assertIn("~XDG_CONFIG_HOME", out)

    def test_apply_env_redactions_sorts_by_length_regardless_of_pair_order(self) -> None:
        short_p = "/tmp/wx_order_short"
        long_p = f"{short_p}/nested"
        line = f"path={long_p}/x"
        pairs_reversed = [(short_p, "~"), (long_p, "~LONG")]
        out = _apply_env_redactions(line, pairs_reversed)
        self.assertNotIn(long_p, out)
        self.assertIn("~LONG", out)

    def test_sanitize_log_line_nested_long_path_before_home_prefix(self) -> None:
        """Le chemin le plus long doit être remplacé avant un préfixe HOME plus court (ordre stable)."""
        short_home = "/tmp/wxredact_nested_home"
        long_xdg = f"{short_home}/.config"
        line = f"read {long_xdg}/app.toml"
        with patch("log_sanitize.Path.home", return_value=Path(short_home)):
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": long_xdg}, clear=False):
                out = sanitize_log_line(line)
        self.assertNotIn(long_xdg, out)
        self.assertIn("~XDG_CONFIG_HOME", out)

    def test_format_command_sanitizes_paths_in_argv(self) -> None:
        home = str(Path.home())
        p = str(Path(home) / "media" / "clip.wav")
        cmd = ["python", "-m", "whisperx", p, "--model", "small"]
        out = format_command_for_log(cmd)
        self.assertNotIn(home, out)

    def test_sanitize_exception_message(self) -> None:
        home = str(Path.home())
        exc = RuntimeError(f"read failed: {home}/f.txt")
        msg = sanitize_exception_message(exc)
        self.assertNotIn(home, msg)


if __name__ == "__main__":
    unittest.main()
