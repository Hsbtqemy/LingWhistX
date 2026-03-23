"""
Tests sans ffmpeg/torch pour `whisperx-studio/python/studio_audio_modules.py`.

Le répertoire `whisperx-studio/python` est ajouté au path (hors package whisperx).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[1]
_STUDIO_PY = _REPO_ROOT / "whisperx-studio" / "python"
if str(_STUDIO_PY) not in sys.path:
    sys.path.insert(0, str(_STUDIO_PY))

import studio_audio_modules as sam  # noqa: E402


def test_summarize_requested_modules_basic() -> None:
    s = sam.summarize_requested_modules(
        {
            "audioPipelineModules": {
                "preNormalize": True,
                "vadEnergy": {"noiseDb": -48},
                "ignored": 1,
            }
        }
    )
    assert s is not None
    assert "preNormalize=true" in s
    assert "vadEnergy=" in s
    assert "unknown_keys=" in s


def test_maybe_prepare_no_modules_returns_same_path(tmp_path: Path) -> None:
    media = tmp_path / "clip.wav"
    media.write_bytes(b"fake")
    out = sam.maybe_prepare_audio_input(str(media), tmp_path, {}, emit_log=None)
    assert Path(out) == media.resolve()


def test_maybe_prepare_unknown_keys_only_no_op(tmp_path: Path) -> None:
    media = tmp_path / "clip.wav"
    media.write_bytes(b"fake")
    out = sam.maybe_prepare_audio_input(
        str(media),
        tmp_path,
        {"audioPipelineModules": {"not_a_canonical_key": True}},
        emit_log=None,
    )
    assert Path(out) == media.resolve()


def test_merge_time_intervals() -> None:
    assert sam._merge_time_intervals([(0, 5), (4, 8)]) == [(0, 8)]


def test_speech_intervals_from_silence() -> None:
    assert sam._speech_intervals_from_silence(30.0, [(10, 20)]) == [(0, 10), (20, 30)]


def test_merge_adjacent_by_gap() -> None:
    assert sam._merge_adjacent_by_gap([(0, 1), (1.2, 2)], 0.35) == [(0.0, 2.0)]
    assert sam._merge_adjacent_by_gap([(0, 1), (2, 3)], 0.35) == [(0, 1), (2, 3)]


def test_pairwise_time_overlaps() -> None:
    o = sam._pairwise_time_overlaps([(0, 3), (1, 2)])
    assert len(o) == 1
    assert o[0]["segmentIndices"] == [0, 1]


def test_pack_wall_clock_chunks() -> None:
    assert sam._pack_wall_clock_chunks([(0, 5), (6, 10)], 30) == [(0, 10)]
    assert len(sam._pack_wall_clock_chunks([(0, 100)], 30)) == 4


@pytest.mark.parametrize(
    "spec, key, expected",
    [
        ({}, "vadEnergy", False),
        ({"vadEnergy": True}, "vadEnergy", True),
        ({"vadEnergy": {}}, "vadEnergy", True),
        ({"vadEnergy": False}, "vadEnergy", False),
    ],
)
def test_module_wants(spec: dict, key: str, expected: bool) -> None:
    assert sam._module_wants(spec, key) is expected
