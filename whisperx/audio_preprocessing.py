"""
WX-662/663 — Prétraitement audio pré-transcription.

Modules disponibles :
  normalize_loudness_two_pass  — normalisation EBU R128 via FFmpeg 2 passes (WX-662)
  denoise_audio                — débruitage avec noisereduce ou DeepFilterNet (WX-663)

WX-662 — Normalisation loudness EBU R128 (LUFS) via FFmpeg en 2 passes.

Module : `normalize_loudness`
Paramètres JSON (tous optionnels) :
  target_lufs      — cible intégrée (défaut -16.0 LUFS)
  true_peak_limit  — pic vrai max (défaut -1.0 dBFS)
  lra              — Loudness Range (défaut 11.0 LU)

Passe 1 : mesure des niveaux réels du fichier source (ffmpeg loudnorm print_format=json).
Passe 2 : application de la correction avec les valeurs mesurées (normalization linéaire précise).

Le fichier source n'est jamais modifié. Le fichier normalisé est écrit dans
  `<out_dir>/audio_preprocessing/normalized_lufs.wav`.

Usage :
  from whisperx.audio_preprocessing import normalize_loudness_two_pass
  output_path = normalize_loudness_two_pass("input.m4a", Path("runs/001"), options)
"""

from __future__ import annotations

import json
import os
import subprocess
import re
from pathlib import Path


def _ffmpeg() -> str:
    return os.environ.get("FFMPEG_BINARY", "ffmpeg")


def _run_ffmpeg(args: list[str], timeout: int = 86_400) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise RuntimeError(
            "ffmpeg introuvable. Assurez-vous que ffmpeg est installé et accessible dans PATH."
        ) from exc


def _measure_loudnorm(input_path: str, target_lufs: float, lra: float, tp: float) -> dict:
    """
    Passe 1 — mesure EBU R128.
    Retourne le JSON de stats loudnorm (input_i, input_tp, input_lra, input_thresh, …).
    """
    af = f"loudnorm=I={target_lufs}:TP={tp}:LRA={lra}:print_format=json"
    cmd = [
        _ffmpeg(), "-hide_banner", "-loglevel", "info",
        "-i", input_path,
        "-vn", "-af", af,
        "-f", "null", "/dev/null" if os.name != "nt" else "NUL",
    ]
    proc = _run_ffmpeg(cmd)
    # loudnorm écrit le JSON sur stderr
    output = proc.stderr or ""
    # Extrait le bloc JSON (entre { et } en fin de sortie)
    match = re.search(r"\{[^{}]*\}", output, re.DOTALL)
    if not match:
        raise RuntimeError(
            f"loudnorm passe 1 : impossible de lire les statistiques EBU R128.\n"
            f"Stderr: {output[-500:]}"
        )
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"loudnorm passe 1 : JSON invalide — {exc}") from exc


def _apply_loudnorm(
    input_path: str,
    output_path: str,
    measured: dict,
    target_lufs: float,
    lra: float,
    tp: float,
) -> None:
    """
    Passe 2 — application de la correction avec les valeurs mesurées.
    Utilise le mode `linear=true` pour une normalisation précise.
    """
    i = measured.get("input_i", "-70")
    tp_m = measured.get("input_tp", "-120")
    lra_m = measured.get("input_lra", "0")
    thresh = measured.get("input_thresh", "-70")
    offset = measured.get("target_offset", "0")

    af = (
        f"loudnorm=I={target_lufs}:TP={tp}:LRA={lra}:linear=true:"
        f"measured_I={i}:measured_TP={tp_m}:measured_LRA={lra_m}:"
        f"measured_thresh={thresh}:offset={offset}:print_format=none"
    )
    cmd = [
        _ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
        "-i", input_path,
        "-vn", "-ac", "1", "-ar", "16000",
        "-af", af,
        "-f", "wav", output_path,
    ]
    proc = _run_ffmpeg(cmd)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"loudnorm passe 2 a échoué (code {proc.returncode}): {err}")


