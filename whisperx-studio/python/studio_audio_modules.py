"""
Modules audio optionnels pour le worker Studio (prétraitement, VAD, QC, …).

Contrat : la clé `audioPipelineModules` dans les options JSON du job (voir audit/pipeline-modules-multi-speaker.md).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Callable, Final, Mapping

from log_sanitize import sanitize_log_line

EmitLogFn = Callable[[str, str, str, int | None], None]

# Clés canoniques (combinables) — alignées sur audit/pipeline-modules-multi-speaker.md
CANONICAL_KEYS: Final[frozenset[str]] = frozenset(
    {
        "preNormalize",
        "normalizeLoudness",  # WX-662 — normalisation EBU R128 2 passes via whisperx/audio_preprocessing.py
        "denoise",            # WX-663 — débruitage noisereduce / DeepFilterNet
        "smartChunk",         # WX-664 — découpage intelligent sur silences VAD
        "sourceSeparate",     # WX-666 — séparation sources voix/fond via Demucs
        "bandLimit",
        "spectralDenoise",
        "stereoMidSide",
        "bestChannel",
        "vadEnergy",
        "vadModel",
        "vadAlignedChunking",
        "speakerTurnPostprocess",
        "overlapDetection",
        "qcPitch",
        "qcSpectral",
        "acousticPauses",
    }
)


def _ffmpeg_binary() -> str:
    return os.environ.get("FFMPEG_BINARY", "ffmpeg")


def _ffprobe_binary() -> str:
    return os.environ.get("FFPROBE_BINARY", "ffprobe")


def _get_audio_modules_spec(options: dict[str, object]) -> dict[str, object] | None:
    raw = options.get("audioPipelineModules")
    if raw is None:
        raw = options.get("audio_pipeline_modules")
    if not isinstance(raw, dict) or not raw:
        return None
    return raw


def summarize_requested_modules(options: dict[str, object]) -> str | None:
    raw = _get_audio_modules_spec(options)
    if not raw:
        return None
    parts: list[str] = []
    unknown: list[str] = []
    for key in sorted(raw.keys()):
        value = raw[key]
        if key not in CANONICAL_KEYS:
            unknown.append(key)
            continue
        if value is True:
            parts.append(f"{key}=true")
        elif isinstance(value, dict) and value:
            parts.append(f"{key}={json.dumps(value, ensure_ascii=False)}")
        elif value is False or value is None:
            continue
        else:
            parts.append(f"{key}={json.dumps(value, ensure_ascii=False)}")
    if unknown:
        parts.append(f"unknown_keys={unknown}")
    if not parts:
        return None
    return "; ".join(parts)


def _module_wants(spec: Mapping[str, object], key: str) -> bool:
    v = spec.get(key)
    if v is True:
        return True
    # `{}` = activer avec paramètres par défaut
    if isinstance(v, dict):
        return True
    return False


def _float_from_mapping(m: Mapping[str, object], *names: str, default: float) -> float:
    for name in names:
        if name not in m:
            continue
        v = m[name]
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            return float(v)
    return default


def _optional_notch_hz(spec: Mapping[str, object]) -> float | None:
    for key in ("notchHz", "notch_hz", "humHz", "hum_hz"):
        if key not in spec:
            continue
        v = spec[key]
        if v in (50, 60):
            return float(v)
        if isinstance(v, (int, float)) and float(v) in (50.0, 60.0):
            return float(v)
    return None


def _band_limit_filter_and_params(
    spec: object,
) -> tuple[str, float, float, float | None, float]:
    """Retourne (chaîne `-af`, hp, lp, encoche Hz ou None, gain encoche dB)."""
    hp = 80.0
    lp = 7600.0
    notch_gain = -28.0
    if isinstance(spec, dict):
        hp = _float_from_mapping(spec, "highpassHz", "highpass_hz", default=hp)
        lp = _float_from_mapping(spec, "lowpassHz", "lowpass_hz", default=lp)
        notch_gain = _float_from_mapping(spec, "notchGainDb", "notch_gain_db", default=notch_gain)
    # 16 kHz → Nyquist 8 kHz
    lp = max(2000.0, min(lp, 7990.0))
    hp = max(20.0, min(hp, 500.0))
    notch = _optional_notch_hz(spec) if isinstance(spec, dict) else None
    parts = [f"highpass=f={hp}", f"lowpass=f={lp}"]
    if notch is not None:
        parts.append(f"equalizer=f={notch}:width_type=q:width=3:g={notch_gain}")
    return ",".join(parts), hp, lp, notch, notch_gain


def _probe_stream_channels(media_path: Path) -> int:
    cmd = [
        _ffprobe_binary(),
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=channels",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)
    except FileNotFoundError as exc:
        raise RuntimeError("ffprobe introuvable (FFPROBE_BINARY).") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            sanitize_log_line(f"ffprobe (channels) a échoué: {exc.stderr or exc}")
        ) from exc
    line = (proc.stdout or "").strip().splitlines()[0] if proc.stdout else ""
    try:
        n = int(float(line))
        return max(0, n)
    except ValueError as exc:
        raise RuntimeError(f"Nombre de canaux illisible: {line!r}") from exc


def _probe_duration_seconds(media_path: Path) -> float:
    cmd = [
        _ffprobe_binary(),
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffprobe introuvable (FFPROBE_BINARY). Impossible de lire la durée audio."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(sanitize_log_line(f"ffprobe a échoué: {exc.stderr or exc}")) from exc
    line = (proc.stdout or "").strip().splitlines()[0] if proc.stdout else ""
    try:
        return max(0.0, float(line))
    except ValueError as exc:
        raise RuntimeError(f"Durée ffprobe illisible: {line!r}") from exc


def run_pre_normalize(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Resample mono 16 kHz + loudnorm (ffmpeg). Écrit `studio_audio_pipeline/normalized.wav` + `normalized_meta.json`.
    """
    loudnorm_i = -16.0
    loudnorm_tp = -1.5
    loudnorm_lra = 11.0
    if isinstance(spec, dict):
        loudnorm_i = _float_from_mapping(
            spec, "integratedLufs", "integrated_lufs", "I", default=loudnorm_i
        )
        loudnorm_tp = _float_from_mapping(
            spec, "truePeakDb", "true_peak_db", "TP", default=loudnorm_tp
        )
        loudnorm_lra = _float_from_mapping(spec, "lra", "LRA", default=loudnorm_lra)

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_wav = pipeline_dir / "normalized.wav"
    meta_path = pipeline_dir / "normalized_meta.json"

    af = f"loudnorm=I={loudnorm_i}:TP={loudnorm_tp}:LRA={loudnorm_lra}"
    cmd = [
        _ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        af,
        "-f",
        "wav",
        str(out_wav),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg introuvable (FFMPEG_BINARY). Le module preNormalize nécessite ffmpeg."
        ) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            sanitize_log_line(f"ffmpeg preNormalize a échoué (code {proc.returncode}): {err}")
        )

    duration_sec = _probe_duration_seconds(out_wav)
    meta = {
        "module": "preNormalize",
        "sampleRateHz": 16000,
        "channels": 1,
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "outputWavRelative": "studio_audio_pipeline/normalized.wav",
        "loudnorm": {"integratedLufs": loudnorm_i, "truePeakDb": loudnorm_tp, "lra": loudnorm_lra},
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"preNormalize: mono 16 kHz + loudnorm → {out_wav.name} (durée ~{duration_sec:.2f}s)",
            12,
        )
    return str(out_wav.resolve())


