#!/usr/bin/env python3
"""
Local worker entrypoint used by Tauri.

Modes:
- mock: no ASR execution, writes deterministic sample artifacts.
- whisperx: invokes local whisperx CLI and writes resulting files.

Progress protocol (stdout, one JSON object per line):
- Lines prefixed with LOG_PREFIX (__WXLOG__) are parsed by the Rust sidecar and relayed to the UI.
- Final success line uses RESULT_PREFIX (__WXRESULT__) with output file paths.
- WhisperX peut émettre des lignes `Progress: NN.NN%...` (voir --print_progress) ; le worker les
  transforme en progression job monotone (30–95 %) pour l’UI.
"""

from __future__ import annotations

import argparse
from collections import deque
import inspect
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    from studio_audio_modules import maybe_prepare_audio_input
except ImportError:

    def maybe_prepare_audio_input(
        input_path: str,
        out_dir: Path,
        options: dict[str, object],
        *,
        emit_log=None,
    ) -> str:
        _ = (out_dir, options, emit_log)
        return input_path


LOG_PREFIX = "__WXLOG__"
RESULT_PREFIX = "__WXRESULT__"
SUPPORTED_OUTPUT_FORMATS = {"all", "json", "srt", "vtt", "txt", "tsv", "aud"}

# whisperx/asr.py et whisperx/alignment.py : print(f"Progress: {percent_complete:.2f}%...")
WHISPERX_PROGRESS_RE = re.compile(r"Progress:\s*([\d.]+)\s*%", re.IGNORECASE)

# whisperx/asr.py (verbose) : print(f"Transcript: [{start} --> {end}] {text}")
LIVE_TRANSCRIPT_RE = re.compile(
    r"Transcript:\s*\[([\d.]+)\s*-->\s*([\d.]+)\]\s*(.*)$",
    re.IGNORECASE | re.DOTALL,
)


def parse_live_transcript_line(line: str) -> tuple[float, float, str] | None:
    """Extrait (start, end, text) si la ligne est une sortie « Transcript: » du pipeline ASR."""
    m = LIVE_TRANSCRIPT_RE.search(line.strip())
    if not m:
        return None
    try:
        start_f = float(m.group(1))
        end_f = float(m.group(2))
        text = (m.group(3) or "").strip()
        return (start_f, end_f, text)
    except ValueError:
        return None


def parse_whisperx_progress_line(line: str) -> float | None:
    """Extrait le pourcentage WhisperX (0–100) si la ligne est une ligne Progress."""
    m = WHISPERX_PROGRESS_RE.search(line)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def infer_whisperx_stdout_stage(line: str) -> str | None:
    """
    Déduit une étape pipeline pour l’UI à partir d’une ligne stdout/stderr fusionnée WhisperX.
    Les libellés correspondent aux logger.info courants de whisperx/transcribe.py.
    """
    low = line.lower()

    if "failed to align segment" in low:
        return "wx_align"
    if "performing alignment" in low:
        return "wx_align"
    if "new language found" in low and "alignment model" in low:
        return "wx_align"

    if "loading diarization model" in low:
        return "wx_diarize"
    if "performing diarization" in low:
        return "wx_diarize"
    if "using model:" in low and "pyannote" in low:
        return "wx_diarize"

    if "performing voice activity detection" in low:
        return "wx_transcribe"
    if "performing transcription" in low:
        return "wx_transcribe"
    if "using media chunking" in low:
        return "wx_transcribe"
    if "transcribed chunk #" in low:
        return "wx_transcribe"
    if "resuming chunk #" in low:
        return "wx_transcribe"
    if "transcript:" in low and "-->" in line:
        return "wx_transcribe"
    if "detected language:" in low and "first 30s" in low:
        return "wx_transcribe"
    if "compute type not specified" in low:
        return "wx_transcribe"
    if "no language specified, language will be detected" in low:
        return "wx_transcribe"
    if "suppressing numeral and symbol tokens" in low:
        return "wx_transcribe"
    if "use manually assigned vad_model" in low:
        return "wx_transcribe"

    if "applied external word timings" in low:
        return "wx_align"
    if "analyze-only completed" in low:
        return "wx_analyze"

    return None


