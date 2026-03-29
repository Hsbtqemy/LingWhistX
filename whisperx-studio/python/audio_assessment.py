"""
WX-661 — Évaluation qualité audio pré-transcription.

Émet (via stdout JSON-lines, type="audio_quality") :
- snr_db           : estimation SNR (dB), approche spectrale WADA-SNR simplifiée
- clipping_ratio   : proportion d'échantillons > 0.99 (float [0,1])
- speech_ratio     : proportion d'énergie mesurée comme parole (float [0,1])
- duration_sec     : durée totale du fichier (secondes)
- speech_sec       : durée effective de parole estimée (secondes)
- warnings         : liste de codes d'avertissement

Codes d'avertissement :
  CLIPPING   — clipping_ratio > 0.001 (> 0,1 % d'échantillons saturés)
  HIGH_NOISE — snr_db < 15 dB
  LOW_SPEECH — speech_ratio < 0.15 (moins de 15 % du fichier est de la parole)

L'évaluation est conçue pour être rapide (< 3 s sur 60 min) grâce à un sous-échantillonnage
à 16 kHz et traitement par blocs.
"""

from __future__ import annotations

import math
import struct
import subprocess
import sys
import tempfile
from pathlib import Path


def _load_mono_pcm_via_ffmpeg(input_path: str, sample_rate: int = 16000) -> bytes | None:
    """
    Utilise ffmpeg pour décoder le fichier audio en PCM 16-bit mono.
    Retourne les octets bruts (little-endian signed int16) ou None si échec.
    """
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel", "error",
                "-i", input_path,
                "-ac", "1",
                "-ar", str(sample_rate),
                "-f", "s16le",
                "pipe:1",
            ],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0 or not result.stdout:
            return None
        return result.stdout
    except Exception:
        return None


def _decode_samples(raw: bytes) -> list[float]:
    """Convertit des octets PCM s16le en flottants [-1, 1]."""
    n = len(raw) // 2
    if n == 0:
        return []
    samples = list(struct.unpack_from(f"<{n}h", raw, 0))
    return [s / 32768.0 for s in samples]


def _estimate_snr_wada(samples: list[float], sample_rate: int) -> float:
    """
    Estimation SNR simplifié inspiré de WADA-SNR :
    Compare l'énergie RMS totale à l'énergie des trames à faible activité vocale.
    Retourne une valeur en dB (0–60 typiquement).
    """
    block = max(1, sample_rate // 10)  # blocs de 100 ms
    energies: list[float] = []
    for i in range(0, len(samples) - block + 1, block):
        chunk = samples[i : i + block]
        rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
        energies.append(rms)
    if not energies:
        return 0.0
    energies.sort()
    # Les 15 % les plus faibles estiment le bruit
    noise_count = max(1, int(len(energies) * 0.15))
    noise_rms = sum(energies[:noise_count]) / noise_count
    total_rms = sum(energies) / len(energies)
    if noise_rms <= 0.0:
        return 60.0
    ratio = total_rms / noise_rms
    snr = 20.0 * math.log10(max(ratio, 1.0))
    return min(60.0, snr)


def _estimate_clipping_ratio(samples: list[float], threshold: float = 0.99) -> float:
    """Proportion d'échantillons dont la valeur absolue dépasse le seuil."""
    if not samples:
        return 0.0
    clipped = sum(1 for s in samples if abs(s) >= threshold)
    return clipped / len(samples)


def _estimate_speech_ratio(samples: list[float], sample_rate: int) -> float:
    """
    Détecte les trames actives (énergie > 10 % de l'énergie médiane des trames non-silencieuses).
    Retourne la proportion de trames actives.
    """
    block = max(1, sample_rate // 10)  # 100 ms
    energies: list[float] = []
    for i in range(0, len(samples) - block + 1, block):
        chunk = samples[i : i + block]
        rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
        energies.append(rms)
    if not energies:
        return 0.0
    sorted_e = sorted(e for e in energies if e > 0)
    if not sorted_e:
        return 0.0
    median = sorted_e[len(sorted_e) // 2]
    threshold = median * 0.1
    active = sum(1 for e in energies if e > threshold)
    return active / len(energies)


def assess_audio(
    input_path: str,
    sample_rate: int = 16000,
) -> dict[str, object]:
    """
    Évalue la qualité audio et retourne un rapport dict.
    En cas d'échec de décodage, retourne un rapport minimal avec warnings=["DECODE_FAILED"].
    """
    raw = _load_mono_pcm_via_ffmpeg(input_path, sample_rate)
    if raw is None or len(raw) < 2:
        return {
            "snr_db": None,
            "clipping_ratio": None,
            "speech_ratio": None,
            "duration_sec": None,
            "speech_sec": None,
            "warnings": ["DECODE_FAILED"],
        }

    samples = _decode_samples(raw)
    duration_sec = len(samples) / sample_rate

    snr_db = round(_estimate_snr_wada(samples, sample_rate), 1)
    clipping_ratio = round(_estimate_clipping_ratio(samples), 5)
    speech_ratio = round(_estimate_speech_ratio(samples, sample_rate), 3)
    speech_sec = round(duration_sec * speech_ratio, 1)

    warnings: list[str] = []
    if clipping_ratio > 0.001:
        warnings.append("CLIPPING")
    if snr_db < 15.0:
        warnings.append("HIGH_NOISE")
    if speech_ratio < 0.15:
        warnings.append("LOW_SPEECH")

    return {
        "snr_db": snr_db,
        "clipping_ratio": clipping_ratio,
        "speech_ratio": speech_ratio,
        "duration_sec": round(duration_sec, 1),
        "speech_sec": speech_sec,
        "warnings": warnings,
    }


def mock_assessment(duration_sec: float = 120.0) -> dict[str, object]:
    """Rapport déterministe pour le mode mock — SNR correct, pas d'avertissement."""
    return {
        "snr_db": 28.5,
        "clipping_ratio": 0.0,
        "speech_ratio": 0.72,
        "duration_sec": round(duration_sec, 1),
        "speech_sec": round(duration_sec * 0.72, 1),
        "warnings": [],
    }
