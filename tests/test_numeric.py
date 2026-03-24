"""Tests pour ``whisperx.numeric.as_float`` (phase 5 refactor)."""

import math

import pytest

from whisperx.numeric import as_float
from whisperx.utils import as_float as as_float_from_utils


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1, 1.0),
        (1.5, 1.5),
        ("2.25", 2.25),
        ("  3  ", 3.0),
        ("", None),
        ("  ", None),
        ("x", None),
        (None, None),
        ([], None),
        (float("nan"), None),
        (float("inf"), None),
    ],
)
def test_as_float_optional_semantics(value, expected):
    assert as_float(value) == expected


def test_as_float_with_default_uses_default_when_invalid():
    assert as_float("bad", 0.0) == 0.0
    assert as_float(None, -1.0) == -1.0
    assert math.isnan(as_float("nope", float("nan")))


def test_utils_reexports_same_callable():
    assert as_float_from_utils is as_float