class WhisperxProgressMapper:
    """
    WhisperX répète souvent 0–100 % par phase (transcription, alignement, chunks).
    Phase 0 : 30–65 % (transcription / premier passage). Phases suivantes : le reliquat jusqu’à 95 %
    par paliers (reset = baisse brutale du % WhisperX, ex. fin transcription → alignement).

    Étape wx_diarize : un seul 0–100 % monotone (segmentation + embeddings pyannote) ; on mappe
    linéairement le reliquat job jusqu’à 95 % sans traiter la diarisation comme un « reset » de phase.
    """

    __slots__ = ("_last_emitted", "_last_wx", "_phase", "_diarize_start_emitted")

    def __init__(self) -> None:
        self._last_wx = -1.0
        self._last_emitted = 30
        self._phase = 0
        self._diarize_start_emitted: int | None = None

    def feed(self, wx_pct: float, stage: str | None = None) -> int | None:
        """Retourne un nouveau pourcentage job (31–95) si la barre doit avancer, sinon None."""
        wx_pct = max(0.0, min(100.0, wx_pct))
        last_emitted = self._last_emitted

        if stage == "wx_diarize":
            if self._diarize_start_emitted is None:
                self._diarize_start_emitted = last_emitted
            span = 95 - self._diarize_start_emitted
            if span <= 0:
                self._last_wx = wx_pct
                return None
            candidate = self._diarize_start_emitted + int((wx_pct / 100.0) * span)
            candidate = max(last_emitted, min(95, candidate))
            self._last_wx = wx_pct
            if candidate > last_emitted:
                self._last_emitted = candidate
                return candidate
            return None

        self._diarize_start_emitted = None

        last_wx = self._last_wx
        if last_wx >= 0.0 and wx_pct < last_wx - 20.0 and last_wx > 55.0:
            self._phase += 1

        if self._phase == 0:
            linear = 30 + int(wx_pct * 0.35)
            candidate = max(last_emitted, min(65, linear))
        else:
            step = min(25, max(0, 95 - last_emitted))
            candidate = last_emitted + int((wx_pct / 100.0) * step)

        candidate = max(last_emitted, min(95, candidate))
        self._last_wx = wx_pct
        if candidate > last_emitted:
            self._last_emitted = candidate
            return candidate
        return None


def emit_log(
    level: str,
    stage: str,
    message: str,
    progress: int | None = None,
) -> None:
    payload: dict[str, object] = {
        "level": level,
        "stage": stage,
        "message": message,
    }
    if progress is not None:
        payload["progress"] = max(0, min(100, int(progress)))
    print(f"{LOG_PREFIX}{json.dumps(payload, ensure_ascii=False)}", flush=True)


def emit_result(message: str, output_files: list[str]) -> None:
    payload = {"message": message, "output_files": output_files}
    print(f"{RESULT_PREFIX}{json.dumps(payload, ensure_ascii=False)}", flush=True)


_whisperx_help_cache: str | None = None
_whisperx_fork_cache: bool | None = None


def _whisperx_cli_help_text() -> str:
    """Texte de `python -m whisperx --help` (mis en cache pour le process)."""
    global _whisperx_help_cache
    if _whisperx_help_cache is None:
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "whisperx", "--help"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            _whisperx_help_cache = (proc.stdout or "") + (proc.stderr or "")
        except (OSError, subprocess.TimeoutExpired) as exc:
            emit_log("warning", "whisperx", f"Impossible de lire whisperx --help: {exc}", 5)
            _whisperx_help_cache = ""
    return _whisperx_help_cache


