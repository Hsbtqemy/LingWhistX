"""
WX-607 — import optionnel de timings mots depuis un aligneur externe (ex. MFA hors ligne).

Ce module ne lance pas MFA ni n’installe de dépendances tierces : il lit uniquement un
fichier JSON au format documenté. La production du fichier (TextGrid → JSON, script MFA, etc.)
reste à la charge de l’utilisateur.
"""

from __future__ import annotations

import json
import os
from typing import Any

from whisperx.utils import as_float

EXTERNAL_WORD_TIMINGS_SCHEMA_VERSION = 1
TIMESTAMP_DECIMALS = 3


class ExternalAlignmentError(ValueError):
    """Erreur de schéma ou de correspondance avec la transcription courante."""


def _round_ts(value: float) -> float:
    return round(float(value), TIMESTAMP_DECIMALS)


def load_external_word_timings_json(path: str) -> dict[str, Any]:
    """Charge et valide le JSON ; lève ExternalAlignmentError si invalide."""
    if not os.path.isfile(path):
        raise ExternalAlignmentError(f"Fichier introuvable: {path}")
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ExternalAlignmentError("La racine JSON doit être un objet.")
    validate_external_word_timings_v1(data)
    return data


def validate_external_word_timings_v1(data: dict[str, Any]) -> None:
    """Valide le schéma v1 (schema_version, alignment_source, words[] avec start/end)."""
    ver = data.get("schema_version")
    if ver != EXTERNAL_WORD_TIMINGS_SCHEMA_VERSION:
        raise ExternalAlignmentError(
            f"schema_version attendu {EXTERNAL_WORD_TIMINGS_SCHEMA_VERSION}, reçu {ver!r}"
        )
    src = data.get("alignment_source")
    if not isinstance(src, str) or not src.strip():
        raise ExternalAlignmentError("alignment_source doit être une chaîne non vide (ex. 'mfa').")
    words = data.get("words")
    if not isinstance(words, list) or not words:
        raise ExternalAlignmentError("words doit être une liste non vide.")
    for i, w in enumerate(words):
        if not isinstance(w, dict):
            raise ExternalAlignmentError(f"words[{i}] doit être un objet.")
        tok = w.get("token") or w.get("word")
        if tok is not None and not str(tok).strip():
            raise ExternalAlignmentError(f"words[{i}]: token vide interdit si présent.")
        st = as_float(w.get("start"))
        en = as_float(w.get("end"))
        if st is None or en is None:
            raise ExternalAlignmentError(f"words[{i}]: start et end requis (nombres finis).")
        if en < st:
            raise ExternalAlignmentError(f"words[{i}]: end doit être >= start.")


def iter_flat_segment_words(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Liste les dicts `word` dans l’ordre segments × mots (même ordre que la timeline)."""
    out: list[dict[str, Any]] = []
    segments = result.get("segments")
    if not isinstance(segments, list):
        return out
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        raw_words = seg.get("words")
        if not isinstance(raw_words, list):
            continue
        for w in raw_words:
            if isinstance(w, dict) and (w.get("word") or w.get("token")):
                out.append(w)
    return out


def apply_external_word_timings_to_result(
    result: dict[str, Any],
    timings: dict[str, Any],
    *,
    source_path: str,
    strict_token_match: bool = False,
) -> dict[str, Any]:
    """
    Applique start/end depuis timings['words'] aux mots du résultat, dans l’ordre.
    Retourne le bloc metadata à attacher à result['external_alignment'].
    """
    ext_words = timings["words"]
    flat = iter_flat_segment_words(result)
    if len(flat) != len(ext_words):
        raise ExternalAlignmentError(
            f"Nombre de mots différent: transcription {len(flat)} vs fichier externe {len(ext_words)}."
        )
    n_applied = 0
    for i, (rw, ew) in enumerate(zip(flat, ext_words)):
        ext_tok = ew.get("token") or ew.get("word")
        cur_tok = rw.get("word") or rw.get("token")
        if strict_token_match and ext_tok is not None and cur_tok is not None:
            if str(ext_tok).strip().lower() != str(cur_tok).strip().lower():
                raise ExternalAlignmentError(
                    f"Token mismatch à l’index {i}: {cur_tok!r} vs {ext_tok!r}"
                )
        st = as_float(ew.get("start"))
        en = as_float(ew.get("end"))
        if st is None or en is None:
            raise ExternalAlignmentError(f"words[{i}]: start/end invalides.")
        if en < st:
            st, en = en, st
        rw["start"] = _round_ts(st)
        rw["end"] = _round_ts(en)
        flags = rw.get("flags")
        if isinstance(flags, list):
            if "external_alignment" not in flags:
                flags.append("external_alignment")
        else:
            rw["flags"] = ["external_alignment"]
        n_applied += 1

    meta = {
        "schema_version": EXTERNAL_WORD_TIMINGS_SCHEMA_VERSION,
        "alignment_source": str(timings["alignment_source"]).strip(),
        "file_path": os.path.abspath(source_path),
        "n_words_applied": n_applied,
        "match_mode": "index_order",
    }
    return meta
