"""Parsing de scalaires JSON en nombres (point unique pour ``as_float``)."""

from __future__ import annotations

import math
from typing import Any

_AS_FLOAT_MISSING = object()


def _parse_float_optional(value: Any) -> float | None:
    """Parse un scalaire en float ou ``None`` si absent/invalide (sémantique timeline / alignement)."""
    if isinstance(value, (int, float)):
        numeric = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            numeric = float(text)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(numeric):
        return None
    return numeric


def as_float(value: Any, default: Any = _AS_FLOAT_MISSING) -> float | None:
    """
    Parse un scalaire JSON en ``float``.

    - Un seul argument : retourne ``float`` ou ``None`` si absent/invalide.
    - Avec ``default`` : retourne toujours un ``float`` (sémantique chunk_merge : ``default`` si invalide).
    """
    if default is _AS_FLOAT_MISSING:
        return _parse_float_optional(value)
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(numeric):
        return default
    return numeric