def _whisperx_cli_is_lingwhistx_fork() -> bool:
    """Le fork LingWhistX ajoute --analysis_* et --pipeline_chunk_* (entre autres).

    On teste d'abord la sortie de `--help` ; si elle est vide ou tronquée, on relit
    `whisperx/cli.py` chargé par le même interpréteur (détecte le fork même quand
    l'aide argparse échoue ou diffère).
    """
    global _whisperx_fork_cache
    if _whisperx_fork_cache is not None:
        return _whisperx_fork_cache

    helpt = _whisperx_cli_help_text()
    if "analysis_pause_min" in helpt:
        _whisperx_fork_cache = True
        return True

    try:
        import whisperx.cli as wx_cli

        cli_path = Path(inspect.getfile(wx_cli))
        source = cli_path.read_text(encoding="utf-8", errors="ignore")
        if "analysis_pause_min" in source:
            _whisperx_fork_cache = True
            emit_log(
                "info",
                "whisperx",
                f"Fork LingWhistX détecté via {cli_path} (aide CLI sans marqueur attendu).",
                8,
            )
            return True
    except Exception as exc:
        emit_log("warning", "whisperx", f"Détection fork: lecture cli.py impossible: {exc}", 6)

    _whisperx_fork_cache = False
    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WhisperX Studio worker")
    parser.add_argument("--job-id", required=True, help="Unique job id")
    parser.add_argument("--input-path", required=True, help="Input media file path")
    parser.add_argument("--output-dir", required=True, help="Directory for job outputs")
    parser.add_argument(
        "--mode",
        default="mock",
        choices=["mock", "whisperx", "analyze_only"],
        help="Execution mode",
    )
    parser.add_argument(
        "--options-json",
        default=None,
        help="Optional JSON payload for whisperx runtime options",
    )
    return parser.parse_args()


def ensure_output_dir(path: str) -> Path:
    out_dir = Path(path)
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def run_mock(job_id: str, input_path: str, out_dir: Path) -> list[str]:
    stages = [
        ("calibration", "Calibration audio", 12),
        ("transcription", "Transcription", 38),
        ("alignment", "Alignement", 62),
        ("diarization", "Diarization", 84),
        ("export", "Export", 96),
    ]

    emit_log("info", "mock", f"Input: {input_path}", 5)
    for stage, label, progress in stages:
        emit_log("info", stage, f"{label} en cours...", progress)
        time.sleep(0.25)

    raw_file = out_dir / f"{job_id}.raw.json"
    aligned_file = out_dir / f"{job_id}.aligned.json"

    raw_content = {
        "job_id": job_id,
        "mode": "mock",
        "input_path": input_path,
        "segments": [
            {"start": 0.0, "end": 1.8, "text": "sample transcript segment one"},
            {"start": 1.8, "end": 3.6, "text": "sample transcript segment two"},
        ],
        "language": "en",
    }
    aligned_content = {
        "job_id": job_id,
        "mode": "mock",
        "input_path": input_path,
        "segments": [
            {
                "start": 0.0,
                "end": 1.8,
                "speaker": "SPEAKER_00",
                "text": "sample transcript segment one",
            },
            {
                "start": 1.8,
                "end": 3.6,
                "speaker": "SPEAKER_01",
                "text": "sample transcript segment two",
            },
        ],
        "language": "en",
    }

    raw_file.write_text(json.dumps(raw_content, indent=2), encoding="utf-8")
    aligned_file.write_text(json.dumps(aligned_content, indent=2), encoding="utf-8")
    emit_log("info", "mock", "Artefacts mock ecrits", 99)
    return [str(raw_file), str(aligned_file)]


def resolve_hf_token(options: dict[str, object]) -> str | None:
    token = options.get("hfToken")
    if isinstance(token, str):
        token = token.strip()
        if token:
            return token

    for env_name in (
        "WHISPERX_STUDIO_HF_TOKEN",
        "WHISPERX_HF_TOKEN",
        "HF_TOKEN",
        "HUGGINGFACE_TOKEN",
    ):
        env_value = os.environ.get(env_name)
        if env_value:
            candidate = env_value.strip()
            if candidate:
                return candidate
    return None


