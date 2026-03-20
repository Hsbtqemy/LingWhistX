import argparse
import gc
import importlib.metadata
import json
import os
import platform
import warnings
from datetime import datetime, timezone
from typing import Any

import numpy as np
import torch

from whisperx.alignment import align, load_align_model
from whisperx.asr import load_model
from whisperx.audio import load_audio, probe_audio_duration
from whisperx.diarize import DiarizationPipeline, assign_word_speakers
from whisperx.schema import AlignedTranscriptionResult, TranscriptionResult
from whisperx.timeline import build_canonical_timeline
from whisperx.utils import LANGUAGES, TO_LANGUAGE_CODE, get_writer, write_data_science_exports
from whisperx.log_utils import get_logger

logger = get_logger(__name__)


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(numeric):
        return default
    return numeric


def _offset_and_filter_chunk_segments(
    chunk_result: dict[str, Any],
    chunk_start_sec: float,
    selection_end_sec: float | None,
) -> list[dict[str, Any]]:
    merged_segments: list[dict[str, Any]] = []
    for segment in chunk_result.get("segments", []):
        if not isinstance(segment, dict):
            continue
        next_segment = dict(segment)
        start = _as_float(next_segment.get("start"), 0.0) + chunk_start_sec
        end = _as_float(next_segment.get("end"), start) + chunk_start_sec
        if end < start:
            start, end = end, start
        midpoint = (start + end) / 2.0
        if selection_end_sec is not None and midpoint > selection_end_sec + 1e-6:
            continue
        next_segment["start"] = round(start, 3)
        next_segment["end"] = round(end, 3)
        merged_segments.append(next_segment)
    return merged_segments


def _transcribe_with_media_chunking(
    model: Any,
    audio_path: str,
    batch_size: int,
    chunk_size: int,
    print_progress: bool,
    verbose: bool,
    pipeline_chunk_seconds: float | None,
    pipeline_chunk_overlap_seconds: float,
) -> TranscriptionResult:
    def _single_pass(mode: str, duration_sec: float | None = None) -> TranscriptionResult:
        audio = load_audio(audio_path)
        result = model.transcribe(
            audio,
            batch_size=batch_size,
            chunk_size=chunk_size,
            print_progress=print_progress,
            verbose=verbose,
        )
        result["pipeline_chunking"] = {
            "enabled": False,
            "mode": mode,
            "chunk_seconds": pipeline_chunk_seconds,
            "overlap_seconds": pipeline_chunk_overlap_seconds,
            "source_duration": round(duration_sec, 3) if duration_sec is not None else None,
            "windows": [
                {
                    "index": 1,
                    "start": 0.0,
                    "duration": round(duration_sec, 3) if duration_sec is not None else None,
                    "selection_end": None,
                    "emitted_segments": len(result.get("segments", [])),
                }
            ],
        }
        return result

    if pipeline_chunk_seconds is None:
        return _single_pass(mode="single_pass")

    duration_sec = probe_audio_duration(audio_path)
    if duration_sec is None:
        logger.warning(
            "Unable to probe media duration for '%s'; falling back to single-pass transcription.",
            audio_path,
        )
        return _single_pass(mode="single_pass_unprobed")

    if duration_sec <= pipeline_chunk_seconds + 1e-6:
        return _single_pass(mode="single_pass_short_media", duration_sec=duration_sec)

    step_sec = pipeline_chunk_seconds - pipeline_chunk_overlap_seconds
    if step_sec <= 0:
        raise ValueError("pipeline chunk step must be > 0 seconds")

    logger.info(
        "Using media chunking: duration=%.2fs chunk=%.2fs overlap=%.2fs step=%.2fs",
        duration_sec,
        pipeline_chunk_seconds,
        pipeline_chunk_overlap_seconds,
        step_sec,
    )

    merged_segments: list[dict[str, Any]] = []
    chunk_windows: list[dict[str, Any]] = []
    detected_language: str | None = None
    chunk_index = 0
    chunk_start = 0.0

    while chunk_start < duration_sec - 1e-6:
        remaining = duration_sec - chunk_start
        chunk_duration = min(pipeline_chunk_seconds, remaining)
        chunk_audio = load_audio(
            audio_path,
            start_time=chunk_start,
            duration=chunk_duration,
        )
        if chunk_audio.size == 0:
            break

        chunk_result = model.transcribe(
            chunk_audio,
            batch_size=batch_size,
            chunk_size=chunk_size,
            print_progress=print_progress,
            verbose=verbose,
        )
        if detected_language is None:
            language = chunk_result.get("language")
            if isinstance(language, str) and language.strip():
                detected_language = language.strip()

        selection_end = None
        if chunk_start + step_sec < duration_sec - 1e-6:
            selection_end = chunk_start + step_sec
        chunk_segments = _offset_and_filter_chunk_segments(
            chunk_result,
            chunk_start,
            selection_end,
        )
        merged_segments.extend(chunk_segments)

        chunk_index += 1
        chunk_windows.append(
            {
                "index": chunk_index,
                "start": round(chunk_start, 3),
                "duration": round(chunk_duration, 3),
                "selection_end": round(selection_end, 3) if selection_end is not None else None,
                "emitted_segments": len(chunk_segments),
            }
        )
        logger.info(
            "Transcribed chunk #%d at offset %.2fs (window %.2fs).",
            chunk_index,
            chunk_start,
            chunk_duration,
        )
        if chunk_start + pipeline_chunk_seconds >= duration_sec - 1e-6:
            break
        chunk_start += step_sec

    merged_segments.sort(
        key=lambda segment: (
            _as_float(segment.get("start"), 0.0),
            _as_float(segment.get("end"), 0.0),
        )
    )

    return {
        "segments": merged_segments,
        "language": detected_language,
        "pipeline_chunking": {
            "enabled": True,
            "mode": "chunked",
            "chunk_seconds": round(pipeline_chunk_seconds, 3),
            "overlap_seconds": round(pipeline_chunk_overlap_seconds, 3),
            "step_seconds": round(step_sec, 3),
            "source_duration": round(duration_sec, 3),
            "windows": chunk_windows,
        },
    }


