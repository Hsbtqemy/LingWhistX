"""Tests unitaires WX-623 — validation des plages pipeline audio."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from studio_audio_modules import maybe_prepare_audio_input, validate_audio_pipeline_segments


def _resolve_ffmpeg() -> str | None:
    """Même logique que le worker : `FFMPEG_BINARY` puis PATH (`ffmpeg`)."""
    raw = os.environ.get("FFMPEG_BINARY", "").strip()
    if raw:
        p = Path(raw)
        if p.is_file():
            return str(p)
        w = shutil.which(raw)
        if w:
            return w
    return shutil.which("ffmpeg")


def _resolve_ffprobe() -> str | None:
    """`FFPROBE_BINARY` puis PATH, puis `ffprobe` à côté du binaire ffmpeg (ex. Homebrew)."""
    raw = os.environ.get("FFPROBE_BINARY", "").strip()
    if raw:
        p = Path(raw)
        if p.is_file():
            return str(p)
        w = shutil.which(raw)
        if w:
            return w
    w = shutil.which("ffprobe")
    if w:
        return w
    ff = _resolve_ffmpeg()
    if ff:
        ff_path = Path(ff)
        if ff_path.is_file():
            sib = ff_path.parent / "ffprobe"
            if sib.is_file():
                return str(sib)
    return None


def _ffmpeg_available() -> bool:
    return _resolve_ffmpeg() is not None and _resolve_ffprobe() is not None


def _ffprobe_available() -> bool:
    return _resolve_ffprobe() is not None


def _make_silence_wav(path: Path, duration_sec: float = 4.0) -> None:
    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("ffmpeg introuvable (FFMPEG_BINARY ou PATH)")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=mono",
            "-t",
            str(duration_sec),
            "-acodec",
            "pcm_s16le",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


class TestWx623Segments(unittest.TestCase):
    def test_two_non_overlapping_ok(self) -> None:
        segs = [
            {"startSec": 0.0, "endSec": 1.0},
            {"startSec": 2.0, "endSec": 3.5},
        ]
        out = validate_audio_pipeline_segments(segs, 10.0)
        self.assertEqual(len(out), 2)

    def test_overlap_raises(self) -> None:
        with self.assertRaises(RuntimeError):
            validate_audio_pipeline_segments(
                [
                    {"startSec": 0, "endSec": 2},
                    {"startSec": 1.5, "endSec": 3},
                ],
                10.0,
            )

    def test_out_of_bounds_raises(self) -> None:
        with self.assertRaises(RuntimeError):
            validate_audio_pipeline_segments(
                [{"startSec": 0, "endSec": 100}],
                10.0,
            )


_SKIP_FFMPEG_MSG = (
    "ffmpeg + ffprobe introuvables : PATH, ou variables FFMPEG_BINARY / FFPROBE_BINARY "
    "(comme le worker ; ex. `brew install ffmpeg` sur macOS)."
)


@unittest.skipUnless(_ffmpeg_available(), _SKIP_FFMPEG_MSG)
class TestWx623Integration(unittest.TestCase):
    """Cas court sur fichier WAV réel (ffmpeg) — acceptance / DoD."""

    def test_segment_concat_deux_plages_sans_modules(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "in.wav"
            out_dir = td_path / "out"
            out_dir.mkdir()
            _make_silence_wav(src, 4.0)
            opts: dict[str, object] = {
                "audioPipelineSegments": [
                    {"startSec": 0.2, "endSec": 0.9},
                    {"startSec": 1.5, "endSec": 2.2},
                ],
            }
            result = maybe_prepare_audio_input(str(src), out_dir, opts, emit_log=None)
            self.assertTrue(result.endswith("segment_concat.wav"))
            self.assertTrue(Path(result).is_file())
            man = out_dir / "studio_audio_pipeline" / "segment_pipeline_manifest.json"
            self.assertTrue(man.is_file())
            data = json.loads(man.read_text(encoding="utf-8"))
            self.assertTrue(data.get("wx623SegmentPipeline"))
            self.assertEqual(data.get("segmentCount"), 2)

    def test_deux_plages_pre_normalize_sur_la_premiere_seulement(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "in.wav"
            out_dir = td_path / "out"
            out_dir.mkdir()
            _make_silence_wav(src, 5.0)
            opts: dict[str, object] = {
                "audioPipelineSegments": [
                    {
                        "startSec": 0.2,
                        "endSec": 1.0,
                        "audioPipelineModules": {"preNormalize": True},
                    },
                    {"startSec": 1.5, "endSec": 2.3},
                ],
            }
            result = maybe_prepare_audio_input(str(src), out_dir, opts, emit_log=None)
            self.assertTrue(result.endswith("segment_concat.wav"))
            man = json.loads(
                (out_dir / "studio_audio_pipeline" / "segment_pipeline_manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            rows = man["segments"]
            self.assertEqual(len(rows), 2)
            self.assertIsInstance(rows[0]["modules"], dict)
            self.assertTrue(rows[0]["modules"].get("preNormalize"))
            self.assertIsNone(rows[1]["modules"])

    def test_sans_plages_audio_pipeline_modules_seul_pas_de_segment_concat(self) -> None:
        """Régression : pas de mode segments → pipeline global inchangé."""
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "in.wav"
            out_dir = td_path / "out"
            out_dir.mkdir()
            _make_silence_wav(src, 3.0)
            result = maybe_prepare_audio_input(
                str(src),
                out_dir,
                {"audioPipelineModules": {"preNormalize": True}},
                emit_log=None,
            )
            self.assertIn("normalized.wav", result.replace("\\", "/"))
            self.assertFalse((out_dir / "studio_audio_pipeline" / "segment_concat.wav").exists())

    def test_emit_log_resume_plages(self) -> None:
        messages: list[str] = []

        def emit_log(_lvl: str, _stage: str, msg: str, _prog: int | None) -> None:
            messages.append(msg)

        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "in.wav"
            out_dir = td_path / "out"
            out_dir.mkdir()
            _make_silence_wav(src, 4.0)
            opts: dict[str, object] = {
                "audioPipelineSegments": [
                    {"startSec": 0.2, "endSec": 0.8},
                    {"startSec": 1.5, "endSec": 2.2},
                ],
            }
            maybe_prepare_audio_input(str(src), out_dir, opts, emit_log=emit_log)
        joined = "\n".join(messages)
        self.assertIn("WX-623", joined)
        self.assertIn("plage(s) validée(s)", joined)
        self.assertIn("0.20-0.80s", joined)
        self.assertIn("1.50-2.20s", joined)
        self.assertIn("segment_concat.wav", joined)


_SKIP_FFPROBE_MSG = (
    "ffprobe introuvable : PATH ou FFPROBE_BINARY (souvent le même répertoire que ffmpeg)."
)


@unittest.skipUnless(_ffprobe_available(), _SKIP_FFPROBE_MSG)
class TestWx623ProbeErrors(unittest.TestCase):
    """Erreur explicite si le média n'existe pas (avant extraction ffmpeg)."""

    def test_media_introuvable_erreur_explicite(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            out_dir = Path(td) / "out"
            out_dir.mkdir()
            with self.assertRaises(RuntimeError) as ctx:
                maybe_prepare_audio_input(
                    str(Path(td) / "fichier_inexistant.wav"),
                    out_dir,
                    {"audioPipelineSegments": [{"startSec": 0.1, "endSec": 1.0}]},
                    emit_log=None,
                )
            self.assertIn("ffprobe", str(ctx.exception).lower())


if __name__ == "__main__":
    unittest.main()
