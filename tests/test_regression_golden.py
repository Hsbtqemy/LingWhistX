"""
Non-régression chiffrée (WX-510) — métriques dérivées de build_canonical_timeline.

Mise à jour des golden (après revue humaine) :
  UPDATE_GOLDEN_METRICS=1 pytest tests/test_regression_golden.py -q
"""

import json
import os
from pathlib import Path

import pytest

from whisperx.timeline import build_canonical_timeline


def _fixture_result() -> dict:
    return {
        "segments": [
            {
                "start": 0.0,
                "end": 5.0,
                "text": "a b",
                "speaker": "S0",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.5, "score": 0.9},
                    {"word": "b", "start": 1.0, "end": 1.5, "score": 0.9},
                ],
            }
        ],
    }


def _metrics_from_timeline(tl: dict) -> dict:
    words = tl.get("words") or []
    n_aligned = sum(1 for w in words if w.get("alignment_status") == "aligned")
    n_interp = sum(1 for w in words if w.get("alignment_status") == "interpolated")
    pauses = (tl.get("analysis") or {}).get("pauses") or []
    intra = [p for p in pauses if p.get("type") == "intra_speaker_word_gap"]
    durs = [float(p["dur"]) for p in intra if p.get("dur") is not None]
    mean = sum(durs) / len(durs) if durs else 0.0
    sd = sorted(durs)
    p95 = sd[max(0, int(round(0.95 * (len(sd) - 1))))] if sd else 0.0
    return {
        "n_words": len(words),
        "n_aligned": n_aligned,
        "n_interpolated": n_interp,
        "n_pauses_intra_speaker_word_gap": len(intra),
        "mean_pause_dur_intra": round(mean, 3),
        "p95_pause_dur_intra": round(p95, 3),
    }


def _within_pct(actual: float, expected: float, tol_pct: float) -> bool:
    if expected == 0:
        return abs(actual) < 1e-6
    return abs(actual - expected) / abs(expected) <= tol_pct + 1e-6


def test_golden_metrics_match_fixture() -> None:
    golden_path = Path(__file__).resolve().parent / "fixtures" / "golden_metrics.json"
    raw = json.loads(golden_path.read_text(encoding="utf-8"))
    cfg = raw["analysis_config"]
    expected = raw["metrics"]
    tol = float(raw.get("tolerance_pct", 0.05))

    tl = build_canonical_timeline(_fixture_result(), analysis_config=cfg)
    got = _metrics_from_timeline(tl)

    if os.getenv("UPDATE_GOLDEN_METRICS", "").strip().lower() in ("1", "true", "yes"):
        expected.update(got)
        raw["metrics"] = expected
        golden_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        pytest.skip("golden_metrics.json updated; disable UPDATE_GOLDEN_METRICS and re-run")

    for key, exp_val in expected.items():
        if isinstance(exp_val, (int, float)):
            gv = got.get(key)
            assert gv is not None, f"missing metric {key}"
            if isinstance(exp_val, int):
                assert int(gv) == int(exp_val), f"{key}: got {gv} expected {exp_val}"
            else:
                assert _within_pct(float(gv), float(exp_val), tol), f"{key}: got {gv} expected ~{exp_val} (±{tol:.0%})"
