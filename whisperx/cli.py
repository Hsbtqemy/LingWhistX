"""
CLI orchestrator: subcommands, optional YAML/TOML config, immutable run directories.

Legacy invocations without an explicit subcommand are normalized to `whisperx run ...`.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from whisperx.log_utils import setup_logging
from whisperx.utils import (
    LANGUAGES,
    TO_LANGUAGE_CODE,
    optional_float,
    optional_int,
    str2bool,
)

SUBCOMMANDS = frozenset(
    {"run", "transcribe", "align", "diarize", "analyze", "export", "import_annotation", "help"}
)


def normalize_legacy_argv(argv: list[str]) -> list[str]:
    """Prepend `run` when the user omits the subcommand (e.g. `whisperx file.wav`)."""
    if len(argv) <= 1:
        return argv
    first = argv[1]
    if first in SUBCOMMANDS:
        return argv
    if first in ("-h", "--help", "--version", "-V", "-P", "--python-version"):
        return argv
    return [argv[0], "run"] + argv[1:]


def extract_config_path(argv: list[str]) -> str | None:
    if "--config" not in argv:
        return None
    i = argv.index("--config")
    if i + 1 >= len(argv):
        return None
    return argv[i + 1]


def load_config_file(path: str) -> dict[str, Any]:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"Config file not found: {path}")
    suffix = p.suffix.lower()
    if suffix in (".yaml", ".yml"):
        try:
            import yaml
        except ImportError as exc:
            raise ImportError(
                "PyYAML is required for YAML config files. Install with: pip install pyyaml"
            ) from exc
        with open(p, encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
    elif suffix == ".toml":
        if sys.version_info >= (3, 11):
            import tomllib
        else:
            import tomli as tomllib

        with open(p, "rb") as handle:
            data = tomllib.load(handle)
    else:
        raise ValueError(f"Unsupported config format (use .yaml, .yml, or .toml): {suffix}")
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError("Config root must be a mapping")
    return data


def flatten_config_for_defaults(cfg: dict[str, Any]) -> dict[str, Any]:
    """Merge optional `whisperx:` section and top-level keys into argparse defaults."""
    out: dict[str, Any] = {}
    nested = cfg.get("whisperx")
    if isinstance(nested, dict):
        out.update(nested)
    for key, value in cfg.items():
        if key == "whisperx":
            continue
        if key == "audio" or value is None:
            continue
        out[key] = value
    return out


def allocate_run_directory(runs_root: str) -> tuple[Path, str]:
    """Create runs/<UTC timestamp>_<short id>/ and return (path, run_id)."""
    root = Path(runs_root).resolve()
    runs = root / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    short = uuid.uuid4().hex[:8]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"{stamp}_{short}"
    run_dir = runs / run_id
    run_dir.mkdir(parents=False, exist_ok=False)
    return run_dir, run_id


def write_run_manifest(
    run_dir: Path,
    run_id: str,
    argv: list[str],
    config_path: str | None,
    merged_args: dict[str, Any],
) -> Path:
    """Write manifest.json (read-only intent: do not edit outputs in place for a new run)."""
    try:
        wx_ver = importlib.metadata.version("whisperx")
    except importlib.metadata.PackageNotFoundError:
        wx_ver = "unknown"
    manifest = {
        "schemaVersion": 1,
        "runId": run_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "argv": argv,
        "configPath": os.path.abspath(config_path) if config_path else None,
        "whisperxVersion": wx_ver,
        "pythonVersion": platform.python_version(),
        "mergedArgs": merged_args,
    }
    path = run_dir / "manifest.json"
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    return path


_OUTPUT_FORMAT_TOKENS = frozenset({"all", "json", "srt", "vtt", "txt", "tsv", "aud"})


def parse_output_format_arg(value: str) -> str:
    """Accepte `all`, un format seul, ou une liste séparée par des virgules (ex. `json,srt,vtt`)."""
    v = value.strip().lower()
    if "," in v:
        parts = [p.strip() for p in v.split(",") if p.strip()]
        if not parts:
            raise argparse.ArgumentTypeError("output_format: liste vide")
        for p in parts:
            pl = p.lower()
            if pl not in _OUTPUT_FORMAT_TOKENS:
                raise argparse.ArgumentTypeError(
                    f"output_format: format inconnu {pl!r} (attendu un de {_OUTPUT_FORMAT_TOKENS})"
                )
        return ",".join(p.lower() for p in parts)
    if v not in _OUTPUT_FORMAT_TOKENS:
        raise argparse.ArgumentTypeError(
            f"output_format: valeur inconnue {v!r} (attendu all, un format seul, ou liste comma-separated)"
        )
    return v


def register_core_arguments(parser: argparse.ArgumentParser) -> None:
    """Arguments shared by run/transcribe/align/diarize/analyze subcommands."""
    import torch

    # fmt: off
    parser.add_argument(
        "audio",
        nargs="*",
        default=[],
        type=str,
        help="audio file(s) to transcribe (omit when using --analyze_only_from)",
    )
    parser.add_argument("--model", default="small", help="name of the Whisper model to use")
    parser.add_argument("--model_cache_only", type=str2bool, default=False, help="If True, will not attempt to download models, instead using cached models from --model_dir")
    parser.add_argument("--model_dir", type=str, default=None, help="the path to save model files; uses ~/.cache/whisper by default")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu", help="device type to use for PyTorch inference (e.g. cpu, cuda)")
    parser.add_argument("--device_index", default=0, type=int, help="device index to use for FasterWhisper inference")
    parser.add_argument("--batch_size", default=8, type=int, help="the preferred batch size for inference")
    parser.add_argument("--compute_type", default="default", type=str, choices=["default", "float16", "float32", "int8"], help="compute type for computation; 'default' uses float16 on GPU, float32 on CPU")

    parser.add_argument("--output_dir", "-o", type=str, default=".", help="directory to save the outputs")
    parser.add_argument(
        "--output_format",
        "-f",
        type=parse_output_format_arg,
        default="all",
        help="all, one format, or comma-separated (e.g. json,srt,vtt); if not specified, all available formats will be produced",
    )
    parser.add_argument("--verbose", type=str2bool, default=True, help="whether to print out the progress and debug messages")
    parser.add_argument("--log-level", type=str, default=None, choices=["debug", "info", "warning", "error", "critical"], help="logging level (overrides --verbose if set)")

    parser.add_argument("--task", type=str, default="transcribe", choices=["transcribe", "translate"], help="whether to perform X->X speech recognition ('transcribe') or X->English translation ('translate')")
    parser.add_argument("--language", type=str, default=None, choices=sorted(LANGUAGES.keys()) + sorted([k.title() for k in TO_LANGUAGE_CODE.keys()]), help="language spoken in the audio, specify None to perform language detection")

    parser.add_argument("--align_model", default=None, help="Name of phoneme-level ASR model to do alignment")
    parser.add_argument("--interpolate_method", default="nearest", choices=["nearest", "linear", "ignore"], help="For word .srt, method to assign timestamps to non-aligned words, or merge them into neighbouring.")
    parser.add_argument("--no_align", action="store_true", help="Do not perform phoneme alignment")
    parser.add_argument("--return_char_alignments", action="store_true", help="Return character-level alignments in the output json file")

    parser.add_argument("--vad_method", type=str, default="pyannote", choices=["pyannote", "silero"], help="VAD method to be used")
    parser.add_argument("--vad_onset", type=float, default=0.500, help="Onset threshold for VAD (see pyannote.audio), reduce this if speech is not being detected")
    parser.add_argument("--vad_offset", type=float, default=0.363, help="Offset threshold for VAD (see pyannote.audio), reduce this if speech is not being detected.")
    parser.add_argument("--chunk_size", type=int, default=30, help="Chunk size for merging VAD segments. Default is 30, reduce this if the chunk is too long.")
    parser.add_argument("--pipeline_chunk_seconds", type=optional_float, default=None, help="optional media-level chunk duration in seconds for long files; merges chunk transcripts with global offsets")
    parser.add_argument("--pipeline_chunk_overlap_seconds", type=float, default=0.0, help="optional overlap in seconds between media-level chunks (used only with --pipeline_chunk_seconds)")

    parser.add_argument("--diarize", action="store_true", help="Apply diarization to assign speaker labels to each segment/word")
    parser.add_argument("--min_speakers", default=None, type=int, help="Minimum number of speakers to in audio file")
    parser.add_argument("--max_speakers", default=None, type=int, help="Maximum number of speakers to in audio file")
    parser.add_argument("--force_n_speakers", default=None, type=optional_int, help="Force an exact number of speakers (exclusive with --min_speakers/--max_speakers)")
    parser.add_argument("--diarize_model", default="pyannote/speaker-diarization-community-1", type=str, help="Name of the speaker diarization model to use")
    parser.add_argument("--speaker_embeddings", action="store_true", help="Include speaker embeddings in JSON output (only works with --diarize)")

    parser.add_argument("--temperature", type=float, default=0, help="temperature to use for sampling")
    parser.add_argument("--best_of", type=optional_int, default=5, help="number of candidates when sampling with non-zero temperature")
    parser.add_argument("--beam_size", type=optional_int, default=5, help="number of beams in beam search, only applicable when temperature is zero")
    parser.add_argument("--patience", type=float, default=1.0, help="optional patience value to use in beam decoding, as in https://arxiv.org/abs/2204.05424, the default (1.0) is equivalent to conventional beam search")
    parser.add_argument("--length_penalty", type=float, default=1.0, help="optional token length penalty coefficient (alpha) as in https://arxiv.org/abs/1609.08144, uses simple length normalization by default")

    parser.add_argument("--suppress_tokens", type=str, default="-1", help="comma-separated list of token ids to suppress during sampling; '-1' will suppress most special characters except common punctuations")
    parser.add_argument("--suppress_numerals", action="store_true", help="whether to suppress numeric symbols and currency symbols during sampling, since wav2vec2 cannot align them correctly")

    parser.add_argument("--initial_prompt", type=str, default=None, help="optional text to provide as a prompt for the first window.")
    parser.add_argument("--hotwords", type=str, default=None, help="hotwords/hint phrases to the model (e.g. \"WhisperX, PyAnnote, GPU\"); improves recognition of rare/technical terms")
    parser.add_argument("--condition_on_previous_text", type=str2bool, default=False, help="if True, provide the previous output of the model as a prompt for the next window; disabling may make the text inconsistent across windows, but the model becomes less prone to getting stuck in a failure loop")
    parser.add_argument("--fp16", type=str2bool, default=True, help="when --compute_type=default on CUDA, prefer float16 if True, float32 if False")

    parser.add_argument("--temperature_increment_on_fallback", type=optional_float, default=0.2, help="temperature to increase when falling back when the decoding fails to meet either of the thresholds below")
    parser.add_argument("--compression_ratio_threshold", type=optional_float, default=2.4, help="if the gzip compression ratio is higher than this value, treat the decoding as failed")
    parser.add_argument("--logprob_threshold", type=optional_float, default=-1.0, help="if the average log probability is lower than this value, treat the decoding as failed")
    parser.add_argument("--no_speech_threshold", type=optional_float, default=0.6, help="if the probability of the <|nospeech|> token is higher than this value AND the decoding has failed due to `logprob_threshold`, consider the segment as silence")

    parser.add_argument("--max_line_width", type=optional_int, default=None, help="(not possible with --no_align) the maximum number of characters in a line before breaking the line")
    parser.add_argument("--max_line_count", type=optional_int, default=None, help="(not possible with --no_align) the maximum number of lines in a segment")
    parser.add_argument("--highlight_words", type=str2bool, default=False, help="(not possible with --no_align) underline each word as it is spoken in srt and vtt")
    parser.add_argument("--segment_resolution", type=str, default="sentence", choices=["sentence", "chunk"], help="(not possible with --no_align) subtitle segmentation strategy for aligned outputs")

    parser.add_argument("--threads", type=optional_int, default=0, help="number of threads used by torch for CPU inference; supercedes MKL_NUM_THREADS/OMP_NUM_THREADS")

    parser.add_argument("--hf_token", type=str, default=None, help="Hugging Face Access Token to access PyAnnote gated models")

    parser.add_argument("--print_progress", type=str2bool, default=False, help="if True, progress will be printed in transcribe() and align() methods.")
    parser.add_argument("--analysis_pause_min", type=float, default=0.15, help="minimum lexicalized pause duration in seconds (word-to-word intra-speaker gaps)")
    parser.add_argument("--analysis_pause_ignore_below", type=float, default=0.10, help="ignore lexicalized gaps below this duration to reduce timestamp jitter")
    parser.add_argument("--analysis_pause_max", type=optional_float, default=None, help="optional maximum lexicalized pause duration; longer gaps are excluded from pause analysis")
    parser.add_argument("--analysis_include_nonspeech", type=str2bool, default=True, help="include acoustic non-speech intervals derived from VAD speech gaps in timeline analysis")
    parser.add_argument("--analysis_nonspeech_min_duration", type=float, default=0.15, help="minimum duration in seconds for non-speech acoustic intervals")
    parser.add_argument("--analysis_ipu_min_words", type=int, default=1, help="minimum number of words required for an IPU")
    parser.add_argument("--analysis_ipu_min_duration", type=float, default=0.0, help="minimum IPU duration in seconds")
    parser.add_argument("--analysis_ipu_bridge_short_gaps_under", type=float, default=0.0, help="merge adjacent IPU candidates when the inter-word gap is below this threshold")
    parser.add_argument(
        "--analysis_preset",
        type=str,
        default=None,
        choices=["sport_tv", "interview"],
        help="named pause thresholds (sport_tv / interview); timeline uses these pause_min / pause_ignore_below",
    )
    parser.add_argument(
        "--analysis_calibrate_window_sec",
        type=optional_float,
        default=None,
        help="if set, calibrate pause_min and pause_ignore_below from gaps in [calibrate_start, calibrate_start+window]",
    )
    parser.add_argument(
        "--analysis_calibrate_start_sec",
        type=float,
        default=0.0,
        help="start of calibration window in seconds (default 0)",
    )
    parser.add_argument(
        "--analysis_speaker_turn_postprocess_preset",
        type=str,
        default=None,
        help="speaker_turn merge/split preset: sport_duo (merge short gaps, split long word silences)",
    )
    parser.add_argument(
        "--analysis_speaker_turn_merge_gap_sec_max",
        type=optional_float,
        default=None,
        help="merge consecutive same-speaker turns if gap in [0, value) seconds (overrides preset)",
    )
    parser.add_argument(
        "--analysis_speaker_turn_split_word_gap_sec",
        type=optional_float,
        default=None,
        help="split a turn if gap between same-speaker words exceeds this (seconds; overrides preset)",
    )
    parser.add_argument(
        "--analysis_word_timestamp_stabilize_mode",
        type=str,
        default="off",
        help="off (default) | detect (flags only) | smooth (detect + light boundary adjust); see WX-606",
    )
    parser.add_argument(
        "--analysis_word_ts_neighbor_ratio_low",
        type=optional_float,
        default=None,
        help="aberrant if word duration < ref * this (detect/smooth; default 0.25)",
    )
    parser.add_argument(
        "--analysis_word_ts_neighbor_ratio_high",
        type=optional_float,
        default=None,
        help="aberrant if word duration > ref * this (default 4.0)",
    )
    parser.add_argument(
        "--analysis_word_ts_smooth_max_sec",
        type=optional_float,
        default=None,
        help="max total duration change per word in smooth mode (default 0.02)",
    )
    parser.add_argument("--export_data_science", type=str2bool, default=True, help="when True, export run.json + timeline.json + words/pauses/ipu CSV artifacts")
    parser.add_argument(
        "--export_annotation_rttm",
        type=str2bool,
        default=False,
        help="when True, write <stem>.rttm from speaker_turns (NIST-style SPEAKER lines)",
    )
    parser.add_argument(
        "--export_annotation_textgrid",
        type=str2bool,
        default=False,
        help="when True, write <stem>.TextGrid (Praat) from speaker_turns",
    )
    parser.add_argument(
        "--export_annotation_eaf",
        type=str2bool,
        default=False,
        help="when True, write <stem>.eaf (ELAN 3.0) from speaker_turns",
    )
    parser.add_argument(
        "--export_word_ctm",
        type=str2bool,
        default=True,
        help="when True (with data-science exports), write <stem>.words.ctm (NIST-style word timings; WX-608)",
    )
    parser.add_argument(
        "--export_parquet_dataset",
        type=str2bool,
        default=False,
        help="when True (with data-science exports), write dataset/README.md and optional Parquet tables under dataset/ (needs pandas+pyarrow)",
    )
    parser.add_argument("--analyze_only_from", type=str, default=None, help="path to an existing transcript/timeline JSON to recompute analysis metrics without rerunning ASR")
    parser.add_argument(
        "--chunk_state_dir",
        type=str,
        default=None,
        help="base directory for chunk_manifest.json, raw chunk JSON, and optional per-chunk JSONL (requires --pipeline_chunk_seconds)",
    )
    parser.add_argument(
        "--chunk_resume",
        type=str2bool,
        default=False,
        help="reuse chunks already marked done in chunk_manifest.json (requires --chunk_state_dir)",
    )
    parser.add_argument(
        "--chunk_jsonl_per_chunk",
        type=str2bool,
        default=False,
        help="after each media chunk, write one JSON line per word to <stem>.chunk_NNNN.jsonl under chunk state dir",
    )
    parser.add_argument(
        "--external_word_timings_json",
        type=str,
        default=None,
        help="optional v1 JSON with per-word start/end from an external aligner (e.g. MFA offline); requires one audio file and alignment (see README)",
    )
    parser.add_argument(
        "--external_word_timings_strict",
        type=str2bool,
        default=False,
        help="if True, require token text to match between transcript and external JSON (same order)",
    )
    # fmt: on


def register_export_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--verbose",
        type=str2bool,
        default=True,
        help="Verbose logging for export",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default=None,
        choices=["debug", "info", "warning", "error", "critical"],
        help="Logging level (overrides --verbose if set)",
    )
    parser.add_argument(
        "--from-json",
        dest="export_from_json",
        required=True,
        help="Existing WhisperX JSON transcript to re-export",
    )
    parser.add_argument(
        "-o",
        "--output_dir",
        required=True,
        help="Directory for exported files",
    )
    parser.add_argument(
        "-f",
        "--output_format",
        type=parse_output_format_arg,
        default="json",
        help="Output format (all, one format, or comma-separated e.g. json,srt)",
    )
    parser.add_argument(
        "--export_data_science",
        type=str2bool,
        default=True,
        help="Also write run.json + timeline + CSV data-science artifacts",
    )
    parser.add_argument(
        "--export_annotation_rttm",
        type=str2bool,
        default=False,
        help="Also write .rttm from speaker_turns",
    )
    parser.add_argument(
        "--export_annotation_textgrid",
        type=str2bool,
        default=False,
        help="Also write .TextGrid from speaker_turns",
    )
    parser.add_argument(
        "--export_annotation_eaf",
        type=str2bool,
        default=False,
        help="Also write .eaf from speaker_turns",
    )
    parser.add_argument(
        "--export_word_ctm",
        type=str2bool,
        default=True,
        help="Also write .words.ctm (NIST-style word timings)",
    )
    parser.add_argument(
        "--export_parquet_dataset",
        type=str2bool,
        default=False,
        help="Also write dataset/README.md and Parquet under dataset/ (pandas+pyarrow)",
    )


def build_parser() -> argparse.ArgumentParser:
    core = argparse.ArgumentParser(add_help=False)
    register_core_arguments(core)

    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        description="WhisperX CLI. Subcommands: run (default), transcribe, align, diarize, analyze, export.",
    )
    parser.add_argument(
        "-V",
        "--version",
        action="version",
        version=f"%(prog)s {importlib.metadata.version('whisperx')}",
        help="Show whisperx version and exit",
    )
    parser.add_argument(
        "-P",
        "--python-version",
        action="version",
        version=f"Python {platform.python_version()} ({platform.python_implementation()})",
        help="Show python version and exit",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        metavar="FILE",
        help="YAML or TOML file merged into defaults (CLI flags override)",
    )
    parser.add_argument(
        "--immutable-run",
        action="store_true",
        help="Write outputs under <runs-root>/runs/<timestamp>_<id>/ and write manifest.json",
    )
    parser.add_argument(
        "--runs-root",
        type=str,
        default=".",
        metavar="DIR",
        help="Base directory for runs/ when using --immutable-run",
    )

    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser(
        "run",
        parents=[core],
        help="Full ASR + alignment (+ optional diarization) pipeline",
    )
    sub.add_parser(
        "transcribe",
        parents=[core],
        help="Alias of run (same pipeline)",
    )
    sub.add_parser(
        "align",
        parents=[core],
        help="Same as run (alignment runs unless --no_align)",
    )
    dia = sub.add_parser(
        "diarize",
        parents=[core],
        help="Same as run with speaker diarization enabled by default",
    )
    dia.set_defaults(diarize=True)
    sub.add_parser(
        "analyze",
        parents=[core],
        help="Typically used with --analyze_only_from for metrics-only recompute",
    )
    exp = sub.add_parser(
        "export",
        parents=[argparse.ArgumentParser(add_help=False)],
        help="Re-export formats from an existing JSON without running ASR",
    )
    register_export_arguments(exp)

    # WX-675 — Import EAF/TextGrid annotation file, print JSON to stdout
    imp = sub.add_parser(
        "import_annotation",
        parents=[argparse.ArgumentParser(add_help=False)],
        help="Parse an EAF or TextGrid file and print ImportedAnnotation JSON to stdout",
    )
    imp.add_argument("path", help="Path to the .eaf or .TextGrid file to import")

    return parser


def _args_to_serializable(ns: argparse.Namespace) -> dict[str, Any]:
    d = vars(ns).copy()
    for k in list(d.keys()):
        v = d[k]
        if callable(v) or v is sys.stdin:
            d.pop(k, None)
        try:
            json.dumps(v)
        except (TypeError, ValueError):
            d[k] = repr(v)
    return d


def main(argv: list[str] | None = None) -> None:
    argv = normalize_legacy_argv(list(argv if argv is not None else sys.argv))
    config_path = extract_config_path(argv)

    parser = build_parser()
    if config_path:
        cfg = flatten_config_for_defaults(load_config_file(config_path))
        parser.set_defaults(**cfg)

    args = parser.parse_args(argv[1:])

    if args.command == "import_annotation":
        # WX-675 — Parse EAF/TextGrid, print JSON result to stdout (consumed by Rust IPC).
        setup_logging(level="warning")
        from whisperx.annotation_imports import parse_eaf, parse_textgrid

        ann_path = args.path.strip()
        ext = os.path.splitext(ann_path)[1].lower()
        try:
            if ext == ".eaf":
                result = parse_eaf(ann_path)
            elif ext == ".textgrid":
                result = parse_textgrid(ann_path)
            else:
                # Heuristic: try EAF first (XML), fallback TextGrid
                try:
                    result = parse_eaf(ann_path)
                except ValueError:
                    result = parse_textgrid(ann_path)
        except Exception as exc:  # noqa: BLE001
            json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
            sys.stdout.flush()
            sys.exit(1)
        json.dump(result.to_dict(), sys.stdout, ensure_ascii=False)
        sys.stdout.flush()
        return

    if args.command == "export":
        log_level = args.log_level
        verbose = args.verbose
        if log_level is not None:
            setup_logging(level=log_level)
        elif verbose:
            setup_logging(level="info")
        else:
            setup_logging(level="warning")
        from whisperx.transcribe import export_only_task

        export_only_task(vars(args), parser)
        return

    if args.immutable_run:
        run_dir, run_id = allocate_run_directory(args.runs_root)
        args.output_dir = str(run_dir)
        merged_preview = _args_to_serializable(args)
        write_run_manifest(run_dir, run_id, argv, config_path, merged_preview)

    log_level = args.log_level
    verbose = args.verbose

    if log_level is not None:
        setup_logging(level=log_level)
    elif verbose:
        setup_logging(level="info")
    else:
        setup_logging(level="warning")

    from whisperx.transcribe import transcribe_task

    arg_dict = vars(args).copy()
    for key in ("command", "config", "immutable_run", "runs_root", "export_from_json"):
        arg_dict.pop(key, None)

    transcribe_task(arg_dict, parser)


if __name__ == "__main__":
    main()
