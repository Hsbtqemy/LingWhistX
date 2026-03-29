"""
WX-664 — Découpage intelligent sur silences VAD (smart chunking).

Produit des frontières de chunks qui tombent exclusivement dans des silences détectés par VAD
(pyannote.audio ou silero), en respectant des contraintes de durée min/max.

Paramètres :
  silence_min_duration_sec  — durée minimale de silence pour être candidat (défaut 0.5 s)
  min_chunk_sec             — durée minimale d'un chunk (défaut 30 s)
  max_chunk_sec             — durée maximale d'un chunk (défaut 600 s)
  backend                   — 'silero' (défaut, zéro GPU) ou 'pyannote'
  pyannote_token            — token HuggingFace requis pour backend='pyannote'

Usage :
    from whisperx.smart_chunking import compute_smart_chunk_boundaries
    boundaries = compute_smart_chunk_boundaries("input.wav", options)
    # boundaries = [(0.0, 312.4), (312.4, 687.1), ...]  — tuples (start, end) en secondes
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class ChunkBoundary:
    """Frontière [start, end] d'un chunk en secondes."""
    start: float
    end: float


def _detect_speech_silero(
    audio_path: str,
    silence_min_sec: float,
) -> list[tuple[float, float]]:
    """
    Détecte les segments de parole via silero-VAD.
    Retourne une liste de (speech_start, speech_end) en secondes.
    Silero-VAD doit être disponible (torch + silero-vad).
    """
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("silero-VAD requiert PyTorch : pip install torch") from exc

    try:
        # silero-vad v5+ (get_speech_timestamps API publique)
        model, utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            onnx=False,
        )
        (get_speech_timestamps, _, read_audio, _, _) = utils
    except Exception as exc:
        raise RuntimeError(f"Impossible de charger silero-VAD : {exc}") from exc

    wav = read_audio(audio_path, sampling_rate=16000)
    timestamps = get_speech_timestamps(
        wav, model,
        sampling_rate=16000,
        min_silence_duration_ms=int(silence_min_sec * 1000),
        return_seconds=True,
    )
    return [(t["start"], t["end"]) for t in timestamps]


def _detect_speech_pyannote(
    audio_path: str,
    hf_token: str,
) -> list[tuple[float, float]]:
    """
    Détecte les segments de parole via pyannote.audio VAD pipeline.
    """
    try:
        from pyannote.audio import Pipeline
    except ImportError as exc:
        raise RuntimeError(
            "pyannote.audio requis pour backend='pyannote' : pip install pyannote.audio"
        ) from exc

    pipeline = Pipeline.from_pretrained(
        "pyannote/voice-activity-detection",
        use_auth_token=hf_token or True,
    )
    output = pipeline(audio_path)
    return [(seg.start, seg.end) for seg in output.get_timeline().support()]


def _speech_segments_to_silences(
    speech: list[tuple[float, float]],
    total_duration: float,
    silence_min_sec: float,
) -> list[tuple[float, float]]:
    """
    Convertit une liste de segments de parole en liste de silences (complémentaire).
    Filtre les silences plus courts que `silence_min_sec`.
    """
    silences: list[tuple[float, float]] = []
    prev_end = 0.0

    for start, end in speech:
        gap = start - prev_end
        if gap >= silence_min_sec:
            silences.append((prev_end, start))
        prev_end = end

    # Silence final
    if total_duration - prev_end >= silence_min_sec:
        silences.append((prev_end, total_duration))

    return silences