def _stereo_mid_side_pan_aff(spec: object) -> str:
    """Expression `pan` ffmpeg pour 2.0 stéréo → mono."""
    mode = "mid"
    if isinstance(spec, dict):
        raw = spec.get("mode") or spec.get("mix")
        if isinstance(raw, str) and raw.strip():
            mode = raw.strip().lower()
    if mode in ("left", "l", "0"):
        return "pan=mono|c0=c0"
    if mode in ("right", "r", "1"):
        return "pan=mono|c0=c1"
    return "pan=mono|c0=0.5*c0+0.5*c1"


def run_stereo_mid_side(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Extraction L / R / mid (somme) avant tout mixage mono générique — à placer avant preNormalize.
    Sortie : `studio_audio_pipeline/stereo_mix.wav` (mono).
    """
    ch = _probe_stream_channels(input_path)
    if ch < 2:
        if emit_log:
            emit_log(
                "info",
                "audio_modules",
                f"stereoMidSide: {ch} canal(aux) — pas de mixage stéréo, fichier inchangé.",
                9,
            )
        return str(input_path.resolve())

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_wav = pipeline_dir / "stereo_mix.wav"
    meta_path = pipeline_dir / "stereo_mix_meta.json"

    # Pan explicite seulement pour 2 canaux ; sinon downmix libav (5.1, etc.).
    if ch == 2:
        af = _stereo_mid_side_pan_aff(spec)
        cmd = [
            _ffmpeg_binary(),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-vn",
            "-af",
            af,
            "-ac",
            "1",
            "-f",
            "wav",
            str(out_wav),
        ]
    else:
        if emit_log:
            emit_log(
                "warning",
                "audio_modules",
                f"stereoMidSide: {ch} canaux — downmix mono automatique (pas de pan L/R/mid explicite).",
                9,
            )
        cmd = [
            _ffmpeg_binary(),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-vn",
            "-ac",
            "1",
            "-f",
            "wav",
            str(out_wav),
        ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg introuvable (FFMPEG_BINARY). Le module stereoMidSide nécessite ffmpeg."
        ) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            sanitize_log_line(f"ffmpeg stereoMidSide a échoué (code {proc.returncode}): {err}")
        )

    duration_sec = _probe_duration_seconds(out_wav)
    mode_label = "mid"
    if isinstance(spec, dict):
        raw = spec.get("mode") or spec.get("mix")
        if isinstance(raw, str) and raw.strip():
            mode_label = raw.strip().lower()

    meta = {
        "module": "stereoMidSide",
        "inputChannels": ch,
        "mixMode": mode_label if ch == 2 else "auto_downmix",
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "outputWavRelative": "studio_audio_pipeline/stereo_mix.wav",
        "ffmpegAudioFilter": _stereo_mid_side_pan_aff(spec) if ch == 2 else None,
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        label = f"{mode_label}" if ch == 2 else "auto_downmix"
        emit_log(
            "info",
            "audio_modules",
            f"stereoMidSide: {ch} canaux → mono ({label}) → {out_wav.name} (~{duration_sec:.2f}s)",
            10,
        )
    return str(out_wav.resolve())


_MEAN_VOL_RE = re.compile(r"mean_volume:\s*([-\d.]+)\s*dB", re.IGNORECASE)
_SILENCE_START_RE = re.compile(r"silence_start:\s*([\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*([\d.]+)")


def _parse_mean_volume_db(text: str) -> float | None:
    m = _MEAN_VOL_RE.search(text)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _ffmpeg_mean_volume_db(input_path: Path, pan: str) -> float:
    """Niveau moyen (dB) pour un canal mono extrait via `pan` (2.0 stéréo)."""
    af = f"{pan},volumedetect"
    cmd = [
        _ffmpeg_binary(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "info",
        "-i",
        str(input_path),
        "-vn",
        "-af",
        af,
        "-f",
        "null",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg introuvable (FFMPEG_BINARY).") from exc
    blob = (proc.stderr or "") + (proc.stdout or "")
    m = _parse_mean_volume_db(blob)
    if m is None:
        raise RuntimeError(f"volumedetect: mean_volume introuvable pour pan={pan!r}")
    return m


def run_best_channel(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Choisit le canal L ou R le plus « énergétique » (proxy speechiness) via `volumedetect`.
    Stéréo 2.0 uniquement ; sinon fichier inchangé.
    Sortie : `studio_audio_pipeline/best_channel.wav`.
    """
    ch = _probe_stream_channels(input_path)
    if ch != 2:
        if emit_log:
            emit_log(
                "info",
                "audio_modules",
                f"bestChannel: {ch} canal(aux) — réservé à la stéréo 2.0, fichier inchangé.",
                9,
            )
        return str(input_path.resolve())

    vol_l = _ffmpeg_mean_volume_db(input_path, "pan=mono|c0=c0")
    vol_r = _ffmpeg_mean_volume_db(input_path, "pan=mono|c0=c1")
    chosen = "left" if vol_l >= vol_r else "right"
    pan_out = "pan=mono|c0=c0" if chosen == "left" else "pan=mono|c0=c1"

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_wav = pipeline_dir / "best_channel.wav"
    meta_path = pipeline_dir / "best_channel_meta.json"

    cmd = [
        _ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-af",
        pan_out,
        "-ac",
        "1",
        "-f",
        "wav",
        str(out_wav),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg introuvable (FFMPEG_BINARY). Le module bestChannel nécessite ffmpeg."
        ) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            sanitize_log_line(f"ffmpeg bestChannel a échoué (code {proc.returncode}): {err}")
        )

    duration_sec = _probe_duration_seconds(out_wav)
    meta = {
        "module": "bestChannel",
        "inputChannels": ch,
        "meanVolumeDbLeft": vol_l,
        "meanVolumeDbRight": vol_r,
        "chosenChannel": chosen,
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "outputWavRelative": "studio_audio_pipeline/best_channel.wav",
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"bestChannel: {chosen} (L={vol_l:.1f} dB, R={vol_r:.1f} dB) → {out_wav.name}",
            11,
        )
    return str(out_wav.resolve())


def _parse_silencedetect_intervals(text: str) -> list[tuple[float, float]]:
    """Parse les paires silence_start / silence_end depuis la sortie ffmpeg."""
    starts = [float(m.group(1)) for m in _SILENCE_START_RE.finditer(text)]
    ends = [float(m.group(1)) for m in _SILENCE_END_RE.finditer(text)]
    n = min(len(starts), len(ends))
    return [(starts[i], ends[i]) for i in range(n)]


