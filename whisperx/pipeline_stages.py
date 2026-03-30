"""
WX-684 — Fonctions pures du pipeline de transcription.

Ce module n'importe pas torch, numpy, ni aucune dépendance lourde.
Il est testable avec n'importe quel Python >= 3.10, sans GPU ni modèle réel.

Les fonctions ici sont utilisées par transcribe.py ; elles en ont été extraites
pour faciliter les tests unitaires et la lisibilité.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from whisperx.schema import TranscriptionResult


def build_temperature_sequence(
    temperature: float,
    increment: float | None,
) -> list[float] | tuple[float, ...]:
    """Calcule la séquence de températures Whisper.

    Pure — pas d'effets de bord, pas de dépendance modèle.

    Args:
        temperature: Température de départ (0.0–1.0).
        increment: Pas d'incrément. Si None, retourne une liste à un seul élément.

    Returns:
        Liste (sans incrément) ou tuple (avec incrément) de valeurs de température.
    """
    if increment is not None:
        # Reproduit np.arange sans importer numpy ici.
        values: list[float] = []
        t = temperature
        while t <= 1.0 + 1e-6:
            values.append(round(t, 10))
            t = round(t + increment, 10)
        return tuple(values)
    return [temperature]


def build_asr_options(
    *,
    beam_size: int,
    best_of: int,
    patience: float,
    length_penalty: float,
    temperatures: list | tuple,
    compression_ratio_threshold: float,
    log_prob_threshold: float,
    no_speech_threshold: float,
    condition_on_previous_text: bool,
    initial_prompt: str | None,
    hotwords: str | None,
    suppress_tokens_str: str,
    suppress_numerals: bool,
) -> dict[str, Any]:
    """Construit le dict d'options ASR à partir de paramètres validés.

    Pure — transforme uniquement des valeurs scalaires en dict. Testable sans modèle.
    """
    return {
        "beam_size": beam_size,
        "best_of": best_of,
        "patience": patience,
        "length_penalty": length_penalty,
        "temperatures": temperatures,
        "compression_ratio_threshold": compression_ratio_threshold,
        "log_prob_threshold": log_prob_threshold,
        "no_speech_threshold": no_speech_threshold,
        "condition_on_previous_text": condition_on_previous_text,
        "initial_prompt": initial_prompt,
        "hotwords": hotwords,
        "suppress_tokens": [int(x) for x in suppress_tokens_str.split(",")],
        "suppress_numerals": suppress_numerals,
    }


def postprocess_words(result: "TranscriptionResult") -> "TranscriptionResult":
    """Garantit la présence de word_segments dans un résultat de transcription.

    Pure et idempotente — ne mutate pas le dict d'entrée.
    Si word_segments est déjà présent, le retourne tel quel.
    Sinon, le construit à partir des mots inline dans chaque segment.
    """
    if "word_segments" in result:
        return result
    words: list[dict[str, Any]] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            words.append(dict(w))
    return {**result, "word_segments": words}