def parse_positive_int_option(options: dict[str, object], key: str) -> int | None:
    raw_value = options.get(key)
    if raw_value is None or isinstance(raw_value, bool):
        return None

    numeric_value: float
    if isinstance(raw_value, (int, float)):
        numeric_value = float(raw_value)
    elif isinstance(raw_value, str):
        stripped = raw_value.strip()
        if not stripped:
            return None
        try:
            numeric_value = float(stripped)
        except ValueError:
            return None
    else:
        return None

    if not numeric_value.is_integer():
        return None
    as_int = int(numeric_value)
    return as_int if as_int > 0 else None


def parse_non_negative_float_option(options: dict[str, object], key: str) -> float | None:
    raw_value = options.get(key)
    if raw_value is None or isinstance(raw_value, bool):
        return None

    if isinstance(raw_value, (int, float)):
        numeric_value = float(raw_value)
    elif isinstance(raw_value, str):
        stripped = raw_value.strip()
        if not stripped:
            return None
        try:
            numeric_value = float(stripped)
        except ValueError:
            return None
    else:
        return None

    if numeric_value < 0:
        return None
    return numeric_value


def parse_optional_float_option(options: dict[str, object], key: str) -> float | None:
    raw_value = options.get(key)
    if raw_value is None or isinstance(raw_value, bool):
        return None

    if isinstance(raw_value, (int, float)):
        return float(raw_value)
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except ValueError:
            return None
    return None


def parse_bool_option(options: dict[str, object], key: str) -> bool | None:
    value = options.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return None


