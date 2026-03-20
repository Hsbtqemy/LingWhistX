#!/usr/bin/env python3
"""
Local worker entrypoint used by Tauri.

Modes:
- mock: no ASR execution, writes deterministic sample artifacts.
- whisperx: invokes local whisperx CLI and writes resulting files.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

LOG_PREFIX = "__WXLOG__"
RESULT_PREFIX = "__WXRESULT__"
SUPPORTED_OUTPUT_FORMATS = {"all", "json", "srt", "vtt", "txt", "tsv", "aud"}


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


def run_whisperx(input_path: str, out_dir: Path, options: dict[str, object]) -> list[str]:
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

    compute_type = options.get("computeType")
    if isinstance(compute_type, str) and compute_type.strip():
        command.extend(["--compute_type", compute_type.strip()])

    batch_size = options.get("batchSize")
    if isinstance(batch_size, int) and batch_size > 0:
        command.extend(["--batch_size", str(batch_size)])

    vad_method = options.get("vadMethod")
    if isinstance(vad_method, str) and vad_method.strip():
        command.extend(["--vad_method", vad_method.strip()])

    pipeline_chunk_seconds = options.get("pipelineChunkSeconds")
    if isinstance(pipeline_chunk_seconds, (int, float)) and float(pipeline_chunk_seconds) > 0:
        command.extend(["--pipeline_chunk_seconds", f"{float(pipeline_chunk_seconds):g}"])

    pipeline_chunk_overlap_seconds = options.get("pipelineChunkOverlapSeconds")
    if isinstance(pipeline_chunk_overlap_seconds, (int, float)) and float(pipeline_chunk_overlap_seconds) >= 0:
        command.extend(
            [
                "--pipeline_chunk_overlap_seconds",
                f"{float(pipeline_chunk_overlap_seconds):g}",
            ]
        )
    append_analysis_options(command, options)

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

    if options.get("printProgress") is True:
        command.extend(["--print_progress", "True"])

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
    emit_log("info", "whisperx", f"Commande: {visible_command}", 15)
    emit_log("info", "whisperx", "Execution whisperx...", 30)

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=command_env,
    )

    assert process.stdout is not None
    for line in process.stdout:
        clean = line.strip()
        if clean:
            emit_log("info", "whisperx", clean)

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"whisperx command failed with exit code {return_code}")

    emit_log("info", "whisperx", "WhisperX termine, collecte des fichiers...", 96)
    return [str(path) for path in sorted(out_dir.glob("*")) if path.is_file()]


def run_analyze_only(input_path: str, out_dir: Path, options: dict[str, object]) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "whisperx",
        input_path,
        "--output_dir",
        str(out_dir),
        "--output_format",
        "json",
        "--analyze_only_from",
        input_path,
    ]
    append_analysis_options(command, options)

    emit_log("info", "analyze_only", f"Analyse-only source: {input_path}", 10)
    emit_log("info", "analyze_only", f"Commande: {' '.join(command)}", 15)
    emit_log("info", "analyze_only", "Recalcul des metriques analytiques...", 40)

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert process.stdout is not None
    for line in process.stdout:
        clean = line.strip()
        if clean:
            emit_log("info", "analyze_only", clean)

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"analyze-only command failed with exit code {return_code}")

    emit_log("info", "analyze_only", "Analyse-only termine, collecte des fichiers...", 96)
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
