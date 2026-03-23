"""WX-603 — presets pause (sport_tv, interview) et calibration sur fenêtre temporelle.

Bornes documentées (secondes) pour chaque preset:
- sport_tv: pauses courtes, débit soutenu (type plateau TV / commentaire sportif).
- interview: pauses plus longues, débit plus mesuré.

La calibration estime pause_ignore_below (quantile des petits gaps) et pause_min
(heuristique sur la distribution des gaps intra-locuteur dans une fenêtre).
"""

from __future__ import annotations

import math
from typing import Any

from whisperx.schema import CanonicalTimelineWord

EPS = 1e-6

# Presets: valeurs par défaut pour pause_min / pause_ignore_below (secondes).
PAUSE_ANALYSIS_PRESETS: dict[str, dict[str, Any]] = {
    "sport_tv": {
        "pause_min": 0.12,
        "pause_ignore_below": 0.08,
        "bounds_note": "pause_min in [0.10, 0.18], pause_ignore_below in [0.06, 0.12]",
    },
    "interview": {
        "pause_min": 0.18,
        "pause_ignore_below": 0.12,
        "bounds_note": "pause_min in [0.14, 0.28], pause_ignore_below in [0.08, 0.16]",
    },
}

MIN_CALIBRATION_WINDOW_SEC = 2.0
MIN_GAPS_FOR_CALIBRATION = 5
QUANTILE_IGNORE_BELOW = 0.25
QUANTILE_PAUSE_MIN = 0.65
IGNORE_BELOW_CLAMP = (0.04, 0.18)
PAUSE_MIN_CLAMP = (0.08, 0.55)


def _quantile_sorted(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return sorted_vals[lo]
    w = pos - lo
    return sorted_vals[lo] * (1.0 - w) + sorted_vals[hi] * w


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def collect_intra_speaker_gaps(
    words: list[CanonicalTimelineWord],
    t0: float,
    t1: float,
) -> list[float]:
    """Gaps entre mots consécutifs du même locuteur dont le milieu du gap est dans [t0, t1]."""
    if t1 <= t0 or not words:
        return []
    gaps: list[float] = []
    for i in range(len(words) - 1):
        a = words[i]
        b = words[i + 1]
        sp_a = a.get("speaker")
        sp_b = b.get("speaker")
        if sp_a is None or sp_b is None or sp_a != sp_b:
            continue
        a_end = float(a["end"])
        b_start = float(b["start"])
        g = b_start - a_end
        if g < -EPS:
            continue
        g = max(0.0, g)
        mid = 0.5 * (a_end + b_start)
        if t0 <= mid <= t1:
            gaps.append(g)
    return gaps


def calibrate_pause_thresholds_from_gaps(gaps: list[float]) -> tuple[float, float, dict[str, Any]]:
    """Quantiles + bornes sur gaps triés. Retourne (pause_ignore_below, pause_min, meta)."""
    vals = sorted(gaps)
    q_ig = _quantile_sorted(vals, QUANTILE_IGNORE_BELOW)
    q_pm = _quantile_sorted(vals, QUANTILE_PAUSE_MIN)
    pause_ignore_below = _clamp(q_ig, IGNORE_BELOW_CLAMP[0], IGNORE_BELOW_CLAMP[1])
    pause_min = _clamp(max(pause_ignore_below, q_pm), PAUSE_MIN_CLAMP[0], PAUSE_MIN_CLAMP[1])
    meta = {
        "quantile_ignore_below": QUANTILE_IGNORE_BELOW,
        "quantile_pause_min": QUANTILE_PAUSE_MIN,
        "n_gaps": len(gaps),
    }
    return pause_ignore_below, pause_min, meta


def run_pause_calibration(
    words: list[CanonicalTimelineWord],
    calibration: dict[str, Any],
) -> dict[str, Any]:
    """Évalue la calibration; retourne un dict avec status ok | skipped_* et seuils si ok."""
    window_sec = calibration.get("window_sec")
    try:
        wsec = float(window_sec) if window_sec is not None else 0.0
    except (TypeError, ValueError):
        wsec = 0.0
    start_sec = calibration.get("start_sec")
    try:
        t0 = float(start_sec) if start_sec is not None else 0.0
    except (TypeError, ValueError):
        t0 = 0.0

    if wsec <= 0 or not math.isfinite(wsec) or not math.isfinite(t0):
        return {"status": "skipped", "reason": "invalid_or_missing_window_sec"}

    t1 = t0 + wsec
    if wsec < MIN_CALIBRATION_WINDOW_SEC:
        return {
            "status": "skipped_short_window",
            "window_sec": round(wsec, 4),
            "min_window_sec": MIN_CALIBRATION_WINDOW_SEC,
        }

    gaps = collect_intra_speaker_gaps(words, t0, t1)
    if len(gaps) < MIN_GAPS_FOR_CALIBRATION:
        return {
            "status": "skipped_no_gaps",
            "n_gaps": len(gaps),
            "min_gaps": MIN_GAPS_FOR_CALIBRATION,
            "window_sec": round(wsec, 4),
            "start_sec": round(t0, 4),
        }

    pause_ignore_below, pause_min, qmeta = calibrate_pause_thresholds_from_gaps(gaps)
    out: dict[str, Any] = {
        "status": "ok",
        "window_sec": round(wsec, 4),
        "start_sec": round(t0, 4),
        "pause_ignore_below": round(pause_ignore_below, 4),
        "pause_min": round(pause_min, 4),
        **qmeta,
    }
    return out


def prepare_timeline_analysis_config(
    analysis_config: dict[str, Any] | None,
    words: list[CanonicalTimelineWord],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Applique preset puis calibration; retourne (config pour _normalize, métadonnées timeline)."""
    base: dict[str, Any] = dict(analysis_config or {})
    extras: dict[str, Any] = {}

    preset_name = base.pop("analysis_preset", None)
    if preset_name is None:
        preset_name = base.pop("preset", None)

    calibration = base.pop("calibration", None)

    if isinstance(preset_name, str):
        key = preset_name.strip()
        if key in PAUSE_ANALYSIS_PRESETS:
            p = PAUSE_ANALYSIS_PRESETS[key]
            base["pause_min"] = float(p["pause_min"])
            base["pause_ignore_below"] = float(p["pause_ignore_below"])
            extras["analysis_preset"] = key

    if isinstance(calibration, dict):
        meta = run_pause_calibration(words, calibration)
        extras["pause_calibration"] = meta
        if meta.get("status") == "ok":
            base["pause_min"] = float(meta["pause_min"])
            base["pause_ignore_below"] = float(meta["pause_ignore_below"])

    return base, extras