def normalize_loudness_two_pass(
    input_path: str,
    out_dir: Path,
    options: dict | None = None,
    emit_log=None,
) -> str:
    """
    Normalise le fichier audio en 2 passes EBU R128 via ffmpeg.
    Retourne le chemin absolu du WAV normalisé.

    Le fichier source n'est pas modifié.
    """
    spec = options or {}
    target_lufs: float = float(spec.get("target_lufs", -16.0))  # type: ignore[arg-type]
    true_peak_limit: float = float(spec.get("true_peak_limit", -1.0))  # type: ignore[arg-type]
    lra: float = float(spec.get("lra", 11.0))  # type: ignore[arg-type]

    prep_dir = out_dir / "audio_preprocessing"
    prep_dir.mkdir(parents=True, exist_ok=True)
    output_path = str((prep_dir / "normalized_lufs.wav").resolve())

    if emit_log:
        emit_log("info", "audio_preprocessing",
                 f"Loudness normalization passe 1/2 (cible {target_lufs} LUFS)…", None)

    measured = _measure_loudnorm(input_path, target_lufs, lra, true_peak_limit)

    if emit_log:
        input_i = measured.get("input_i", "?")
        emit_log("info", "audio_preprocessing",
                 f"Passe 1 terminée — niveau mesuré : {input_i} LUFS. Application passe 2/2…", None)

    _apply_loudnorm(input_path, output_path, measured, target_lufs, lra, true_peak_limit)

    if emit_log:
        emit_log("info", "audio_preprocessing",
                 f"Normalisation EBU R128 terminée → {Path(output_path).name}", None)

    return output_path


# ---------------------------------------------------------------------------
# WX-663 — Débruitage audio (noisereduce / DeepFilterNet)
# ---------------------------------------------------------------------------

def _load_wav_as_float32(path: str) -> "tuple[int, any]":
    """Charge un WAV en array float32 numpy. Retourne (sample_rate, data_1d)."""
    import wave
    import struct as _struct
    import numpy as np

    with wave.open(path, "rb") as wf:
        sr = wf.getframerate()
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    fmt = {1: "b", 2: "h", 4: "i"}.get(sampwidth)
    if not fmt:
        raise RuntimeError(f"Format PCM non supporté (sampwidth={sampwidth})")
    n_samples = n_frames * n_channels
    samples = np.array(_struct.unpack(f"<{n_samples}{fmt}", raw), dtype=np.float32)
    max_val = float(2 ** (8 * sampwidth - 1))
    samples /= max_val

    if n_channels > 1:
        samples = samples.reshape(-1, n_channels).mean(axis=1)

    return sr, samples