def _silencedetect_analyze(
    input_path: Path,
    noise_db: float,
    min_sil: float,
) -> tuple[list[tuple[float, float]], float]:
    """Exécute `silencedetect` et retourne (intervalles silence, durée totale)."""
    noise_db = max(-90.0, min(noise_db, 0.0))
    min_sil = max(0.05, min(min_sil, 30.0))

    af = f"silencedetect=noise={noise_db:g}dB:d={min_sil:g}"
    cmd = [
        _ffmpeg_binary(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "info",
        "-i",
        str(input_path),
        "-vn",
        "-af",
        af,
        "-f",
        "null",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg introuvable (FFMPEG_BINARY).") from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(sanitize_log_line(f"ffmpeg silencedetect a échoué: {err}"))

    blob = (proc.stderr or "") + (proc.stdout or "")
    ivs = _parse_silencedetect_intervals(blob)
    duration_sec = _probe_duration_seconds(input_path)
    return ivs, duration_sec


def run_vad_energy(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    VAD heuristique (silences) via `silencedetect` — écrit `vad_energy.json`, ne modifie pas le média.
    """
    noise_db = -50.0
    min_sil = 0.5
    if isinstance(spec, dict):
        noise_db = _float_from_mapping(spec, "noiseDb", "noise_db", default=noise_db)
        min_sil = _float_from_mapping(
            spec, "minSilenceDurationSec", "min_silence_sec", "minSilence", default=min_sil
        )

    ivs, duration_sec = _silencedetect_analyze(input_path, noise_db, min_sil)

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_json = pipeline_dir / "vad_energy.json"

    payload = {
        "module": "vadEnergy",
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "silencedetect": {"noiseDb": noise_db, "minSilenceDurationSec": min_sil},
        "silenceIntervals": [{"startSec": a, "endSec": b} for a, b in ivs],
        "note": "Heuristique silence/non-silence ; pas de séparation locuteurs.",
    }
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"vadEnergy: silencedetect → {len(ivs)} intervalle(s) silence → {out_json.name}",
            15,
        )
    return str(input_path.resolve())


def run_vad_model(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    VAD neuronal (Silero, aligné sur WhisperX) — écrit `vad_model.json`, ne modifie pas le média.
    """
    try:
        import torch
        from whisperx.audio import SAMPLE_RATE, load_audio
        from whisperx.vads.silero import Silero
    except ImportError as exc:
        raise RuntimeError(
            "vadModel (silero) nécessite whisperx + torch installés (runtime WhisperX Studio)."
        ) from exc

    backend = "silero"
    vad_onset = 0.5
    chunk_size = 30.0
    if isinstance(spec, dict):
        raw_b = spec.get("backend") or spec.get("method")
        if isinstance(raw_b, str):
            b = raw_b.strip().lower()
            if b in ("pyannote", "pyannote.audio"):
                raise RuntimeError(
                    "vadModel : backend 'pyannote' non encore branché dans le pipeline Studio ; "
                    "utilisez 'silero'."
                )
            if b and b not in ("silero", "default", ""):
                raise RuntimeError(
                    f"vadModel : backend inconnu {raw_b!r} (supporté : silero)."
                )
        vad_onset = _float_from_mapping(
            spec, "threshold", "vadOnset", "vad_onset", default=vad_onset
        )
        vad_onset = max(0.01, min(vad_onset, 0.99))
        chunk_size = _float_from_mapping(
            spec,
            "maxSpeechDurationSec",
            "chunkSize",
            "chunk_size",
            default=chunk_size,
        )
        chunk_size = max(5.0, min(chunk_size, 600.0))

    waveform_np = load_audio(str(input_path))
    waveform = torch.from_numpy(waveform_np).float()
    if waveform.ndim > 1:
        waveform = waveform.mean(dim=-1)

    vad = Silero(vad_onset=vad_onset, chunk_size=int(chunk_size), vad_offset=0.363)
    segments = vad({"waveform": waveform, "sample_rate": SAMPLE_RATE})

    duration_sec = _probe_duration_seconds(input_path)
    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_json = pipeline_dir / "vad_model.json"

    speech = [{"startSec": float(s.start), "endSec": float(s.end)} for s in segments]

    payload = {
        "module": "vadModel",
        "backend": backend,
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "silero": {
            "threshold": vad_onset,
            "maxSpeechDurationSec": float(chunk_size),
        },
        "speechSegments": speech,
        "note": "Segments parole (Silero) ; fichier média inchangé pour WhisperX.",
    }
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"vadModel: silero → {len(speech)} segment(s) parole → {out_json.name}",
            19,
        )
    return str(input_path.resolve())


def _merge_time_intervals(ivs: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not ivs:
        return []
    ivs = sorted(ivs, key=lambda x: x[0])
    out: list[tuple[float, float]] = []
    cs, ce = ivs[0]
    for a, b in ivs[1:]:
        if a <= ce + 1e-5:
            ce = max(ce, b)
        else:
            out.append((cs, ce))
            cs, ce = a, b
    out.append((cs, ce))
    return out


def _speech_intervals_from_silence(
    duration_sec: float,
    silence: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Complément des silences sur [0, duration_sec]."""
    if duration_sec <= 0:
        return []
    sil = _merge_time_intervals(silence)
    out: list[tuple[float, float]] = []
    t = 0.0
    for a, b in sil:
        a = max(0.0, a)
        b = min(duration_sec, b)
        if a > t:
            out.append((t, a))
        t = max(t, b)
    if t < duration_sec:
        out.append((t, duration_sec))
    return _merge_time_intervals(out)


def _load_speech_intervals_for_chunking(
    out_dir: Path,
    input_path: Path,
    prefer: str,
) -> tuple[list[tuple[float, float]], str, float]:
    """
    Préférence : `auto` → vad_model.json si présent, sinon vad_energy.json (silences inversés).
    Retourne (intervalles parole fusionnés, source, durée).
    """
    pipeline_dir = out_dir / "studio_audio_pipeline"
    duration_sec = _probe_duration_seconds(input_path)
    vm = pipeline_dir / "vad_model.json"
    ve = pipeline_dir / "vad_energy.json"

    def from_vad_model() -> list[tuple[float, float]]:
        data = json.loads(vm.read_text(encoding="utf-8"))
        raw = data.get("speechSegments") or []
        ivs: list[tuple[float, float]] = []
        for s in raw:
            if isinstance(s, dict) and "startSec" in s and "endSec" in s:
                ivs.append((float(s["startSec"]), float(s["endSec"])))
        return _merge_time_intervals(ivs)

    def from_vad_energy() -> list[tuple[float, float]]:
        data = json.loads(ve.read_text(encoding="utf-8"))
        d = float(data.get("durationSec") or duration_sec)
        d = min(d, duration_sec) if duration_sec > 0 else d
        sil: list[tuple[float, float]] = []
        for s in data.get("silenceIntervals") or []:
            if isinstance(s, dict) and "startSec" in s and "endSec" in s:
                sil.append((float(s["startSec"]), float(s["endSec"])))
        return _speech_intervals_from_silence(d, sil)

    p = prefer.strip().lower()
    if p in ("vad_model", "model"):
        if vm.is_file():
            return from_vad_model(), "vad_model", duration_sec
        raise RuntimeError(
            "vadAlignedChunking : source 'vad_model' demandée mais studio_audio_pipeline/vad_model.json "
            "est absent — activez vadModel avant dans le même job."
        )
    if p in ("vad_energy", "energy", "silence"):
        if ve.is_file():
            return from_vad_energy(), "vad_energy", duration_sec
        raise RuntimeError(
            "vadAlignedChunking : source 'vad_energy' demandée mais studio_audio_pipeline/vad_energy.json "
            "est absent — activez vadEnergy avant dans le même job."
        )

    # auto
    if vm.is_file():
        return from_vad_model(), "vad_model", duration_sec
    if ve.is_file():
        return from_vad_energy(), "vad_energy", duration_sec
    raise RuntimeError(
        "vadAlignedChunking : ni vad_model.json ni vad_energy.json — activez au moins "
        "vadModel ou vadEnergy avant cette étape dans le même job."
    )


def _pack_wall_clock_chunks(
    merged_speech: list[tuple[float, float]],
    max_chunk_sec: float,
) -> list[tuple[float, float]]:
    """
    Regroupe des intervalles parole consécutifs en fenêtres [start,end] dont l’étendue temporelle
    ne dépasse pas `max_chunk_sec` ; coupe les segments isolés trop longs.
    """
    if not merged_speech or max_chunk_sec <= 0:
        return []
    max_chunk_sec = max(1.0, max_chunk_sec)
    chunks: list[tuple[float, float]] = []
    i = 0
    while i < len(merged_speech):
        cs, ce = merged_speech[i]
        if ce - cs > max_chunk_sec:
            t = cs
            while t < ce - 1e-9:
                chunks.append((t, min(t + max_chunk_sec, ce)))
                t += max_chunk_sec
            i += 1
            continue
        chunk_start = cs
        chunk_end = ce
        j = i + 1
        while j < len(merged_speech):
            ns, ne = merged_speech[j]
            if ne - chunk_start <= max_chunk_sec:
                chunk_end = ne
                j += 1
            else:
                break
        chunks.append((chunk_start, chunk_end))
        i = j
    return chunks


def run_vad_aligned_chunking(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Découpage indicatif aligné sur frontières VAD — lit `vad_model.json` ou `vad_energy.json`,
    écrit `vad_aligned_chunking.json`, ne modifie pas le média.
    """
    max_chunk_sec = 30.0
    prefer = "auto"
    if isinstance(spec, dict):
        max_chunk_sec = _float_from_mapping(
            spec,
            "maxChunkSec",
            "max_chunk_sec",
            "targetChunkSec",
            "target_chunk_sec",
            default=max_chunk_sec,
        )
        max_chunk_sec = max(5.0, min(max_chunk_sec, 7200.0))
        raw_pref = spec.get("preferSource") or spec.get("prefer_source")
        if isinstance(raw_pref, str) and raw_pref.strip():
            prefer = raw_pref.strip()

    speech, source, duration_sec = _load_speech_intervals_for_chunking(
        out_dir, input_path, prefer
    )
    packed = _pack_wall_clock_chunks(speech, max_chunk_sec)

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_json = pipeline_dir / "vad_aligned_chunking.json"

    payload = {
        "module": "vadAlignedChunking",
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "speechSource": source,
        "params": {"maxChunkSec": max_chunk_sec, "preferSource": prefer},
        "speechIntervalsMerged": [{"startSec": a, "endSec": b} for a, b in speech],
        "suggestedChunks": [{"startSec": a, "endSec": b, "index": i} for i, (a, b) in enumerate(packed)],
        "note": "Découpage indicatif pour aligner un chunking média sur la parole ; "
        "WhisperX n’applique pas ce JSON automatiquement (réglage pipelineChunkSeconds séparé).",
    }
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"vadAlignedChunking: source={source} → {len(packed)} chunk(s) suggéré(s) → {out_json.name}",
            20,
        )
    return str(input_path.resolve())


def _speech_segments_from_vad_model(pipeline_dir: Path) -> list[tuple[float, float]]:
    vm = pipeline_dir / "vad_model.json"
    if not vm.is_file():
        raise RuntimeError(
            "speakerTurnPostprocess / overlapDetection : studio_audio_pipeline/vad_model.json absent — "
            "activez vadModel (Silero) avant dans le même job."
        )
    data = json.loads(vm.read_text(encoding="utf-8"))
    raw = data.get("speechSegments") or []
    ivs: list[tuple[float, float]] = []
    for s in raw:
        if isinstance(s, dict) and "startSec" in s and "endSec" in s:
            ivs.append((float(s["startSec"]), float(s["endSec"])))
    return sorted(ivs, key=lambda x: x[0])


def _merge_adjacent_by_gap(
    segs: list[tuple[float, float]],
    gap_max: float,
) -> list[tuple[float, float]]:
    """Fusionne des intervalles consécutifs si l’écart entre fin et début suivant ≤ gap_max."""
    if not segs:
        return []
    segs = sorted(segs, key=lambda x: x[0])
    out: list[list[float]] = [[segs[0][0], segs[0][1]]]
    for a, b in segs[1:]:
        if a - out[-1][1] <= gap_max + 1e-9:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(float(x[0]), float(x[1])) for x in out]


def _pairwise_time_overlaps(
    segs: list[tuple[float, float]],
) -> list[dict[str, object]]:
    """Recoupements stricts entre paires d’intervalles (indices dans la liste d’entrée)."""
    overlaps: list[dict[str, object]] = []
    for i in range(len(segs)):
        for j in range(i + 1, len(segs)):
            a1, b1 = segs[i]
            a2, b2 = segs[j]
            start = max(a1, a2)
            end = min(b1, b2)
            if start < end - 1e-9:
                overlaps.append(
                    {
                        "startSec": start,
                        "endSec": end,
                        "durationSec": end - start,
                        "segmentIndices": [i, j],
                    }
                )
    return overlaps


def run_speaker_turn_postprocess(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Post-traitement « tours » sur segments VAD (pré-ASR) : fusion par écart max (WX-605 analogue).
    Nécessite `vad_model.json`. Écrit `speaker_turn_postprocess.json`, ne modifie pas le média.
    """
    merge_gap = 0.35
    split_word_gap: float | None = None
    if isinstance(spec, dict):
        merge_gap = _float_from_mapping(
            spec,
            "mergeGapSecMax",
            "merge_gap_sec_max",
            "speakerTurnMergeGapSecMax",
            default=merge_gap,
        )
        merge_gap = max(0.0, min(merge_gap, 30.0))
        if "splitWordGapSec" in spec or "speakerTurnSplitWordGapSec" in spec:
            split_word_gap = _float_from_mapping(
                spec,
                "splitWordGapSec",
                "speakerTurnSplitWordGapSec",
                "split_word_gap_sec",
                default=0.5,
            )

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    raw_segs = _speech_segments_from_vad_model(pipeline_dir)
    merged = _merge_adjacent_by_gap(raw_segs, merge_gap)
    duration_sec = _probe_duration_seconds(input_path)

    out_json = pipeline_dir / "speaker_turn_postprocess.json"
    payload: dict[str, object] = {
        "module": "speakerTurnPostprocess",
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "vadSource": "vad_model.json",
        "params": {
            "mergeGapSecMax": merge_gap,
            "splitWordGapSec": split_word_gap,
        },
        "inputSegmentCount": len(raw_segs),
        "turns": [
            {
                "index": i,
                "speaker": "SPEECH_VAD",
                "startSec": a,
                "endSec": b,
            }
            for i, (a, b) in enumerate(merged)
        ],
        "note": "Pré-ASR : tours dérivés du VAD Silero (locuteur unique fictif). "
        "La scission par écart entre mots (WX-605) exige la transcription alignée — "
        "voir options d’analyse Studio.",
    }
    if split_word_gap is not None:
        payload["note"] = (
            str(payload["note"])
            + f" Paramètre splitWordGapSec={split_word_gap} ignoré ici (pas de mots)."
        )

    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"speakerTurnPostprocess: {len(raw_segs)} → {len(merged)} tour(s) → {out_json.name}",
            21,
        )
    return str(input_path.resolve())


def run_overlap_detection(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Détecte les recoupements temporels entre segments parole (VAD ou tours fusionnés).
    Préfère `speaker_turn_postprocess.json` si présent, sinon `vad_model.json`.
    Écrit `overlap_detection.json`, ne modifie pas le média.
    """
    prefer = "auto"
    if isinstance(spec, dict):
        raw = spec.get("preferSource") or spec.get("prefer_source")
        if isinstance(raw, str) and raw.strip():
            prefer = raw.strip()

    pipeline_dir = out_dir / "studio_audio_pipeline"
    stp = pipeline_dir / "speaker_turn_postprocess.json"
    vm = pipeline_dir / "vad_model.json"

    segs: list[tuple[float, float]]
    src: str

    def from_stp() -> list[tuple[float, float]]:
        data = json.loads(stp.read_text(encoding="utf-8"))
        turns = data.get("turns") or []
        out: list[tuple[float, float]] = []
        for t in turns:
            if isinstance(t, dict) and "startSec" in t and "endSec" in t:
                out.append((float(t["startSec"]), float(t["endSec"])))
        return out

    def from_vm() -> list[tuple[float, float]]:
        return _speech_segments_from_vad_model(pipeline_dir)

    p = prefer.lower()
    if p in ("speaker_turn_postprocess", "stp", "turns"):
        if not stp.is_file():
            raise RuntimeError(
                "overlapDetection : source 'speaker_turn_postprocess' demandée mais "
                "speaker_turn_postprocess.json est absent — activez speakerTurnPostprocess avant."
            )
        segs, src = from_stp(), "speaker_turn_postprocess"
    elif p in ("vad_model", "model", "vad"):
        segs, src = from_vm(), "vad_model"
    else:
        if stp.is_file():
            segs, src = from_stp(), "speaker_turn_postprocess"
        elif vm.is_file():
            segs, src = from_vm(), "vad_model"
        else:
            raise RuntimeError(
                "overlapDetection : ni speaker_turn_postprocess.json ni vad_model.json — "
                "activez vadModel ou speakerTurnPostprocess avant."
            )

    overlaps = _pairwise_time_overlaps(segs)
    duration_sec = _probe_duration_seconds(input_path)

    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_json = pipeline_dir / "overlap_detection.json"
    payload = {
        "module": "overlapDetection",
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "segmentSource": src,
        "params": {"preferSource": prefer},
        "segmentCount": len(segs),
        "overlaps": overlaps,
        "note": "Recoupements entre segments VAD/monotour ; l’overlap multi-locuteurs (diarization) "
        "est analysé après ASR dans la timeline Studio.",
    }
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"overlapDetection: source={src} → {len(overlaps)} recoupement(s) → {out_json.name}",
            22,
        )
    return str(input_path.resolve())


def run_acoustic_pauses(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Pauses « acoustiques » longues (silences) — défauts plus tolérants (pubs, jingles).
    Écrit `acoustic_pauses.json`, ne modifie pas le média.
    """
    noise_db = -45.0
    min_sil = 1.0
    if isinstance(spec, dict):
        noise_db = _float_from_mapping(spec, "noiseDb", "noise_db", default=noise_db)
        min_sil = _float_from_mapping(
            spec, "minSilenceDurationSec", "min_silence_sec", "minSilence", default=min_sil
        )

    ivs, duration_sec = _silencedetect_analyze(input_path, noise_db, min_sil)

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_json = pipeline_dir / "acoustic_pauses.json"

    payload = {
        "module": "acousticPauses",
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "silencedetect": {"noiseDb": noise_db, "minSilenceDurationSec": min_sil},
        "silenceIntervals": [{"startSec": a, "endSec": b} for a, b in ivs],
        "note": "Heuristique silences longs ; complément aux pauses mots post-ASR (E13).",
    }
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"acousticPauses: silencedetect → {len(ivs)} intervalle(s) → {out_json.name}",
            17,
        )
    return str(input_path.resolve())


_OVERALL_BLOCK_RE = re.compile(
    r"Overall\s*\r?\n((?:\s+[^\n]+\r?\n)+)",
    re.MULTILINE | re.IGNORECASE,
)


def _parse_astats_overall_kv(text: str) -> dict[str, float]:
    """Extrait les paires clé / valeur numérique du bloc « Overall » (filtre astats)."""
    m = _OVERALL_BLOCK_RE.search(text)
    if not m:
        return {}
    block = m.group(1)
    out: dict[str, float] = {}
    for line in block.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("["):
            continue
        mm = re.match(r"([^:]+):\s*([-\d.eE+]+)\s*$", stripped)
        if not mm:
            continue
        key = mm.group(1).strip()
        try:
            out[key] = float(mm.group(2))
        except ValueError:
            continue
    return out


def run_qc_spectral(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    QC spectral léger : statistiques globales (`astats` ffmpeg) — `qc_spectral.json`, média inchangé.
    """
    reset = 0
    if isinstance(spec, dict):
        reset = int(
            _float_from_mapping(
                spec,
                "astatsResetFrames",
                "astats_reset_frames",
                "resetFrames",
                default=float(reset),
            )
        )
    reset = max(0, min(reset, 10_000_000))

    af = f"astats=metadata=1:reset={reset}"
    cmd = [
        _ffmpeg_binary(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "info",
        "-i",
        str(input_path),
        "-vn",
        "-af",
        af,
        "-f",
        "null",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg introuvable (FFMPEG_BINARY).") from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(sanitize_log_line(f"ffmpeg qcSpectral (astats) a échoué: {err}"))

    blob = (proc.stderr or "") + (proc.stdout or "")
    stats = _parse_astats_overall_kv(blob)
    duration_sec = _probe_duration_seconds(input_path)

    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_json = pipeline_dir / "qc_spectral.json"

    payload = {
        "module": "qcSpectral",
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "astats": {"resetFrames": reset, "ffmpegAudioFilter": af},
        "overall": stats,
        "note": "Statistiques globales (RMS, crête, etc.) — pas de séparation voix/foule par fréquence seule.",
    }
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        rms = stats.get("RMS level dB")
        peak = stats.get("Peak level dB")
        extra = ""
        if rms is not None and peak is not None:
            extra = f" RMS≈{rms:.1f} dB, pic≈{peak:.1f} dB"
        emit_log(
            "info",
            "audio_modules",
            f"qcSpectral: astats → {out_json.name}{extra}",
            16,
        )
    return str(input_path.resolve())


def _decode_mono_f32le_for_qc(
    input_path: Path,
    *,
    sample_rate_hz: int,
    max_duration_sec: float,
) -> tuple[object, float]:
    """PCM mono float32 via ffmpeg. Retourne (ndarray 1d, durée effective analysée en s). Nécessite numpy."""
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "qcPitch nécessite le module numpy (environnement WhisperX habituel)."
        ) from exc

    dur_probe = _probe_duration_seconds(input_path)
    if dur_probe <= 0:
        dur_probe = max_duration_sec
    t_decode = min(max(0.05, max_duration_sec), max(dur_probe, 0.05))
    cmd = [
        _ffmpeg_binary(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate_hz),
        "-t",
        f"{t_decode:.3f}",
        "-f",
        "f32le",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg introuvable (FFMPEG_BINARY).") from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(sanitize_log_line(f"ffmpeg qcPitch (décodage PCM) a échoué: {err}"))
    raw = proc.stdout or b""
    y = np.frombuffer(raw, dtype=np.float32).copy()
    if y.size < 64:
        raise RuntimeError("qcPitch: échantillons audio insuffisants après décodage.")
    return y, t_decode


def _f0_hz_autocorr_frame(
    frame: object,
    sr: int,
    fmin_hz: float,
    fmax_hz: float,
    min_corr: float,
) -> float | None:
    """F0 approximatif par corrélation normalisée (fenêtre courte, usage QC uniquement)."""
    import numpy as np

    x = np.asarray(frame, dtype=np.float64)
    x -= np.mean(x)
    n = int(x.size)
    if n < 64:
        return None
    lag_min = max(2, int(sr / fmax_hz))
    lag_max = min(n // 2 - 1, int(sr / fmin_hz))
    if lag_max <= lag_min:
        return None
    best_lag: int | None = None
    best_c = -1.0
    for lag in range(lag_min, lag_max + 1):
        a = x[:-lag]
        b = x[lag:]
        denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-12
        c = float(np.dot(a, b) / denom)
        if c > best_c:
            best_c = c
            best_lag = lag
    if best_lag is None or best_c < min_corr:
        return None
    return float(sr / float(best_lag))


def run_qc_pitch(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Estimation F0 grossière (autocorr., fenêtres) — `qc_pitch.json`, média inchangé.
    Indicatif (pas un pitch tracker pro) ; utile pour repérer voix très graves/aiguës ou fichiers vides.
    """
    sr = 16_000
    max_duration_sec = 60.0
    frame_ms = 40.0
    hop_ms = 15.0
    fmin_hz = 65.0
    fmax_hz = 420.0
    min_corr = 0.28
    max_frames = 2_000
    if isinstance(spec, dict):
        sr = int(
            _float_from_mapping(spec, "sampleRateHz", "sample_rate_hz", "sr", default=float(sr))
        )
        sr = max(8_000, min(sr, 48_000))
        max_duration_sec = _float_from_mapping(
            spec, "maxDurationSec", "max_duration_sec", default=max_duration_sec
        )
        max_duration_sec = max(1.0, min(max_duration_sec, 600.0))
        frame_ms = _float_from_mapping(spec, "frameMs", "frame_ms", default=frame_ms)
        hop_ms = _float_from_mapping(spec, "hopMs", "hop_ms", default=hop_ms)
        frame_ms = max(15.0, min(frame_ms, 120.0))
        hop_ms = max(5.0, min(hop_ms, frame_ms * 0.95))
        fmin_hz = _float_from_mapping(spec, "f0MinHz", "f0_min_hz", "fminHz", default=fmin_hz)
        fmax_hz = _float_from_mapping(spec, "f0MaxHz", "f0_max_hz", "fmaxHz", default=fmax_hz)
        fmin_hz = max(40.0, min(fmin_hz, 500.0))
        fmax_hz = max(fmin_hz + 20.0, min(fmax_hz, 1200.0))
        min_corr = _float_from_mapping(spec, "minCorrelation", "min_corr", default=min_corr)
        min_corr = max(0.1, min(min_corr, 0.95))
        max_frames = int(
            _float_from_mapping(spec, "maxFrames", "max_frames", default=float(max_frames))
        )
        max_frames = max(100, min(max_frames, 20_000))

    y, analyzed_sec = _decode_mono_f32le_for_qc(
        input_path, sample_rate_hz=sr, max_duration_sec=max_duration_sec
    )
    import numpy as np

    y = np.asarray(y, dtype=np.float32)
    frame_len = max(64, int(sr * frame_ms / 1000.0))
    hop = max(1, int(sr * hop_ms / 1000.0))
    f0s: list[float] = []
    starts = list(range(0, len(y) - frame_len, hop))
    if len(starts) > max_frames:
        idx = np.linspace(0, len(starts) - 1, max_frames)
        starts = [starts[int(i)] for i in idx]

    for s in starts:
        fr = y[s : s + frame_len]
        hz = _f0_hz_autocorr_frame(fr, sr, fmin_hz, fmax_hz, min_corr)
        if hz is not None:
            f0s.append(hz)

    duration_sec = _probe_duration_seconds(input_path)
    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_json = pipeline_dir / "qc_pitch.json"

    median_hz: float | None = None
    mean_hz: float | None = None
    std_hz: float | None = None
    if f0s:
        arr = np.asarray(f0s, dtype=np.float64)
        median_hz = float(np.median(arr))
        mean_hz = float(np.mean(arr))
        std_hz = float(np.std(arr))

    payload = {
        "module": "qcPitch",
        "durationSec": duration_sec,
        "analyzedDurationSec": analyzed_sec,
        "sourcePath": str(input_path.resolve()),
        "method": "autocorr_window",
        "params": {
            "sampleRateHz": sr,
            "maxDurationSec": max_duration_sec,
            "frameMs": frame_ms,
            "hopMs": hop_ms,
            "f0MinHz": fmin_hz,
            "f0MaxHz": fmax_hz,
            "minCorrelation": min_corr,
            "maxFrames": max_frames,
        },
        "summary": {
            "voicedFrameCount": len(f0s),
            "windowCount": len(starts),
            "medianHz": median_hz,
            "meanHz": mean_hz,
            "stdHz": std_hz,
        },
        "note": "Estimation F0 heuristique (QC) ; ne remplace pas un pitch tracker pro ou la diarization.",
    }
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        med = f"{median_hz:.1f} Hz" if median_hz is not None else "n/a"
        emit_log(
            "info",
            "audio_modules",
            f"qcPitch: autocorr → {len(f0s)}/{len(starts)} fen. voisées, médiane≈{med} → {out_json.name}",
            18,
        )
    return str(input_path.resolve())


def _spectral_denoise_aff_and_params(spec: object) -> tuple[str, float, float]:
    """FFT denoise (ffmpeg `afftdn`) — chaîne + paramètres pour métadonnées."""
    nr = 12.0
    nf = -25.0
    if isinstance(spec, dict):
        nr = _float_from_mapping(spec, "noiseReduction", "noise_reduction", "nr", default=nr)
        nf = _float_from_mapping(spec, "noiseFloor", "noise_floor", "nf", default=nf)
    nr = max(0.01, min(nr, 100.0))
    nf = max(-80.0, min(nf, 0.0))
    return f"afftdn=nr={nr:g}:nf={nf:g}", nr, nf


def run_spectral_denoise(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Réduction de bruit spectrale légère (ffmpeg `afftdn`).
    Sortie : `studio_audio_pipeline/denoised.wav` + `spectral_denoise_meta.json`.
    """
    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_wav = pipeline_dir / "denoised.wav"
    meta_path = pipeline_dir / "spectral_denoise_meta.json"

    af, nr, nf = _spectral_denoise_aff_and_params(spec)
    cmd = [
        _ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        af,
        "-f",
        "wav",
        str(out_wav),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg introuvable (FFMPEG_BINARY). Le module spectralDenoise nécessite ffmpeg."
        ) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            sanitize_log_line(f"ffmpeg spectralDenoise a échoué (code {proc.returncode}): {err}")
        )

    duration_sec = _probe_duration_seconds(out_wav)

    meta = {
        "module": "spectralDenoise",
        "sampleRateHz": 16000,
        "channels": 1,
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "outputWavRelative": "studio_audio_pipeline/denoised.wav",
        "afftdn": {"noiseReduction": nr, "noiseFloor": nf},
        "ffmpegAudioFilter": af,
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"spectralDenoise: afftdn → {out_wav.name} (~{duration_sec:.2f}s)",
            14,
        )
    return str(out_wav.resolve())


def run_band_limit(
    input_path: Path,
    out_dir: Path,
    spec: object,
    emit_log: EmitLogFn | None,
) -> str:
    """
    Band-limiting (HPF + LPF) + encoche 50/60 Hz optionnelle (equalizer).
    Sortie : `studio_audio_pipeline/band_limited.wav` + `band_limit_meta.json`.
    """
    pipeline_dir = out_dir / "studio_audio_pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    out_wav = pipeline_dir / "band_limited.wav"
    meta_path = pipeline_dir / "band_limit_meta.json"

    af, hp, lp, notch, notch_gain = _band_limit_filter_and_params(spec)

    cmd = [
        _ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        af,
        "-f",
        "wav",
        str(out_wav),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg introuvable (FFMPEG_BINARY). Le module bandLimit nécessite ffmpeg."
        ) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            sanitize_log_line(f"ffmpeg bandLimit a échoué (code {proc.returncode}): {err}")
        )

    duration_sec = _probe_duration_seconds(out_wav)

    meta = {
        "module": "bandLimit",
        "sampleRateHz": 16000,
        "channels": 1,
        "durationSec": duration_sec,
        "sourcePath": str(input_path.resolve()),
        "outputWavRelative": "studio_audio_pipeline/band_limited.wav",
        "filters": {
            "highpassHz": hp,
            "lowpassHz": lp,
            "notchHz": notch,
            "notchGainDb": notch_gain,
        },
        "ffmpegAudioFilter": af,
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    if emit_log:
        notch_lbl = f", encoche {notch:g} Hz" if notch is not None else ""
        emit_log(
            "info",
            "audio_modules",
            f"bandLimit: HPF {hp:g} Hz / LPF {lp:g} Hz{notch_lbl} → {out_wav.name} (~{duration_sec:.2f}s)",
            13,
        )
    return str(out_wav.resolve())


def _parse_audio_pipeline_segments(options: dict[str, object]) -> list[dict[str, object]] | None:
    raw = options.get("audioPipelineSegments") or options.get("audio_pipeline_segments")
    if raw is None:
        return None
    if not isinstance(raw, list) or len(raw) == 0:
        return None
    out: list[dict[str, object]] = []
    for item in raw:
        if isinstance(item, dict):
            out.append(item)
    return out or None


def _segment_time_bounds(seg: dict[str, object]) -> tuple[float, float]:
    a = seg.get("startSec", seg.get("start_sec"))
    b = seg.get("endSec", seg.get("end_sec"))
    if isinstance(a, bool) or isinstance(b, bool):
        raise RuntimeError("audioPipelineSegments: startSec/endSec invalides.")
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return float(a), float(b)
    raise RuntimeError("audioPipelineSegments: startSec et endSec (secondes) sont requis.")


def validate_audio_pipeline_segments(
    segments: list[dict[str, object]],
    duration_sec: float,
) -> list[dict[str, object]]:
    """Valide des plages [t0,t1] sans chevauchement ; utilisé par le worker et les tests."""
    if duration_sec <= 0:
        raise RuntimeError("Durée média nulle ou illisible — impossible de valider les plages.")
    if not segments:
        raise RuntimeError("audioPipelineSegments: liste vide.")
    cleaned: list[tuple[float, float, dict[str, object]]] = []
    for i, seg in enumerate(segments):
        try:
            t0, t1 = _segment_time_bounds(seg)
        except RuntimeError as exc:
            raise RuntimeError(
                sanitize_log_line(f"audioPipelineSegments[{i}]: {exc}")
            ) from exc
        if t1 <= t0:
            raise RuntimeError(f"audioPipelineSegments[{i}]: endSec doit être > startSec.")
        if t1 - t0 < 0.05:
            raise RuntimeError(f"audioPipelineSegments[{i}]: plage trop courte (< 50 ms).")
        if t0 < 0 or t1 > duration_sec + 1e-6:
            raise RuntimeError(
                f"audioPipelineSegments[{i}]: intervalle hors fichier (0 — {duration_sec:.3f}s)."
            )
        cleaned.append((t0, t1, seg))
    cleaned.sort(key=lambda x: x[0])
    for i in range(len(cleaned) - 1):
        if cleaned[i + 1][0] < cleaned[i][1] - 1e-9:
            raise RuntimeError(
                "audioPipelineSegments: plages qui se chevauchent (non supporté pour la concat)."
            )
    return [c[2] for c in cleaned]


def _effective_modules_for_segment(
    global_spec: dict[str, object] | None,
    segment: dict[str, object],
) -> dict[str, object] | None:
    raw_seg = (
        segment.get("audioPipelineModules")
        or segment.get("modules")
        or segment.get("audio_pipeline_modules")
    )
    if isinstance(raw_seg, dict) and raw_seg:
        return dict(raw_seg)
    if global_spec:
        return dict(global_spec)
    return None


def _ffmpeg_extract_wav_segment(src: Path, dst: Path, start_sec: float, duration_sec: float) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    start_sec = max(0.0, float(start_sec))
    duration_sec = max(0.05, float(duration_sec))
    cmd = [
        _ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start_sec:.6f}",
        "-i",
        str(src),
        "-t",
        f"{duration_sec:.6f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(dst),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg introuvable (FFMPEG_BINARY). Extraction de plage impossible."
        ) from exc
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            sanitize_log_line(f"ffmpeg extraction plage a échoué (code {proc.returncode}): {err}")
        )


def _ffmpeg_concat_wavs(parts: list[Path], out: Path) -> None:
    if not parts:
        raise RuntimeError("concat: aucun fichier.")
    out.parent.mkdir(parents=True, exist_ok=True)
    if len(parts) == 1:
        shutil.copyfile(parts[0], out)
        return

    list_file = out.parent / f"_concat_{uuid.uuid4().hex}.txt"
    lines: list[str] = []
    for p in parts:
        ap = p.resolve().as_posix().replace("'", "'\\''")
        lines.append(f"file '{ap}'")
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    cmd = [
        _ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c",
        "copy",
        str(out),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=86_400)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg introuvable (FFMPEG_BINARY).") from exc
    if proc.returncode != 0:
        cmd2 = [
            _ffmpeg_binary(),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c:a",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(out),
        ]
        proc2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=86_400)
        if proc2.returncode != 0:
            err = (proc2.stderr or proc2.stdout or "").strip()
            raise RuntimeError(sanitize_log_line(f"ffmpeg concat a échoué: {err}"))
    try:
        list_file.unlink()
    except OSError:
        pass


def _run_segmented_audio_pipeline(
    input_path: str,
    out_dir: Path,
    options: dict[str, object],
    segments: list[dict[str, object]],
    emit_log: EmitLogFn | None,
) -> str:
    """WX-623 — par plage : extraction ffmpeg → pipeline modules (global ou par plage) → concat WAV."""
    src = Path(input_path)
    pipeline_root = out_dir / "studio_audio_pipeline"
    pipeline_root.mkdir(parents=True, exist_ok=True)
    work = pipeline_root / "segment_jobs"
    work.mkdir(parents=True, exist_ok=True)
    global_spec = _get_audio_modules_spec(options)

    processed: list[Path] = []
    manifest_rows: list[dict[str, object]] = []

    for i, seg in enumerate(segments):
        t0, t1 = _segment_time_bounds(seg)
        span = t1 - t0
        raw_chunk = work / f"chunk_{i:02d}_extract.wav"
        _ffmpeg_extract_wav_segment(src, raw_chunk, t0, span)

        eff = _effective_modules_for_segment(global_spec, seg)
        opts_seg: dict[str, object] = {
            k: v
            for k, v in options.items()
            if k not in ("audioPipelineSegments", "audio_pipeline_segments")
        }
        if eff:
            opts_seg["audioPipelineModules"] = eff
        else:
            opts_seg.pop("audioPipelineModules", None)
            opts_seg.pop("audio_pipeline_modules", None)

        sub_out = work / f"job_{i:02d}"
        sub_out.mkdir(parents=True, exist_ok=True)
        if eff:
            out_i = Path(maybe_prepare_audio_input(str(raw_chunk), sub_out, opts_seg, emit_log=emit_log))
        else:
            out_i = raw_chunk

        processed.append(out_i)
        manifest_rows.append(
            {
                "index": i,
                "startSec": t0,
                "endSec": t1,
                "modules": eff,
                "processedPath": str(out_i.resolve()),
            }
        )

    out_concat = pipeline_root / "segment_concat.wav"
    _ffmpeg_concat_wavs(processed, out_concat)

    manifest_path = pipeline_root / "segment_pipeline_manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "wx623SegmentPipeline": True,
                "sourcePath": str(src.resolve()),
                "segmentCount": len(segments),
                "segments": manifest_rows,
                "outputWavRelative": "studio_audio_pipeline/segment_concat.wav",
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    range_bits = [f"{_segment_time_bounds(seg)[0]:.2f}-{_segment_time_bounds(seg)[1]:.2f}s" for seg in segments]
    ranges_pretty = "[" + ", ".join(range_bits) + "]"
    if emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"WX-623: pipeline par plages — {len(segments)} segment(s) {ranges_pretty} → segment_concat.wav "
            f"(manifest: segment_pipeline_manifest.json)",
            8,
        )

    return str(out_concat.resolve())


def maybe_prepare_audio_input(
    input_path: str,
    out_dir: Path,
    options: dict[str, object],
    *,
    emit_log: EmitLogFn | None = None,
) -> str:
    """
    Point d'entrée avant `whisperx` : prépare un WAV dérivé ou retourne `input_path`.
    """
    segment_list = _parse_audio_pipeline_segments(options)
    if segment_list:
        duration_sec = _probe_duration_seconds(Path(input_path))
        validated = validate_audio_pipeline_segments(segment_list, duration_sec)
        summary = summarize_requested_modules(options)
        range_bits = [
            f"{_segment_time_bounds(seg)[0]:.2f}-{_segment_time_bounds(seg)[1]:.2f}s"
            for seg in validated
        ]
        ranges_pretty = "[" + ", ".join(range_bits) + "]"
        if emit_log:
            emit_log(
                "info",
                "audio_modules",
                f"WX-623: {len(validated)} plage(s) validée(s) {ranges_pretty}"
                + (f" ; modules globaux: {summary}" if summary else ""),
                5,
            )
        return _run_segmented_audio_pipeline(input_path, out_dir, options, validated, emit_log)

    spec = _get_audio_modules_spec(options)
    if not spec:
        return input_path

    summary = summarize_requested_modules(options)
    if summary and emit_log:
        emit_log(
            "info",
            "audio_modules",
            f"Modules audio demandés (pipeline) : {summary}",
            6,
        )

    current = Path(input_path)
    did_run = False

    # Choix L/R (stéréo 2.0) avant tout mixage mid / downmix.
    if _module_wants(spec, "bestChannel"):
        raw_bc = spec.get("bestChannel")
        did_run = True
        current = Path(run_best_channel(current, out_dir, raw_bc, emit_log))

    # Avant mixage mono « générique » : extraire mid / L / R si stéréo.
    if _module_wants(spec, "stereoMidSide"):
        raw_sms = spec.get("stereoMidSide")
        did_run = True
        current = Path(run_stereo_mid_side(current, out_dir, raw_sms, emit_log))

    if _module_wants(spec, "preNormalize"):
        raw_pn = spec.get("preNormalize")
        did_run = True
        current = Path(run_pre_normalize(current, out_dir, raw_pn, emit_log))

    if _module_wants(spec, "normalizeLoudness"):
        # WX-662 — normalisation EBU R128 2 passes via whisperx/audio_preprocessing.py
        raw_nl = spec.get("normalizeLoudness")
        nl_opts: dict = raw_nl if isinstance(raw_nl, dict) else {}
        try:
            from whisperx.audio_preprocessing import normalize_loudness_two_pass
        except ImportError:
            try:
                from audio_preprocessing import normalize_loudness_two_pass  # type: ignore[no-redef]
            except ImportError:
                raise RuntimeError(
                    "Module normalizeLoudness indisponible : whisperx.audio_preprocessing introuvable."
                )
        did_run = True
        current = Path(normalize_loudness_two_pass(str(current), out_dir, nl_opts, emit_log))

    if _module_wants(spec, "denoise"):
        # WX-663 — débruitage Python (noisereduce / DeepFilterNet)
        raw_dn = spec.get("denoise")
        dn_opts: dict = raw_dn if isinstance(raw_dn, dict) else {}
        try:
            from whisperx.audio_preprocessing import denoise_audio
        except ImportError:
            try:
                from audio_preprocessing import denoise_audio  # type: ignore[no-redef]
            except ImportError:
                raise RuntimeError(
                    "Module denoise indisponible : whisperx.audio_preprocessing introuvable."
                )
        did_run = True
        current = Path(denoise_audio(str(current), out_dir, dn_opts, emit_log))

    if _module_wants(spec, "bandLimit"):
        raw_bl = spec.get("bandLimit")
        did_run = True
        current = Path(run_band_limit(current, out_dir, raw_bl, emit_log))

    if _module_wants(spec, "spectralDenoise"):
        raw_sd = spec.get("spectralDenoise")
        did_run = True
        current = Path(run_spectral_denoise(current, out_dir, raw_sd, emit_log))

    if _module_wants(spec, "vadModel"):
        raw_vm = spec.get("vadModel")
        did_run = True
        current = Path(run_vad_model(current, out_dir, raw_vm, emit_log))

    if _module_wants(spec, "vadEnergy"):
        raw_ve = spec.get("vadEnergy")
        did_run = True
        current = Path(run_vad_energy(current, out_dir, raw_ve, emit_log))

    if _module_wants(spec, "vadAlignedChunking"):
        raw_vac = spec.get("vadAlignedChunking")
        did_run = True
        current = Path(run_vad_aligned_chunking(current, out_dir, raw_vac, emit_log))

    if _module_wants(spec, "smartChunk"):
        # WX-664 — calcule les frontières de chunks VAD et les écrit dans un fichier JSON.
        # Le fichier audio courant n'est pas découpé ici ; les frontières sont utilisées
        # pour paramétrer audioPipelineSegments lors de la soumission à Whisper.
        raw_sc = spec.get("smartChunk")
        sc_opts: dict = raw_sc if isinstance(raw_sc, dict) else {}
        try:
            from whisperx.smart_chunking import compute_smart_chunk_boundaries, boundaries_to_ffmpeg_segments
        except ImportError:
            try:
                from smart_chunking import compute_smart_chunk_boundaries, boundaries_to_ffmpeg_segments  # type: ignore[no-redef]
            except ImportError:
                raise RuntimeError(
                    "Module smartChunk indisponible : whisperx.smart_chunking introuvable."
                )
        boundaries = compute_smart_chunk_boundaries(str(current), sc_opts, emit_log)
        # Persiste les frontières dans audio_preprocessing/smart_chunk_boundaries.json
        import json as _json
        sc_dir = out_dir / "audio_preprocessing"
        sc_dir.mkdir(parents=True, exist_ok=True)
        boundaries_path = sc_dir / "smart_chunk_boundaries.json"
        boundaries_path.write_text(
            _json.dumps({"boundaries": boundaries_to_ffmpeg_segments(boundaries)}, indent=2),
            encoding="utf-8",
        )
        if emit_log:
            emit_log("info", "smart_chunking",
                     f"{len(boundaries)} frontière(s) de chunk écrites → {boundaries_path.name}", None)
        did_run = True

    if _module_wants(spec, "sourceSeparate"):
        # WX-666 — séparation sources voix/fond via Demucs.
        # Remplace l'audio courant par la piste voix extraite (vocals.wav).
        raw_ss = spec.get("sourceSeparate")
        ss_opts: dict = raw_ss if isinstance(raw_ss, dict) else {}
        try:
            from whisperx.audio_preprocessing import separate_sources
        except ImportError:
            try:
                from audio_preprocessing import separate_sources  # type: ignore[no-redef]
            except ImportError:
                raise RuntimeError(
                    "Module sourceSeparate indisponible : whisperx.audio_preprocessing introuvable."
                )
        did_run = True
        current = Path(separate_sources(str(current), out_dir, ss_opts, emit_log))

    if _module_wants(spec, "speakerTurnPostprocess"):
        raw_stp = spec.get("speakerTurnPostprocess")
        did_run = True
        current = Path(run_speaker_turn_postprocess(current, out_dir, raw_stp, emit_log))

    if _module_wants(spec, "overlapDetection"):
        raw_od = spec.get("overlapDetection")
        did_run = True
        current = Path(run_overlap_detection(current, out_dir, raw_od, emit_log))

    if _module_wants(spec, "qcSpectral"):
        raw_qs = spec.get("qcSpectral")
        did_run = True
        current = Path(run_qc_spectral(current, out_dir, raw_qs, emit_log))

    if _module_wants(spec, "qcPitch"):
        raw_qp = spec.get("qcPitch")
        did_run = True
        current = Path(run_qc_pitch(current, out_dir, raw_qp, emit_log))

    if _module_wants(spec, "acousticPauses"):
        raw_ap = spec.get("acousticPauses")
        did_run = True
        current = Path(run_acoustic_pauses(current, out_dir, raw_ap, emit_log))

    if not did_run and emit_log:
        emit_log(
            "info",
            "audio_modules",
            "Aucune étape DSP reconnue ou implémentée — exécution WhisperX sur le fichier source.",
            7,
        )

    return str(current)