def append_analysis_options(command: list[str], options: dict[str, object]) -> None:
    pause_min = parse_non_negative_float_option(options, "analysisPauseMin")
    if pause_min is not None:
        command.extend(["--analysis_pause_min", f"{pause_min:g}"])

    pause_ignore_below = parse_non_negative_float_option(options, "analysisPauseIgnoreBelow")
    if pause_ignore_below is not None:
        command.extend(["--analysis_pause_ignore_below", f"{pause_ignore_below:g}"])

    pause_max = parse_optional_float_option(options, "analysisPauseMax")
    if pause_max is not None:
        command.extend(["--analysis_pause_max", f"{pause_max:g}"])

    include_nonspeech = parse_bool_option(options, "analysisIncludeNonspeech")
    if include_nonspeech is not None:
        command.extend(["--analysis_include_nonspeech", str(include_nonspeech)])

    nonspeech_min_duration = parse_non_negative_float_option(options, "analysisNonspeechMinDuration")
    if nonspeech_min_duration is not None:
        command.extend(["--analysis_nonspeech_min_duration", f"{nonspeech_min_duration:g}"])

    ipu_min_words = parse_positive_int_option(options, "analysisIpuMinWords")
    if ipu_min_words is not None:
        command.extend(["--analysis_ipu_min_words", str(ipu_min_words)])

    ipu_min_duration = parse_non_negative_float_option(options, "analysisIpuMinDuration")
    if ipu_min_duration is not None:
        command.extend(["--analysis_ipu_min_duration", f"{ipu_min_duration:g}"])

    ipu_bridge = parse_non_negative_float_option(options, "analysisIpuBridgeShortGapsUnder")
    if ipu_bridge is not None:
        command.extend(["--analysis_ipu_bridge_short_gaps_under", f"{ipu_bridge:g}"])

    preset = options.get("analysisPreset")
    if isinstance(preset, str):
        p = preset.strip().lower()
        if p in ("sport_tv", "interview"):
            command.extend(["--analysis_preset", p])

    cal_win = parse_optional_float_option(options, "analysisCalibrateWindowSec")
    if cal_win is not None and cal_win > 0:
        command.extend(["--analysis_calibrate_window_sec", f"{cal_win:g}"])
        cal_start = parse_non_negative_float_option(options, "analysisCalibrateStartSec")
        if cal_start is not None:
            command.extend(["--analysis_calibrate_start_sec", f"{cal_start:g}"])

    csd = options.get("chunkStateDir")
    if isinstance(csd, str) and csd.strip():
        command.extend(["--chunk_state_dir", csd.strip()])
    if parse_bool_option(options, "chunkResume") is True:
        command.extend(["--chunk_resume", "true"])
    if parse_bool_option(options, "chunkJsonlPerChunk") is True:
        command.extend(["--chunk_jsonl_per_chunk", "true"])

    st_preset = options.get("analysisSpeakerTurnPostprocessPreset")
    if isinstance(st_preset, str) and st_preset.strip():
        command.extend(["--analysis_speaker_turn_postprocess_preset", st_preset.strip()])
    st_merge = parse_optional_float_option(options, "analysisSpeakerTurnMergeGapSecMax")
    if st_merge is not None:
        command.extend(["--analysis_speaker_turn_merge_gap_sec_max", f"{st_merge:g}"])
    st_split = parse_optional_float_option(options, "analysisSpeakerTurnSplitWordGapSec")
    if st_split is not None:
        command.extend(["--analysis_speaker_turn_split_word_gap_sec", f"{st_split:g}"])

    wts = options.get("analysisWordTimestampStabilizeMode")
    if isinstance(wts, str) and wts.strip() and wts.strip().lower() != "off":
        command.extend(["--analysis_word_timestamp_stabilize_mode", wts.strip().lower()])
    wrl = parse_optional_float_option(options, "analysisWordTsNeighborRatioLow")
    if wrl is not None:
        command.extend(["--analysis_word_ts_neighbor_ratio_low", f"{wrl:g}"])
    wrh = parse_optional_float_option(options, "analysisWordTsNeighborRatioHigh")
    if wrh is not None:
        command.extend(["--analysis_word_ts_neighbor_ratio_high", f"{wrh:g}"])
    wsm = parse_optional_float_option(options, "analysisWordTsSmoothMaxSec")
    if wsm is not None:
        command.extend(["--analysis_word_ts_smooth_max_sec", f"{wsm:g}"])

    ext_json = options.get("externalWordTimingsJson")
    if isinstance(ext_json, str) and ext_json.strip():
        command.extend(["--external_word_timings_json", ext_json.strip()])
    if parse_bool_option(options, "externalWordTimingsStrict") is True:
        command.extend(["--external_word_timings_strict", "true"])


