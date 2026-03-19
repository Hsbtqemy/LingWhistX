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
import subprocess
import sys
import time
from pathlib import Path

LOG_PREFIX = "__WXLOG__"
RESULT_PREFIX = "__WXRESULT__"


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
        choices=["mock", "whisperx"],
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


def run_whisperx(input_path: str, out_dir: Path, options: dict[str, object]) -> list[str]:
    output_format = str(options.get("outputFormat", "all"))
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

    if options.get("diarize") is True:
        command.append("--diarize")
        hf_token = options.get("hfToken")
        if isinstance(hf_token, str) and hf_token.strip():
            command.extend(["--hf_token", hf_token.strip()])

    if options.get("noAlign") is True:
        command.append("--no_align")

    if options.get("printProgress") is True:
        command.extend(["--print_progress", "True"])

    visible_command = " ".join(part for part in command if not part.startswith("hf_"))
    emit_log("info", "whisperx", f"Commande: {visible_command}", 15)
    emit_log("info", "whisperx", "Execution whisperx...", 30)

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
            emit_log("info", "whisperx", clean)

    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"whisperx command failed with exit code {return_code}")

    emit_log("info", "whisperx", "WhisperX termine, collecte des fichiers...", 96)
    return [str(path) for path in sorted(out_dir.glob("*")) if path.is_file()]


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