def _save_float32_as_wav(data: "any", sample_rate: int, path: str) -> None:
    """Sauvegarde un array float32 1D en WAV PCM 16-bit."""
    import wave
    import struct as _struct
    import numpy as np

    int_data = np.clip(data * 32768.0, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(_struct.pack(f"<{len(int_data)}h", *int_data.tolist()))


def _denoise_noisereduce(
    data: "any",
    sample_rate: int,
    prop_decrease: float,
) -> "any":
    """Débruitage spectral stationnaire via le package `noisereduce`."""
    try:
        import noisereduce as nr
    except ImportError as exc:
        raise RuntimeError(
            "Package 'noisereduce' introuvable. Installez-le : pip install noisereduce"
        ) from exc
    return nr.reduce_noise(y=data, sr=sample_rate, prop_decrease=prop_decrease)


def _denoise_deepfilternet(
    input_wav: str,
    output_wav: str,
    emit_log=None,
) -> None:
    """
    Débruitage neuronal via DeepFilterNet.
    Appelle le binaire `deepFilter` (CLI) si disponible, sinon l'API Python.
    """
    import subprocess as _sp
    import shutil

    # Tentative CLI (plus rapide, pas de chargement modèle Python en mémoire)
    cli = shutil.which("deepFilter") or shutil.which("deep-filter")
    if cli:
        proc = _sp.run([cli, input_wav, "-o", str(Path(output_wav).parent)],
                       capture_output=True, text=True)
        if proc.returncode == 0:
            # DeepFilterNet CLI écrit <basename>_DeepFilterNet3.wav — renommer
            out_dir = Path(output_wav).parent
            candidates = list(out_dir.glob("*DeepFilterNet*.wav"))
            if candidates:
                candidates[0].rename(output_wav)
                return
        if emit_log:
            emit_log("warning", "audio_preprocessing",
                     f"deepFilter CLI a échoué ({proc.returncode}) — fallback API Python.", None)

    # Fallback API Python
    try:
        from df.enhance import enhance, init_df, load_audio, save_audio
    except ImportError as exc:
        raise RuntimeError(
            "Package 'deepfilternet' introuvable. Installez-le : pip install deepfilternet\n"
            "Sans ce package, utilisez backend='noisereduce'."
        ) from exc

    model, df_state, _ = init_df()
    audio, _ = load_audio(input_wav, sr=df_state.sr())
    enhanced = enhance(model, df_state, audio)
    save_audio(output_wav, enhanced, df_state.sr())


def denoise_audio(
    input_path: str,
    out_dir: "Path",
    options: dict | None = None,
    emit_log=None,
) -> str:
    """
    WX-663 — Débruitage audio pré-transcription.

    Paramètres (dans `options`) :
      backend        — 'noisereduce' (défaut) ou 'deepfilternet'
      prop_decrease  — intensité de réduction [0.0–1.0], défaut 0.75 (noisereduce uniquement)

    Retourne le chemin absolu du WAV dénoisé.
    Le fichier source n'est pas modifié.
    """
    spec = options or {}
    backend: str = str(spec.get("backend", "noisereduce")).lower()
    prop_decrease: float = float(spec.get("prop_decrease", 0.75))  # type: ignore[arg-type]

    prep_dir = out_dir / "audio_preprocessing"
    prep_dir.mkdir(parents=True, exist_ok=True)
    output_path = str((prep_dir / "denoised.wav").resolve())

    if emit_log:
        emit_log("info", "audio_preprocessing",
                 f"Débruitage audio (backend={backend})…", None)

    if backend == "deepfilternet":
        # DeepFilterNet opère directement sur des fichiers WAV.
        # On prépare d'abord un WAV 16 kHz mono si nécessaire.
        import shutil
        tmp_wav = str((prep_dir / "_dfn_input.wav").resolve())
        # Resample + mono via ffmpeg
        proc = _run_ffmpeg([
            _ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", input_path, "-vn", "-ac", "1", "-ar", "48000",  # DFN préfère 48 kHz
            "-f", "wav", tmp_wav,
        ])
        if proc.returncode != 0:
            raise RuntimeError(f"Préparation WAV pour DeepFilterNet échouée : {proc.stderr}")
        try:
            _denoise_deepfilternet(tmp_wav, output_path, emit_log)
        except RuntimeError as exc:
            if emit_log:
                emit_log("warning", "audio_preprocessing",
                         f"DeepFilterNet indisponible — fallback noisereduce : {exc}", None)
            # Fallback noisereduce
            try:
                sr, data = _load_wav_as_float32(tmp_wav)
                denoised = _denoise_noisereduce(data, sr, prop_decrease)
                _save_float32_as_wav(denoised, sr, output_path)
            except ImportError:
                shutil.copy2(tmp_wav, output_path)
        finally:
            Path(tmp_wav).unlink(missing_ok=True)
    else:
        # noisereduce — charge le fichier via ffmpeg → numpy → noisereduce → WAV
        tmp_wav = str((prep_dir / "_nr_input.wav").resolve())
        proc = _run_ffmpeg([
            _ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
            "-i", input_path, "-vn", "-ac", "1", "-ar", "16000",
            "-f", "wav", tmp_wav,
        ])
        if proc.returncode != 0:
            raise RuntimeError(f"Conversion WAV pour noisereduce échouée : {proc.stderr}")
        try:
            sr, data = _load_wav_as_float32(tmp_wav)
            denoised = _denoise_noisereduce(data, sr, prop_decrease)
            _save_float32_as_wav(denoised, sr, output_path)
        finally:
            Path(tmp_wav).unlink(missing_ok=True)

    if emit_log:
        emit_log("info", "audio_preprocessing",
                 f"Débruitage terminé → {Path(output_path).name}", None)

    return output_path


# ---------------------------------------------------------------------------
# WX-666 — Séparation sources voix/fond (Demucs)
# ---------------------------------------------------------------------------

def separate_sources(
    input_path: str,
    out_dir: "Path",
    options: dict | None = None,
    emit_log=None,
) -> str:
    """
    WX-666 — Séparation sources voix/fond via Demucs.

    Paramètres (dans `options`) :
      model   — 'htdemucs' (défaut) ou 'htdemucs_ft'
      mode    — 'vocals_only' (défaut) — retient uniquement la piste voix
      device  — 'cpu' (défaut) ou 'cuda'

    Retourne le chemin absolu du WAV voix isolé (vocals.wav).
    Le fichier source n'est pas modifié.

    Nécessite le package `demucs` (pip install demucs).
    Avertissement : ~3× temps réel sur CPU, GPU fortement recommandé.
    """
    import shutil
    import subprocess as _sp

    spec = options or {}
    model: str = str(spec.get("model", "htdemucs"))
    device: str = str(spec.get("device", "cpu"))

    prep_dir = out_dir / "audio_preprocessing"
    prep_dir.mkdir(parents=True, exist_ok=True)
    output_path = str((prep_dir / "vocals.wav").resolve())

    if emit_log:
        emit_log(
            "info",
            "audio_preprocessing",
            f"Séparation sources Demucs ({model}, device={device})…",
            None,
        )
        if device == "cpu":
            emit_log(
                "warning",
                "audio_preprocessing",
                "Demucs tourne sur CPU (~3× temps réel). GPU (CUDA) recommandé.",
                None,
            )

    # Prépare un WAV 44.1 kHz mono (format préféré de Demucs).
    tmp_wav = str((prep_dir / "_demucs_input.wav").resolve())
    proc = _run_ffmpeg([
        _ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
        "-i", input_path, "-vn", "-ac", "1", "-ar", "44100",
        "-f", "wav", tmp_wav,
    ])
    if proc.returncode != 0:
        raise RuntimeError(f"Préparation WAV pour Demucs échouée : {proc.stderr}")

    sep_dir = prep_dir / "_demucs_out"
    sep_dir.mkdir(parents=True, exist_ok=True)

    # Tente la CLI `demucs` en premier (plus simple à appeler).
    demucs_cli = shutil.which("demucs")
    cli_ok = False
    if demucs_cli:
        try:
            result = _sp.run(
                [demucs_cli, "--two-stems", "vocals", "-n", model,
                 "--out", str(sep_dir), "--device", device, tmp_wav],
                capture_output=True, text=True, timeout=3600,
            )
            cli_ok = result.returncode == 0
            if not cli_ok and emit_log:
                emit_log(
                    "warning", "audio_preprocessing",
                    f"demucs CLI a échoué (code {result.returncode}) — fallback Python API.",
                    None,
                )
        except _sp.TimeoutExpired:
            if emit_log:
                emit_log("warning", "audio_preprocessing",
                         "demucs CLI timeout — fallback Python API.", None)

    # Tente `python -m demucs` si la CLI manque ou a échoué.
    if not cli_ok:
        import sys as _sys
        result = _sp.run(
            [_sys.executable, "-m", "demucs", "--two-stems", "vocals", "-n", model,
             "--out", str(sep_dir), "--device", device, tmp_wav],
            capture_output=True, text=True, timeout=3600,
        )
        cli_ok = result.returncode == 0
        if not cli_ok and emit_log:
            emit_log(
                "warning", "audio_preprocessing",
                f"python -m demucs a échoué (code {result.returncode}) — fallback Python API.",
                None,
            )

    # Localise vocals.wav dans la sortie CLI.
    if cli_ok:
        vocals_candidates = list(sep_dir.rglob("vocals.wav"))
        if vocals_candidates:
            import shutil as _shutil
            _shutil.copy2(str(vocals_candidates[0]), output_path)
            _shutil.rmtree(str(sep_dir), ignore_errors=True)
            Path(tmp_wav).unlink(missing_ok=True)
            if emit_log:
                emit_log("info", "audio_preprocessing",
                         "Séparation terminée → vocals.wav", None)
            return output_path

    # Fallback : Python API demucs>=4.0
    try:
        from demucs.api import Separator  # type: ignore
    except ImportError as exc:
        Path(tmp_wav).unlink(missing_ok=True)
        raise RuntimeError(
            "Package 'demucs' introuvable. Installez-le : pip install demucs\n"
            "Sans ce package, le module sourceSeparate est indisponible."
        ) from exc

    import shutil as _shutil
    try:
        separator = Separator(model=model, device=device)
        _, stems = separator.separate_audio_file(tmp_wav)
        vocals_tensor = stems.get("vocals")
        if vocals_tensor is None:
            raise RuntimeError("Demucs n'a pas produit de piste 'vocals'.")
        try:
            import torchaudio  # type: ignore
            torchaudio.save(output_path, vocals_tensor, separator.samplerate)
        except ImportError:
            # Fallback : écriture manuelle via soundfile ou scipy
            import numpy as np
            vocals_np = vocals_tensor.cpu().numpy()
            if vocals_np.ndim == 2:
                vocals_np = vocals_np.mean(axis=0)
            _save_float32_as_wav(vocals_np.astype(np.float32), separator.samplerate, output_path)
    finally:
        Path(tmp_wav).unlink(missing_ok=True)
        _shutil.rmtree(str(sep_dir), ignore_errors=True)

    if emit_log:
        emit_log("info", "audio_preprocessing",
                 "Séparation terminée (API Python) → vocals.wav", None)

    return output_path