def run_whisperx(input_path: str, out_dir: Path, options: dict[str, object]) -> list[str]:
    input_path = maybe_prepare_audio_input(input_path, out_dir, options, emit_log=emit_log)

    requested_output_format = str(options.get("outputFormat", "all")).strip().lower() or "all"
    if requested_output_format not in SUPPORTED_OUTPUT_FORMATS:
        requested_output_format = "all"
    # Studio transcript/workspace features rely on a JSON artifact.
    # Force `all` for non-JSON single-format requests so `.json` remains available.
    output_format = (
        requested_output_format
        if requested_output_format in {"all", "json"}
        else "all"
    )
    command = [
        sys.executable,
        "-m",
        "whisperx",
        input_path,
        "--output_dir",
        str(out_dir),
        "--output_format",
        output_format,
    ]

    if output_format != requested_output_format:
        emit_log(
            "info",
            "whisperx",
            f"Format demande '{requested_output_format}' -> execution '{output_format}' pour conserver le JSON Studio.",
            12,
        )

    model = options.get("model")
    if isinstance(model, str) and model.strip():
        command.extend(["--model", model.strip()])

    language = options.get("language")
    if isinstance(language, str) and language.strip():
        command.extend(["--language", language.strip()])

    device = options.get("device")
    if isinstance(device, str) and device.strip():
        command.extend(["--device", device.strip()])
    elif sys.platform == "darwin":
        # Aligné sur whisperx/cli.py : défaut cuda si dispo, sinon cpu — jamais mps (faster-whisper/CTranslate2).
        emit_log(
            "info",
            "whisperx",
            "Device « auto » : aucun --device — WhisperX applique le défaut CLI (cpu sur macOS sans CUDA NVIDIA). "
            "La transcription et la diarisation pyannote restent sur CPU ; le GPU Apple (MPS) n’est pas utilisé par faster-whisper.",
            11,
        )

    compute_type = options.get("computeType")
    if isinstance(compute_type, str) and compute_type.strip():
        command.extend(["--compute_type", compute_type.strip()])

    batch_size = options.get("batchSize")
    if isinstance(batch_size, int) and batch_size > 0:
        command.extend(["--batch_size", str(batch_size)])

    vad_method = options.get("vadMethod")
    if isinstance(vad_method, str) and vad_method.strip():
        command.extend(["--vad_method", vad_method.strip()])

    fork_cli = _whisperx_cli_is_lingwhistx_fork()
    if fork_cli:
        pipeline_chunk_seconds = options.get("pipelineChunkSeconds")
        if isinstance(pipeline_chunk_seconds, (int, float)) and float(pipeline_chunk_seconds) > 0:
            command.extend(["--pipeline_chunk_seconds", f"{float(pipeline_chunk_seconds):g}"])

        pipeline_chunk_overlap_seconds = options.get("pipelineChunkOverlapSeconds")
        if isinstance(pipeline_chunk_overlap_seconds, (int, float)) and float(
            pipeline_chunk_overlap_seconds,
        ) >= 0:
            command.extend(
                [
                    "--pipeline_chunk_overlap_seconds",
                    f"{float(pipeline_chunk_overlap_seconds):g}",
                ]
            )
        append_analysis_options(command, options)
    else:
        emit_log(
            "warning",
            "whisperx",
            "CLI sans extensions Studio (options --analysis_*, pipeline chunk). "
            "Installez le fork LingWhistX : pip install -e <racine du dépôt> "
            "(voir whisperx-studio/README).",
            11,
        )

    command_env = os.environ.copy()
    hf_token = resolve_hf_token(options)
    if hf_token:
        command_env["WHISPERX_HF_TOKEN"] = hf_token
        command_env.setdefault("HF_TOKEN", hf_token)
        command_env.setdefault("HUGGINGFACE_TOKEN", hf_token)

    if options.get("diarize") is True:
        command.append("--diarize")
        force_n_speakers = parse_positive_int_option(options, "forceNSpeakers")
        min_speakers = parse_positive_int_option(options, "minSpeakers")
        max_speakers = parse_positive_int_option(options, "maxSpeakers")
        if force_n_speakers is not None:
            if min_speakers is not None or max_speakers is not None:
                emit_log(
                    "warning",
                    "whisperx",
                    "forceNSpeakers defini: minSpeakers/maxSpeakers ignores.",
                )
            command.extend(["--force_n_speakers", str(force_n_speakers)])
        else:
            if min_speakers is not None:
                command.extend(["--min_speakers", str(min_speakers)])
            if max_speakers is not None:
                command.extend(["--max_speakers", str(max_speakers)])

    if options.get("noAlign") is True:
        command.append("--no_align")

    # Toujours activer côté sous-processus : le worker parse `Progress: …` pour l’UI (option UI
    # printProgress reste disponible pour d’autres usages futurs).
    command.extend(["--print_progress", "True"])
    # Lignes « Transcript: [t0 --> t1] … » sur stdout (asr.py) — nécessaire pour la retranscription en direct dans l’UI.
    command.extend(["--verbose", "True"])

    visible_parts: list[str] = []
    hide_next = False
    for part in command:
        if hide_next:
            visible_parts.append("***")
            hide_next = False
            continue
        visible_parts.append(part)
        if part == "--hf_token":
            hide_next = True
    visible_command = " ".join(visible_parts)
    emit_log("info", "wx_prep", f"Commande: {visible_command}", 15)
    emit_log("info", "wx_prep", "Lancement du sous-processus WhisperX…", 30)

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=command_env,
    )

    if process.stdout is None:
        raise RuntimeError("whisperx subprocess stdout is unavailable")
    whisperx_tail: deque[str] = deque(maxlen=48)
    wx_progress = WhisperxProgressMapper()
    last_wx_stage = "wx_transcribe"
    for line in process.stdout:
        clean = line.strip()
        if not clean:
            continue
        whisperx_tail.append(clean)

        live_seg = parse_live_transcript_line(clean)
        if live_seg is not None:
            start_f, end_f, text = live_seg
            payload = json.dumps(
                {"start": start_f, "end": end_f, "text": text},
                ensure_ascii=False,
            )
            emit_log("info", "wx_live_transcript", payload)
            last_wx_stage = "wx_transcribe"
            continue

        inferred = infer_whisperx_stdout_stage(clean)
        if inferred is not None:
            last_wx_stage = inferred
        wx_pct = parse_whisperx_progress_line(clean)
        if wx_pct is not None:
            job_pct = wx_progress.feed(wx_pct, last_wx_stage)
            if job_pct is not None:
                emit_log("info", last_wx_stage, clean, job_pct)
                continue
        emit_log("info", last_wx_stage, clean)

    return_code = process.wait()
    if return_code != 0:
        # Résumé en dernière ligne : le message d’erreur job (stderr) est souvent tronqué
        # en « fin de chaîne » côté UI — ainsi le code de sortie reste visible.
        summary = f"[Échec] Sous-processus whisperx terminé avec le code {return_code}."
        if whisperx_tail:
            body = "\n".join(whisperx_tail)
            raise RuntimeError(f"{body}\n\n{summary}")
        raise RuntimeError(summary)

    emit_log("info", "wx_finalize", "WhisperX terminé — collecte des fichiers de sortie…", 96)
    return [str(path) for path in sorted(out_dir.rglob("*")) if path.is_file()]