def _compute_boundaries_from_silences(
    silences: list[tuple[float, float]],
    total_duration: float,
    min_chunk_sec: float,
    max_chunk_sec: float,
) -> list[ChunkBoundary]:
    """
    Produit des frontières de chunks en plaçant les coupures au milieu des silences
    candidats, en respectant les contraintes min/max.
    """
    if total_duration <= max_chunk_sec:
        return [ChunkBoundary(0.0, total_duration)]

    # Points de coupure candidats : milieu de chaque silence
    cut_candidates = [(s + e) / 2.0 for s, e in silences]

    boundaries: list[ChunkBoundary] = []
    chunk_start = 0.0

    for cut in cut_candidates:
        chunk_duration = cut - chunk_start

        if chunk_duration < min_chunk_sec:
            continue  # Trop court — ne pas couper ici

        if chunk_duration >= max_chunk_sec:
            # Forcer une coupure même si sous le seuil min
            boundaries.append(ChunkBoundary(chunk_start, cut))
            chunk_start = cut
            continue

        # Coupure en zone valide [min, max]
        boundaries.append(ChunkBoundary(chunk_start, cut))
        chunk_start = cut

    # Dernier chunk
    if chunk_start < total_duration:
        last = ChunkBoundary(chunk_start, total_duration)
        # Fusionner avec le précédent si trop court
        if boundaries and (total_duration - chunk_start) < min_chunk_sec * 0.5:
            prev = boundaries[-1]
            boundaries[-1] = ChunkBoundary(prev.start, total_duration)
        else:
            boundaries.append(last)

    return boundaries if boundaries else [ChunkBoundary(0.0, total_duration)]


def _get_audio_duration(audio_path: str) -> float:
    """Retourne la durée du fichier audio via ffprobe."""
    import subprocess, json as _json
    try:
        result = subprocess.run(
            ["ffprobe", "-hide_banner", "-loglevel", "error",
             "-print_format", "json", "-show_format", audio_path],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            data = _json.loads(result.stdout)
            return float(data.get("format", {}).get("duration", 0) or 0)
    except Exception:
        pass
    return 0.0


def compute_smart_chunk_boundaries(
    audio_path: str,
    options: dict | None = None,
    emit_log=None,
) -> list[ChunkBoundary]:
    """
    Calcule les frontières de chunks alignées sur les silences VAD.

    Retourne une liste de `ChunkBoundary` couvrant l'intégralité du fichier.
    Si le fichier est plus court que `max_chunk_sec`, retourne une seule frontière.
    """
    spec = options or {}
    silence_min_sec: float = float(spec.get("silence_min_duration_sec", 0.5))  # type: ignore[arg-type]
    min_chunk_sec: float = float(spec.get("min_chunk_sec", 30.0))  # type: ignore[arg-type]
    max_chunk_sec: float = float(spec.get("max_chunk_sec", 600.0))  # type: ignore[arg-type]
    backend: str = str(spec.get("backend", "silero")).lower()
    pyannote_token: str = str(spec.get("pyannote_token", ""))

    total_duration = _get_audio_duration(audio_path)

    if total_duration <= 0:
        raise RuntimeError(f"Impossible de déterminer la durée de {audio_path}")

    if total_duration <= max_chunk_sec:
        return [ChunkBoundary(0.0, total_duration)]

    if emit_log:
        emit_log("info", "smart_chunking",
                 f"Détection VAD ({backend}) pour smart chunking ({total_duration:.0f}s)…", None)

    if backend == "pyannote":
        speech_segs = _detect_speech_pyannote(audio_path, pyannote_token)
    else:
        # silero — fallback si pyannote ou backend inconnu
        try:
            speech_segs = _detect_speech_silero(audio_path, silence_min_sec)
        except RuntimeError as exc:
            if emit_log:
                emit_log("warning", "smart_chunking",
                         f"silero-VAD indisponible ({exc}) — coupure uniforme.", None)
            # Fallback : coupures uniformes à max_chunk_sec
            boundaries = []
            t = 0.0
            while t < total_duration:
                end = min(t + max_chunk_sec, total_duration)
                boundaries.append(ChunkBoundary(t, end))
                t = end
            return boundaries

    silences = _speech_segments_to_silences(speech_segs, total_duration, silence_min_sec)
    boundaries = _compute_boundaries_from_silences(silences, total_duration, min_chunk_sec, max_chunk_sec)

    if emit_log:
        emit_log("info", "smart_chunking",
                 f"Smart chunking : {len(boundaries)} chunk(s) générés.", None)

    return boundaries


def boundaries_to_ffmpeg_segments(boundaries: Sequence[ChunkBoundary]) -> list[dict]:
    """
    Convertit une liste de `ChunkBoundary` en format de segments pipeline audio
    compatible avec `audioPipelineSegments` du worker Studio.

    Retourne une liste de dicts : [{"start": float, "end": float}, ...]
    """
    return [{"start": b.start, "end": b.end} for b in boundaries]