def _build_analysis_output_dir(output_dir: str) -> str:
    base_name = datetime.now(timezone.utc).strftime("analysis-%Y%m%dT%H%M%SZ")
    candidate = os.path.join(output_dir, base_name)
    if not os.path.exists(candidate):
        return candidate
    suffix = 1
    while True:
        next_candidate = os.path.join(output_dir, f"{base_name}-{suffix}")
        if not os.path.exists(next_candidate):
            return next_candidate
        suffix += 1


def _load_analysis_source(analyze_only_from: str) -> dict[str, Any]:
    with open(analyze_only_from, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Analyze-only source must be a JSON object")

    segments = payload.get("segments")
    if isinstance(segments, list):
        return dict(payload)

    timeline = payload.get("timeline", payload)
    if not isinstance(timeline, dict):
        raise ValueError("Analyze-only source must contain 'segments' or a canonical 'timeline'")

    timeline_segments = timeline.get("segments")
    normalized_segments: list[dict[str, Any]] = []
    if isinstance(timeline_segments, list):
        for raw_segment in timeline_segments:
            if not isinstance(raw_segment, dict):
                continue
            next_segment: dict[str, Any] = {
                "start": raw_segment.get("start"),
                "end": raw_segment.get("end"),
                "text": raw_segment.get("text", ""),
            }
            if raw_segment.get("speaker") is not None:
                next_segment["speaker"] = raw_segment.get("speaker")
            if raw_segment.get("confidence") is not None:
                next_segment["avg_logprob"] = raw_segment.get("confidence")
            normalized_segments.append(next_segment)

    timeline_words = timeline.get("words")
    normalized_word_segments: list[dict[str, Any]] = []
    if isinstance(timeline_words, list):
        for raw_word in timeline_words:
            if not isinstance(raw_word, dict):
                continue
            next_word: dict[str, Any] = {
                "word": raw_word.get("token", ""),
                "start": raw_word.get("start"),
                "end": raw_word.get("end"),
            }
            if raw_word.get("confidence") is not None:
                next_word["score"] = raw_word.get("confidence")
            if raw_word.get("speaker") is not None:
                next_word["speaker"] = raw_word.get("speaker")
            normalized_word_segments.append(next_word)

    result: dict[str, Any] = {
        "segments": normalized_segments,
        "word_segments": normalized_word_segments,
    }
    if "speaker_turns" in timeline:
        result["speaker_turns"] = timeline.get("speaker_turns")
    if "events" in timeline:
        result["events"] = timeline.get("events")
    language = payload.get("language")
    if language is None and isinstance(timeline, dict):
        language = timeline.get("language")
    if isinstance(language, str) and language.strip():
        result["language"] = language.strip()
    if "pipeline_chunking" in payload:
        result["pipeline_chunking"] = payload.get("pipeline_chunking")
    return result


def _run_analyze_only(
    analyze_only_from: str,
    output_dir: str,
    timeline_analysis_config: dict[str, Any],
    run_config_snapshot: dict[str, Any],
    output_format: str,
) -> None:
    if not os.path.isfile(analyze_only_from):
        raise FileNotFoundError(f"Analyze-only source does not exist: {analyze_only_from}")

    source_result = _load_analysis_source(analyze_only_from)
    analysis_output_dir = _build_analysis_output_dir(output_dir)
    os.makedirs(analysis_output_dir, exist_ok=True)

    source_name = os.path.basename(analyze_only_from)
    if source_name.endswith(".timeline.json"):
        source_stem = source_name[: -len(".timeline.json")]
    else:
        source_stem = os.path.splitext(source_name)[0]
    pseudo_audio_path = os.path.join(analysis_output_dir, f"{source_stem}.wav")

    source_result["timeline"] = build_canonical_timeline(
        source_result,
        analysis_config=timeline_analysis_config,
    )
    if source_result.get("language") is None:
        source_result["language"] = "unknown"

    # Analyze-only always emits an updated JSON snapshot in the versioned analysis directory.
    json_writer = get_writer("json", analysis_output_dir)
    json_writer(source_result, pseudo_audio_path, {})

    try:
        whisperx_version = importlib.metadata.version("whisperx")
    except importlib.metadata.PackageNotFoundError:
        whisperx_version = "unknown"

    run_metadata = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "analyze_only",
        "input": {
            "sourceJsonPath": os.path.abspath(analyze_only_from),
            "audioPath": os.path.abspath(pseudo_audio_path),
            "audioName": os.path.basename(pseudo_audio_path),
        },
        "output": {
            "baseOutputDir": os.path.abspath(output_dir),
            "analysisOutputDir": os.path.abspath(analysis_output_dir),
            "outputFormat": output_format,
        },
        "versions": {
            "whisperx": whisperx_version,
            "python": platform.python_version(),
            "torch": getattr(torch, "__version__", "unknown"),
        },
        "config": run_config_snapshot,
        "pipeline": {
            "chunking": source_result.get("pipeline_chunking"),
        },
    }
    write_data_science_exports(
        output_dir=analysis_output_dir,
        audio_path=pseudo_audio_path,
        result=source_result,
        run_metadata=run_metadata,
    )
    logger.info("Analyze-only completed. Artifacts written to: %s", analysis_output_dir)