def run_analyze_only(input_path: str, out_dir: Path, options: dict[str, object]) -> list[str]:
    # Subcommand `analyze` + --analyze_only_from uniquement : pas de faux « fichier audio » positionnel.
    command = [
        sys.executable,
        "-m",
        "whisperx",
        "analyze",
        "--output_dir",
        str(out_dir),
        "--output_format",
        "json",
        "--analyze_only_from",
        input_path,
    ]
    append_analysis_options(command, options)

    emit_log("info", "wx_prep", f"Analyse-only — source : {input_path}", 10)
    emit_log("info", "wx_prep", f"Commande : {' '.join(command)}", 15)
    emit_log("info", "wx_analyze", "Recalcul des métriques analytiques (analyze-only)…", 40)

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    if process.stdout is None:
        raise RuntimeError("analyze_only subprocess stdout is unavailable")
    for line in process.stdout:
        clean = line.strip()
        if clean:
            emit_log("info", "wx_analyze", clean)

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"analyze-only command failed with exit code {return_code}")

    emit_log("info", "wx_finalize", "Analyse-only terminée — collecte des fichiers…", 96)
    return [str(path) for path in sorted(out_dir.rglob("*")) if path.is_file()]


def main() -> int:
    args = parse_args()
    out_dir = ensure_output_dir(args.output_dir)
    options: dict[str, object] = {}
    if args.options_json:
        try:
            options = json.loads(args.options_json)
        except json.JSONDecodeError as exc:
            print(f"Invalid --options-json payload: {exc}", file=sys.stderr, flush=True)
            return 1

    try:
        if args.mode == "mock":
            outputs = run_mock(args.job_id, args.input_path, out_dir)
            message = "Mock pipeline completed"
        elif args.mode == "analyze_only":
            outputs = run_analyze_only(args.input_path, out_dir, options)
            message = "Analyze-only pipeline completed"
        else:
            outputs = run_whisperx(args.input_path, out_dir, options)
            message = "WhisperX pipeline completed"
        emit_result(message, outputs)
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