def transcribe_task(args: dict, parser: argparse.ArgumentParser):
    """Transcription task to be called from CLI.

    Args:
        args: Dictionary of command-line arguments.
        parser: argparse.ArgumentParser object.
    """
    # fmt: off

    model_name: str = args.pop("model")
    batch_size: int = args.pop("batch_size")
    model_dir: str = args.pop("model_dir")
    model_cache_only: bool = args.pop("model_cache_only")
    output_dir: str = args.pop("output_dir")
    output_format: str = args.pop("output_format")
    device: str = args.pop("device")
    device_index: int = args.pop("device_index")
    compute_type: str = args.pop("compute_type")
    fp16: bool = args.pop("fp16")
    verbose: bool = args.pop("verbose")

    if compute_type == "default" and device.startswith("cuda"):
        compute_type = "float16" if fp16 else "float32"

    # model_flush: bool = args.pop("model_flush")
    os.makedirs(output_dir, exist_ok=True)

    align_model: str = args.pop("align_model")
    interpolate_method: str = args.pop("interpolate_method")
    no_align: bool = args.pop("no_align")
    task: str = args.pop("task")
    if task == "translate":
        # translation cannot be aligned
        no_align = True

    return_char_alignments: bool = args.pop("return_char_alignments")

    hf_token: str | None = args.pop("hf_token")
    if isinstance(hf_token, str):
        hf_token = hf_token.strip() or None
    if hf_token is None:
        hf_token = (
            os.getenv("WHISPERX_HF_TOKEN")
            or os.getenv("HF_TOKEN")
            or os.getenv("HUGGINGFACE_TOKEN")
        )
        if isinstance(hf_token, str):
            hf_token = hf_token.strip() or None
    vad_method: str = args.pop("vad_method")
    vad_onset: float = args.pop("vad_onset")
    vad_offset: float = args.pop("vad_offset")

    chunk_size: int = args.pop("chunk_size")
    pipeline_chunk_seconds: float | None = args.pop("pipeline_chunk_seconds")
    pipeline_chunk_overlap_seconds: float = args.pop("pipeline_chunk_overlap_seconds")
    if pipeline_chunk_seconds is not None and pipeline_chunk_seconds <= 0:
        parser.error("--pipeline_chunk_seconds must be > 0")
    if pipeline_chunk_overlap_seconds < 0:
        parser.error("--pipeline_chunk_overlap_seconds must be >= 0")
    if pipeline_chunk_seconds is None and pipeline_chunk_overlap_seconds > 0:
        warnings.warn("--pipeline_chunk_overlap_seconds has no effect without --pipeline_chunk_seconds")
    if (
        pipeline_chunk_seconds is not None
        and pipeline_chunk_overlap_seconds >= pipeline_chunk_seconds
    ):
        parser.error("--pipeline_chunk_overlap_seconds must be lower than --pipeline_chunk_seconds")

    diarize: bool = args.pop("diarize")
    min_speakers: int = args.pop("min_speakers")
    max_speakers: int = args.pop("max_speakers")
    force_n_speakers: int | None = args.pop("force_n_speakers")
    diarize_model_name: str = args.pop("diarize_model")
    print_progress: bool = args.pop("print_progress")
    return_speaker_embeddings: bool = args.pop("speaker_embeddings")
    analysis_pause_min: float = args.pop("analysis_pause_min")
    analysis_pause_ignore_below: float = args.pop("analysis_pause_ignore_below")
    analysis_pause_max: float | None = args.pop("analysis_pause_max")
    analysis_include_nonspeech: bool = args.pop("analysis_include_nonspeech")
    analysis_nonspeech_min_duration: float = args.pop("analysis_nonspeech_min_duration")
    analysis_ipu_min_words: int = args.pop("analysis_ipu_min_words")
    analysis_ipu_min_duration: float = args.pop("analysis_ipu_min_duration")
    analysis_ipu_bridge_short_gaps_under: float = args.pop("analysis_ipu_bridge_short_gaps_under")
    export_data_science: bool = args.pop("export_data_science")
    analyze_only_from: str | None = args.pop("analyze_only_from")
    if isinstance(analyze_only_from, str):
        analyze_only_from = analyze_only_from.strip() or None

    if return_speaker_embeddings and not diarize:
        warnings.warn("--speaker_embeddings has no effect without --diarize")
    if min_speakers is not None and min_speakers <= 0:
        parser.error("--min_speakers must be > 0")
    if max_speakers is not None and max_speakers <= 0:
        parser.error("--max_speakers must be > 0")
    if min_speakers is not None and max_speakers is not None and min_speakers > max_speakers:
        parser.error("--min_speakers must be <= --max_speakers")
    if force_n_speakers is not None and force_n_speakers <= 0:
        parser.error("--force_n_speakers must be > 0")
    if force_n_speakers is not None and (
        min_speakers is not None or max_speakers is not None
    ):
        parser.error("--force_n_speakers cannot be combined with --min_speakers/--max_speakers")
    if analysis_pause_min < 0:
        parser.error("--analysis_pause_min must be >= 0")
    if analysis_pause_ignore_below < 0:
        parser.error("--analysis_pause_ignore_below must be >= 0")
    if analysis_pause_max is not None and analysis_pause_max <= 0:
        parser.error("--analysis_pause_max must be > 0")
    if (
        analysis_pause_max is not None
        and analysis_pause_max < max(analysis_pause_min, analysis_pause_ignore_below)
    ):
        parser.error("--analysis_pause_max must be >= max(--analysis_pause_min, --analysis_pause_ignore_below)")
    if analysis_nonspeech_min_duration < 0:
        parser.error("--analysis_nonspeech_min_duration must be >= 0")
    if analysis_ipu_min_words < 1:
        parser.error("--analysis_ipu_min_words must be >= 1")
    if analysis_ipu_min_duration < 0:
        parser.error("--analysis_ipu_min_duration must be >= 0")
    if analysis_ipu_bridge_short_gaps_under < 0:
        parser.error("--analysis_ipu_bridge_short_gaps_under must be >= 0")

    timeline_analysis_config = {
        "pause_min": analysis_pause_min,
        "pause_ignore_below": analysis_pause_ignore_below,
        "pause_max": analysis_pause_max,
        "include_nonspeech": analysis_include_nonspeech,
        "nonspeech_min_duration": analysis_nonspeech_min_duration,
        "ipu_min_words": analysis_ipu_min_words,
        "ipu_min_duration": analysis_ipu_min_duration,
        "ipu_bridge_short_gaps_under": analysis_ipu_bridge_short_gaps_under,
    }
    if args["language"] is not None:
        args["language"] = args["language"].lower()
        if args["language"] not in LANGUAGES:
            if args["language"] in TO_LANGUAGE_CODE:
                args["language"] = TO_LANGUAGE_CODE[args["language"]]
            else:
                raise ValueError(f"Unsupported language: {args['language']}")

    if model_name.endswith(".en") and args["language"] != "en":
        if args["language"] is not None:
            warnings.warn(
                f"{model_name} is an English-only model but received '{args['language']}'; using English instead."
            )
        args["language"] = "en"
    align_language = (
        args["language"] if args["language"] is not None else "en"
    )  # default to loading english if not specified

    temperature = args.pop("temperature")
    if (increment := args.pop("temperature_increment_on_fallback")) is not None:
        temperature = tuple(np.arange(temperature, 1.0 + 1e-6, increment))
    else:
        temperature = [temperature]

    faster_whisper_threads = 4
    if (threads := args.pop("threads")) > 0:
        torch.set_num_threads(threads)
        faster_whisper_threads = threads

    asr_options = {
        "beam_size": args.pop("beam_size"),
        "best_of": args.pop("best_of"),
        "patience": args.pop("patience"),
        "length_penalty": args.pop("length_penalty"),
        "temperatures": temperature,
        "compression_ratio_threshold": args.pop("compression_ratio_threshold"),
        "log_prob_threshold": args.pop("logprob_threshold"),
        "no_speech_threshold": args.pop("no_speech_threshold"),
        "condition_on_previous_text": args.pop("condition_on_previous_text"),
        "initial_prompt": args.pop("initial_prompt"),
        "hotwords": args.pop("hotwords"),
        "suppress_tokens": [int(x) for x in args.pop("suppress_tokens").split(",")],
        "suppress_numerals": args.pop("suppress_numerals"),
    }

    writer = get_writer(output_format, output_dir)
    segment_resolution = args.pop("segment_resolution")
    word_options = ["highlight_words", "max_line_count", "max_line_width"]
    if no_align:
        for option in word_options:
            if args[option]:
                parser.error(f"--{option} not possible with --no_align")
        if segment_resolution != "sentence":
            parser.error("--segment_resolution not possible with --no_align")
    if args["max_line_count"] and not args["max_line_width"]:
        warnings.warn("--max_line_count has no effect without --max_line_width")
    writer_args = {arg: args.pop(arg) for arg in word_options}
    writer_args["segment_resolution"] = segment_resolution
    run_config_snapshot = {
        "mode": "analyze_only" if analyze_only_from is not None else "full_pipeline",
        "model": model_name,
        "device": device,
        "device_index": device_index,
        "compute_type": compute_type,
        "task": task,
        "output_format": output_format,
        "batch_size": batch_size,
        "chunk_size": chunk_size,
        "pipeline_chunk_seconds": pipeline_chunk_seconds,
        "pipeline_chunk_overlap_seconds": pipeline_chunk_overlap_seconds,
        "diarize": diarize,
        "min_speakers": min_speakers,
        "max_speakers": max_speakers,
        "force_n_speakers": force_n_speakers,
        "diarize_model": diarize_model_name,
        "no_align": no_align,
        "interpolate_method": interpolate_method,
        "segment_resolution": segment_resolution,
        "language": args.get("language"),
        "vad_method": vad_method,
        "vad_onset": vad_onset,
        "vad_offset": vad_offset,
        "analysis": timeline_analysis_config,
        "export_data_science": export_data_science,
    }

    if analyze_only_from is not None:
        _run_analyze_only(
            analyze_only_from=analyze_only_from,
            output_dir=output_dir,
            timeline_analysis_config=timeline_analysis_config,
            run_config_snapshot=run_config_snapshot,
            output_format=output_format,
        )
        return

    # Part 1: VAD & ASR Loop
    results = []
    # model = load_model(model_name, device=device, download_root=model_dir)
    model = load_model(
        model_name,
        device=device,
        device_index=device_index,
        download_root=model_dir,
        compute_type=compute_type,
        language=args["language"],
        asr_options=asr_options,
        vad_method=vad_method,
        vad_options={
            "chunk_size": chunk_size,
            "vad_onset": vad_onset,
            "vad_offset": vad_offset,
        },
        task=task,
        local_files_only=model_cache_only,
        threads=faster_whisper_threads,
        use_auth_token=hf_token,
    )

    for audio_path in args.pop("audio"):
        # >> VAD & ASR
        logger.info("Performing transcription...")
        result: TranscriptionResult = _transcribe_with_media_chunking(
            model,
            audio_path,
            batch_size=batch_size,
            chunk_size=chunk_size,
            print_progress=print_progress,
            verbose=verbose,
            pipeline_chunk_seconds=pipeline_chunk_seconds,
            pipeline_chunk_overlap_seconds=pipeline_chunk_overlap_seconds,
        )
        results.append((result, audio_path))

    # Unload Whisper and VAD
    del model
    gc.collect()
    torch.cuda.empty_cache()

    # Part 2: Align Loop
    if not no_align:
        tmp_results = results
        results = []
        align_model, align_metadata = load_align_model(
            align_language, device, model_name=align_model, model_dir=model_dir, model_cache_only=model_cache_only
        )
        for result, audio_path in tmp_results:
            detected_language = result.get("language")
            # >> Align
            input_audio = audio_path

            if align_model is not None and len(result["segments"]) > 0:
                if result.get("language", "en") != align_metadata["language"]:
                    # load new language
                    logger.info(
                        f"New language found ({result['language']})! Previous was ({align_metadata['language']}), loading new alignment model for new language..."
                    )
                    align_model, align_metadata = load_align_model(
                        result["language"], device, model_dir=model_dir, model_cache_only=model_cache_only
                    )
                logger.info("Performing alignment...")
                result: AlignedTranscriptionResult = align(
                    result["segments"],
                    align_model,
                    align_metadata,
                    input_audio,
                    device,
                    interpolate_method=interpolate_method,
                    return_char_alignments=return_char_alignments,
                    print_progress=print_progress,
                )
            if detected_language is not None:
                result["language"] = detected_language

            results.append((result, audio_path))

        # Unload align model
        del align_model
        gc.collect()
        torch.cuda.empty_cache()

    # >> Diarize
    if diarize:
        if hf_token is None:
            logger.warning(
                "No --hf_token provided, needs to be saved in environment variable, otherwise will throw error loading diarization model"
            )
        tmp_results = results
        logger.info("Performing diarization...")
        logger.info(f"Using model: {diarize_model_name}")
        results = []
        diarize_model = DiarizationPipeline(model_name=diarize_model_name, token=hf_token, device=device, cache_dir=model_dir)
        for result, input_audio_path in tmp_results:
            diarize_result = diarize_model(
                input_audio_path, 
                num_speakers=force_n_speakers,
                min_speakers=min_speakers, 
                max_speakers=max_speakers, 
                return_embeddings=return_speaker_embeddings
            )

            if return_speaker_embeddings:
                diarize_segments, speaker_embeddings = diarize_result
            else:
                diarize_segments = diarize_result
                speaker_embeddings = None

            result = assign_word_speakers(diarize_segments, result, speaker_embeddings)
            results.append((result, input_audio_path))
    # >> Write
    try:
        whisperx_version = importlib.metadata.version("whisperx")
    except importlib.metadata.PackageNotFoundError:
        whisperx_version = "unknown"

    for result, audio_path in results:
        if result.get("language") is None:
            result["language"] = args["language"] if args["language"] is not None else align_language
        result["timeline"] = build_canonical_timeline(
            result,
            analysis_config=timeline_analysis_config,
        )
        writer(result, audio_path, writer_args)
        if export_data_science:
            run_metadata = {
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "versions": {
                    "whisperx": whisperx_version,
                    "python": platform.python_version(),
                    "torch": getattr(torch, "__version__", "unknown"),
                },
                "input": {
                    "audioPath": os.path.abspath(audio_path),
                    "audioName": os.path.basename(audio_path),
                },
                "config": run_config_snapshot,
                "pipeline": {
                    "chunking": result.get("pipeline_chunking"),
                },
            }
            write_data_science_exports(
                output_dir=output_dir,
                audio_path=audio_path,
                result=result,
                run_metadata=run_metadata,
            )
