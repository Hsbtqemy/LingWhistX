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
from whisperx.chunk_merge import (
    _offset_and_filter_chunk_segments,
    compute_media_chunk_specs,
    load_chunk_raw_result,
    manifest_compatible_with_run,
    new_chunk_manifest,
    read_chunk_manifest,
    save_chunk_raw_result,
    write_chunk_manifest,
    write_words_jsonl_for_segments,
)
from whisperx.diarize import DiarizationPipeline, assign_word_speakers
from whisperx.external_alignment import (
    ExternalAlignmentError,
    apply_external_word_timings_to_result,
    load_external_word_timings_json,
)
from whisperx.schema import TranscriptionResult
from whisperx.timeline import (
    DEFAULT_ANALYSIS_INCLUDE_NONSPEECH,
    DEFAULT_IPU_BRIDGE_SHORT_GAPS_UNDER,
    DEFAULT_IPU_MIN_DURATION,
    DEFAULT_IPU_MIN_WORDS,
    DEFAULT_NONSPEECH_MIN_DURATION,
    DEFAULT_PAUSE_IGNORE_BELOW,
    DEFAULT_PAUSE_MIN,
    SPEAKER_TURN_POSTPROCESS_PRESETS,
    build_canonical_timeline,
)
from whisperx.annotation_exports import write_annotation_exports
from whisperx.numeric import as_float
from whisperx.utils import (
    LANGUAGES,
    TO_LANGUAGE_CODE,
    get_writer,
    write_data_science_exports,
)
from whisperx.log_utils import get_logger
from whisperx.pipeline_stages import (
    build_asr_options as _build_asr_options,
    build_temperature_sequence as _build_temperature_sequence,
    postprocess_words,
)

logger = get_logger(__name__)


def run_asr(
    model: Any,
    audio: Any,
    *,
    batch_size: int,
    chunk_size: int,
    print_progress: bool,
    verbose: bool,
) -> TranscriptionResult:
    """Délègue à model.transcribe — point d'injection pour les tests sans GPU."""
    return model.transcribe(
        audio,
        batch_size=batch_size,
        chunk_size=chunk_size,
        print_progress=print_progress,
        verbose=verbose,
    )


def _transcribe_with_media_chunking(
    model: Any,
    audio_path: str,
    batch_size: int,
    chunk_size: int,
    print_progress: bool,
    verbose: bool,
    pipeline_chunk_seconds: float | None,
    pipeline_chunk_overlap_seconds: float,
    *,
    chunk_state_dir: str | None = None,
    chunk_resume: bool = False,
    chunk_jsonl_per_chunk: bool = False,
) -> TranscriptionResult:
    def _single_pass(mode: str, duration_sec: float | None = None) -> TranscriptionResult:
        audio = load_audio(audio_path)
        result = run_asr(
            model, audio,
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

    specs = compute_media_chunk_specs(
        duration_sec,
        pipeline_chunk_seconds,
        pipeline_chunk_overlap_seconds,
    )
    manifest_path: str | None = None
    manifest: dict[str, Any] | None = None
    audio_stem = os.path.splitext(os.path.basename(audio_path))[0]
    if chunk_state_dir:
        os.makedirs(chunk_state_dir, exist_ok=True)
        manifest_path = os.path.join(chunk_state_dir, "chunk_manifest.json")
        existing = read_chunk_manifest(manifest_path) if chunk_resume else None
        use_existing = (
            existing
            and manifest_compatible_with_run(
                existing,
                audio_path,
                duration_sec,
                pipeline_chunk_seconds,
                pipeline_chunk_overlap_seconds,
            )
            and len(existing.get("chunks") or []) == len(specs)
        )
        if chunk_resume and existing and not use_existing:
            logger.warning(
                "Chunk manifest missing, incompatible, or chunk count mismatch; starting a fresh manifest.",
            )
        if use_existing and existing is not None:
            manifest = existing
        else:
            manifest = new_chunk_manifest(
                audio_path,
                duration_sec,
                pipeline_chunk_seconds,
                pipeline_chunk_overlap_seconds,
                step_sec,
                specs,
            )
            write_chunk_manifest(manifest_path, manifest)

    merged_segments: list[dict[str, Any]] = []
    chunk_windows: list[dict[str, Any]] = []
    detected_language: str | None = None

    for spec in specs:
        chunk_index = int(spec["index"])
        chunk_start = float(spec["start_sec"])
        chunk_duration = float(spec["duration_sec"])
        selection_end = spec["selection_end_sec"]
        sel_end_f = float(selection_end) if selection_end is not None else None

        chunk_result: dict[str, Any]
        entry: dict[str, Any] | None = None
        if manifest is not None:
            entry = manifest["chunks"][chunk_index - 1]
            art = entry.get("artifact")
            artifact_path = (
                os.path.join(chunk_state_dir, str(art))
                if chunk_state_dir and isinstance(art, str)
                else ""
            )
            if (
                chunk_resume
                and entry.get("status") == "done"
                and artifact_path
                and os.path.isfile(artifact_path)
            ):
                raw = load_chunk_raw_result(artifact_path)
                chunk_result = {
                    "segments": raw.get("segments") if isinstance(raw.get("segments"), list) else [],
                    "language": raw.get("language"),
                }
                logger.info(
                    "Resuming chunk #%d from artifact (offset %.2fs, window %.2fs).",
                    chunk_index,
                    chunk_start,
                    chunk_duration,
                )
            else:
                chunk_audio = load_audio(
                    audio_path,
                    start_time=chunk_start,
                    duration=chunk_duration,
                )
                if chunk_audio.size == 0:
                    logger.warning("Empty chunk audio at offset %.2fs; skipping chunk #%d.", chunk_start, chunk_index)
                    if entry is not None:
                        entry["status"] = "failed"
                        if manifest_path:
                            write_chunk_manifest(manifest_path, manifest)
                    continue
                try:
                    chunk_result = run_asr(
                        model, chunk_audio,
                        batch_size=batch_size,
                        chunk_size=chunk_size,
                        print_progress=print_progress,
                        verbose=verbose,
                    )
                except Exception:
                    if entry is not None:
                        entry["status"] = "failed"
                        if manifest_path:
                            write_chunk_manifest(manifest_path, manifest)
                    raise
                if chunk_state_dir:
                    save_chunk_raw_result(chunk_state_dir, chunk_index, chunk_result)
                    if entry is not None:
                        entry["status"] = "done"
                    if manifest_path:
                        write_chunk_manifest(manifest_path, manifest)
        else:
            chunk_audio = load_audio(
                audio_path,
                start_time=chunk_start,
                duration=chunk_duration,
            )
            if chunk_audio.size == 0:
                logger.warning(
                    "Empty chunk audio at offset %.2fs; skipping chunk #%d (no manifest).",
                    chunk_start,
                    chunk_index,
                )
                continue
            chunk_result = run_asr(
                model, chunk_audio,
                batch_size=batch_size,
                chunk_size=chunk_size,
                print_progress=print_progress,
                verbose=verbose,
            )

        if detected_language is None:
            language = chunk_result.get("language")
            if isinstance(language, str) and language.strip():
                detected_language = language.strip()

        chunk_segments = _offset_and_filter_chunk_segments(
            chunk_result,
            chunk_start,
            sel_end_f,
        )
        merged_segments.extend(chunk_segments)

        chunk_windows.append(
            {
                "index": chunk_index,
                "start": round(chunk_start, 3),
                "duration": round(chunk_duration, 3),
                "selection_end": round(sel_end_f, 3) if sel_end_f is not None else None,
                "emitted_segments": len(chunk_segments),
            }
        )
        logger.info(
            "Transcribed chunk #%d at offset %.2fs (window %.2fs).",
            chunk_index,
            chunk_start,
            chunk_duration,
        )

        if chunk_state_dir and chunk_jsonl_per_chunk:
            jsonl_path = os.path.join(
                chunk_state_dir,
                f"{audio_stem}.chunk_{chunk_index:04d}.jsonl",
            )
            write_words_jsonl_for_segments(jsonl_path, chunk_segments)

    merged_segments.sort(
        key=lambda segment: (
            as_float(segment.get("start"), 0.0),
            as_float(segment.get("end"), 0.0),
        )
    )

    pc: dict[str, Any] = {
        "enabled": True,
        "mode": "chunked",
        "chunk_seconds": round(pipeline_chunk_seconds, 3),
        "overlap_seconds": round(pipeline_chunk_overlap_seconds, 3),
        "step_seconds": round(step_sec, 3),
        "source_duration": round(duration_sec, 3),
        "windows": chunk_windows,
    }
    if chunk_state_dir:
        pc["chunk_state_dir"] = os.path.abspath(chunk_state_dir)
        if manifest_path:
            pc["chunk_manifest_path"] = os.path.abspath(manifest_path)
        pc["chunk_resume"] = bool(chunk_resume)
        pc["chunk_jsonl_per_chunk"] = bool(chunk_jsonl_per_chunk)

    return {
        "segments": merged_segments,
        "language": detected_language,
        "pipeline_chunking": pc,
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
    write_annotation_exports(
        output_dir=analysis_output_dir,
        audio_path=pseudo_audio_path,
        result=source_result,
        rttm=bool(run_config_snapshot.get("export_annotation_rttm")),
        textgrid=bool(run_config_snapshot.get("export_annotation_textgrid")),
        eaf=bool(run_config_snapshot.get("export_annotation_eaf")),
    )
    logger.info("Analyze-only completed. Artifacts written to: %s", analysis_output_dir)


def _build_timeline_analysis_config(
    *,
    analysis_pause_min: float,
    analysis_pause_ignore_below: float,
    analysis_pause_max: float | None,
    analysis_include_nonspeech: bool,
    analysis_nonspeech_min_duration: float,
    analysis_ipu_min_words: int,
    analysis_ipu_min_duration: float,
    analysis_ipu_bridge_short_gaps_under: float,
    analysis_preset: str | None,
    analysis_calibrate_window_sec: float | None,
    analysis_calibrate_start_sec: float,
    analysis_speaker_turn_postprocess_preset: str | None,
    analysis_speaker_turn_merge_gap_sec_max: float | None,
    analysis_speaker_turn_split_word_gap_sec: float | None,
    wts_mode: str,
    analysis_word_ts_neighbor_ratio_low: float | None,
    analysis_word_ts_neighbor_ratio_high: float | None,
    analysis_word_ts_smooth_max_sec: float | None,
) -> dict[str, Any]:
    timeline_analysis_config: dict[str, Any] = {
        "pause_min": analysis_pause_min,
        "pause_ignore_below": analysis_pause_ignore_below,
        "pause_max": analysis_pause_max,
        "include_nonspeech": analysis_include_nonspeech,
        "nonspeech_min_duration": analysis_nonspeech_min_duration,
        "ipu_min_words": analysis_ipu_min_words,
        "ipu_min_duration": analysis_ipu_min_duration,
        "ipu_bridge_short_gaps_under": analysis_ipu_bridge_short_gaps_under,
    }
    if isinstance(analysis_preset, str) and analysis_preset.strip():
        timeline_analysis_config["analysis_preset"] = analysis_preset.strip()
    if analysis_calibrate_window_sec is not None and analysis_calibrate_window_sec > 0:
        timeline_analysis_config["calibration"] = {
            "window_sec": float(analysis_calibrate_window_sec),
            "start_sec": float(analysis_calibrate_start_sec),
        }
    if analysis_speaker_turn_postprocess_preset:
        timeline_analysis_config["speaker_turn_postprocess_preset"] = analysis_speaker_turn_postprocess_preset
    if analysis_speaker_turn_merge_gap_sec_max is not None:
        timeline_analysis_config["speaker_turn_merge_gap_sec_max"] = float(
            analysis_speaker_turn_merge_gap_sec_max
        )
    if analysis_speaker_turn_split_word_gap_sec is not None:
        timeline_analysis_config["speaker_turn_split_word_gap_sec"] = float(
            analysis_speaker_turn_split_word_gap_sec
        )
    if wts_mode != "off":
        timeline_analysis_config["word_timestamp_stabilize_mode"] = wts_mode
    if analysis_word_ts_neighbor_ratio_low is not None:
        timeline_analysis_config["word_ts_neighbor_ratio_low"] = float(analysis_word_ts_neighbor_ratio_low)
    if analysis_word_ts_neighbor_ratio_high is not None:
        timeline_analysis_config["word_ts_neighbor_ratio_high"] = float(analysis_word_ts_neighbor_ratio_high)
    if analysis_word_ts_smooth_max_sec is not None:
        timeline_analysis_config["word_ts_smooth_max_sec"] = float(analysis_word_ts_smooth_max_sec)
    return timeline_analysis_config


def _run_full_pipeline_align(
    results: list[tuple[TranscriptionResult, str]],
    *,
    no_align: bool,
    align_language: str,
    align_model_name: str,
    model_dir: str,
    model_cache_only: bool,
    device: str,
    interpolate_method: str,
    return_char_alignments: bool,
    print_progress: bool,
) -> list[tuple[TranscriptionResult, str]]:
    if no_align:
        return results
    tmp_results = results
    out: list[tuple[TranscriptionResult, str]] = []
    align_model, align_metadata = load_align_model(
        align_language,
        device,
        model_name=align_model_name,
        model_dir=model_dir,
        model_cache_only=model_cache_only,
    )
    for result, audio_path in tmp_results:
        detected_language = result.get("language")
        input_audio = audio_path

        if align_model is not None and len(result["segments"]) > 0:
            if result.get("language", "en") != align_metadata["language"]:
                logger.info(
                    "New language found (%s)! Previous was (%s), loading new alignment model for new language...",
                    result["language"],
                    align_metadata["language"],
                )
                align_model, align_metadata = load_align_model(
                    result["language"], device, model_dir=model_dir, model_cache_only=model_cache_only
                )
            logger.info("Performing alignment...")
            result = align(
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

        out.append((result, audio_path))

    del align_model
    gc.collect()
    torch.cuda.empty_cache()
    return out


def _run_full_pipeline_diarize(
    results: list[tuple[TranscriptionResult, str]],
    *,
    diarize: bool,
    hf_token: str | None,
    diarize_model_name: str,
    device: str,
    model_dir: str,
    force_n_speakers: int | None,
    min_speakers: int | None,
    max_speakers: int | None,
    return_speaker_embeddings: bool,
    print_progress: bool,
) -> list[tuple[TranscriptionResult, str]]:
    if not diarize:
        return results
    if hf_token is None:
        logger.warning(
            "No --hf_token provided, needs to be saved in environment variable, otherwise will throw error loading diarization model"
        )
    tmp_results = results
    logger.info("Performing diarization...")
    logger.info("Using model: %s", diarize_model_name)
    out: list[tuple[TranscriptionResult, str]] = []
    diarize_model = DiarizationPipeline(
        model_name=diarize_model_name, token=hf_token, device=device, cache_dir=model_dir
    )

    def _diarize_progress(pct: float) -> None:
        if print_progress:
            # flush : stdout peut être en bloc lorsque le sous-processus n’est pas un TTY (worker).
            print(f"Progress: {pct:.2f}%...", flush=True)

    if print_progress:
        logger.info(
            "Diarisation pyannote (appareil: %s) : sur CPU, le temps de calcul dépasse souvent "
            "la durée du fichier (typiquement ~1–2× ou plus, selon la machine) ; avec CUDA ou Apple MPS "
            "c’est en général beaucoup plus rapide. Les lignes « Progress: … » reflètent la progression "
            "interne du modèle lorsqu’elle est disponible.",
            device,
        )

    for result, input_audio_path in tmp_results:
        diarize_result = diarize_model(
            input_audio_path,
            num_speakers=force_n_speakers,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            return_embeddings=return_speaker_embeddings,
            progress_callback=_diarize_progress if print_progress else None,
        )

        if return_speaker_embeddings:
            diarize_segments, speaker_embeddings = diarize_result
        else:
            diarize_segments = diarize_result
            speaker_embeddings = None

        result = assign_word_speakers(diarize_segments, result, speaker_embeddings)
        out.append((result, input_audio_path))
    return out


def _run_full_pipeline_write_outputs(
    results: list[tuple[TranscriptionResult, str]],
    parser: argparse.ArgumentParser,
    *,
    args: dict[str, Any],
    align_language: str,
    timeline_analysis_config: dict[str, Any],
    writer: Any,
    writer_args: dict[str, Any],
    output_dir: str,
    export_data_science: bool,
    export_annotation_rttm: bool,
    export_annotation_textgrid: bool,
    export_annotation_eaf: bool,
    export_word_ctm: bool,
    export_parquet_dataset: bool,
    external_timings_payload: dict[str, Any] | None,
    external_word_timings_json: str | None,
    external_word_timings_strict: bool,
    run_config_snapshot: dict[str, Any],
) -> None:
    try:
        whisperx_version = importlib.metadata.version("whisperx")
    except importlib.metadata.PackageNotFoundError:
        whisperx_version = "unknown"

    for result, audio_path in results:
        if result.get("language") is None:
            result["language"] = args["language"] if args["language"] is not None else align_language
        if external_timings_payload is not None and external_word_timings_json:
            try:
                meta = apply_external_word_timings_to_result(
                    result,
                    external_timings_payload,
                    source_path=external_word_timings_json,
                    strict_token_match=external_word_timings_strict,
                )
                result["external_alignment"] = meta
                logger.info(
                    "Applied external word timings (%d words) from %s.",
                    meta["n_words_applied"],
                    external_word_timings_json,
                )
            except ExternalAlignmentError as exc:
                parser.error(str(exc))
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
                export_word_ctm=export_word_ctm,
                export_parquet_dataset=export_parquet_dataset,
            )
        write_annotation_exports(
            output_dir=output_dir,
            audio_path=audio_path,
            result=result,
            rttm=export_annotation_rttm,
            textgrid=export_annotation_textgrid,
            eaf=export_annotation_eaf,
        )


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
    analysis_preset: str | None = args.pop("analysis_preset")
    analysis_calibrate_window_sec: float | None = args.pop("analysis_calibrate_window_sec")
    analysis_calibrate_start_sec: float = args.pop("analysis_calibrate_start_sec")
    analysis_speaker_turn_postprocess_preset: str | None = args.pop("analysis_speaker_turn_postprocess_preset")
    analysis_speaker_turn_merge_gap_sec_max: float | None = args.pop("analysis_speaker_turn_merge_gap_sec_max")
    analysis_speaker_turn_split_word_gap_sec: float | None = args.pop("analysis_speaker_turn_split_word_gap_sec")
    analysis_word_timestamp_stabilize_mode: str = args.pop("analysis_word_timestamp_stabilize_mode")
    analysis_word_ts_neighbor_ratio_low: float | None = args.pop("analysis_word_ts_neighbor_ratio_low")
    analysis_word_ts_neighbor_ratio_high: float | None = args.pop("analysis_word_ts_neighbor_ratio_high")
    analysis_word_ts_smooth_max_sec: float | None = args.pop("analysis_word_ts_smooth_max_sec")
    export_data_science: bool = args.pop("export_data_science")
    export_annotation_rttm: bool = args.pop("export_annotation_rttm")
    export_annotation_textgrid: bool = args.pop("export_annotation_textgrid")
    export_annotation_eaf: bool = args.pop("export_annotation_eaf")
    export_word_ctm: bool = args.pop("export_word_ctm")
    export_parquet_dataset: bool = args.pop("export_parquet_dataset")
    analyze_only_from: str | None = args.pop("analyze_only_from")
    if isinstance(analyze_only_from, str):
        analyze_only_from = analyze_only_from.strip() or None

    audio_paths_early: list[str] = args.get("audio") or []
    if not isinstance(audio_paths_early, list):
        audio_paths_early = []
    if analyze_only_from is None and len(audio_paths_early) < 1:
        parser.error(
            "At least one audio file is required unless --analyze_only_from is set.",
        )
    if analyze_only_from is not None and len(audio_paths_early) > 0:
        logger.warning(
            "Ignoring %d positional audio path(s) because --analyze_only_from is set.",
            len(audio_paths_early),
        )

    chunk_state_dir_arg: str | None = args.pop("chunk_state_dir")
    if isinstance(chunk_state_dir_arg, str):
        chunk_state_dir_arg = chunk_state_dir_arg.strip() or None
    chunk_resume: bool = args.pop("chunk_resume")
    chunk_jsonl_per_chunk: bool = args.pop("chunk_jsonl_per_chunk")
    external_word_timings_json: str | None = args.pop("external_word_timings_json")
    external_word_timings_strict: bool = args.pop("external_word_timings_strict")
    if isinstance(external_word_timings_json, str):
        external_word_timings_json = external_word_timings_json.strip() or None

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
    if diarize and hf_token is None:
        parser.error(
            "Diarization requires a Hugging Face token: use --hf_token or set "
            "WHISPERX_HF_TOKEN / HF_TOKEN. Create a read token at "
            "https://huggingface.co/settings/tokens and accept model terms at "
            "https://huggingface.co/pyannote/speaker-diarization-community-1",
        )
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
    if analysis_calibrate_start_sec < 0:
        parser.error("--analysis_calibrate_start_sec must be >= 0")
    if analysis_calibrate_window_sec is not None and analysis_calibrate_window_sec <= 0:
        parser.error("--analysis_calibrate_window_sec must be > 0 when set")
    if isinstance(analysis_speaker_turn_postprocess_preset, str):
        analysis_speaker_turn_postprocess_preset = analysis_speaker_turn_postprocess_preset.strip() or None
    else:
        analysis_speaker_turn_postprocess_preset = None
    if (
        analysis_speaker_turn_postprocess_preset
        and analysis_speaker_turn_postprocess_preset not in SPEAKER_TURN_POSTPROCESS_PRESETS
    ):
        parser.error(
            "--analysis_speaker_turn_postprocess_preset must be one of: "
            + ", ".join(sorted(SPEAKER_TURN_POSTPROCESS_PRESETS))
        )
    if analysis_speaker_turn_merge_gap_sec_max is not None and analysis_speaker_turn_merge_gap_sec_max < 0:
        parser.error("--analysis_speaker_turn_merge_gap_sec_max must be >= 0")
    if analysis_speaker_turn_split_word_gap_sec is not None and analysis_speaker_turn_split_word_gap_sec <= 0:
        parser.error("--analysis_speaker_turn_split_word_gap_sec must be > 0 when set")
    wts_mode = (
        analysis_word_timestamp_stabilize_mode.strip().lower()
        if isinstance(analysis_word_timestamp_stabilize_mode, str)
        else "off"
    )
    if wts_mode not in ("off", "detect", "smooth"):
        parser.error("--analysis_word_timestamp_stabilize_mode must be one of: off, detect, smooth")
    if analysis_word_ts_neighbor_ratio_low is not None and analysis_word_ts_neighbor_ratio_low <= 0:
        parser.error("--analysis_word_ts_neighbor_ratio_low must be > 0 when set")
    if analysis_word_ts_neighbor_ratio_high is not None and analysis_word_ts_neighbor_ratio_high <= 1.0:
        parser.error("--analysis_word_ts_neighbor_ratio_high must be > 1 when set")
    if analysis_word_ts_smooth_max_sec is not None and analysis_word_ts_smooth_max_sec <= 0:
        parser.error("--analysis_word_ts_smooth_max_sec must be > 0 when set")

    timeline_analysis_config = _build_timeline_analysis_config(
        analysis_pause_min=analysis_pause_min,
        analysis_pause_ignore_below=analysis_pause_ignore_below,
        analysis_pause_max=analysis_pause_max,
        analysis_include_nonspeech=analysis_include_nonspeech,
        analysis_nonspeech_min_duration=analysis_nonspeech_min_duration,
        analysis_ipu_min_words=analysis_ipu_min_words,
        analysis_ipu_min_duration=analysis_ipu_min_duration,
        analysis_ipu_bridge_short_gaps_under=analysis_ipu_bridge_short_gaps_under,
        analysis_preset=analysis_preset,
        analysis_calibrate_window_sec=analysis_calibrate_window_sec,
        analysis_calibrate_start_sec=analysis_calibrate_start_sec,
        analysis_speaker_turn_postprocess_preset=analysis_speaker_turn_postprocess_preset,
        analysis_speaker_turn_merge_gap_sec_max=analysis_speaker_turn_merge_gap_sec_max,
        analysis_speaker_turn_split_word_gap_sec=analysis_speaker_turn_split_word_gap_sec,
        wts_mode=wts_mode,
        analysis_word_ts_neighbor_ratio_low=analysis_word_ts_neighbor_ratio_low,
        analysis_word_ts_neighbor_ratio_high=analysis_word_ts_neighbor_ratio_high,
        analysis_word_ts_smooth_max_sec=analysis_word_ts_smooth_max_sec,
    )
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

    temperatures = _build_temperature_sequence(
        args.pop("temperature"),
        args.pop("temperature_increment_on_fallback"),
    )

    faster_whisper_threads = 4
    if (threads := args.pop("threads")) > 0:
        torch.set_num_threads(threads)
        faster_whisper_threads = threads

    asr_options = _build_asr_options(
        beam_size=args.pop("beam_size"),
        best_of=args.pop("best_of"),
        patience=args.pop("patience"),
        length_penalty=args.pop("length_penalty"),
        temperatures=temperatures,
        compression_ratio_threshold=args.pop("compression_ratio_threshold"),
        log_prob_threshold=args.pop("logprob_threshold"),
        no_speech_threshold=args.pop("no_speech_threshold"),
        condition_on_previous_text=args.pop("condition_on_previous_text"),
        initial_prompt=args.pop("initial_prompt"),
        hotwords=args.pop("hotwords"),
        suppress_tokens_str=args.pop("suppress_tokens"),
        suppress_numerals=args.pop("suppress_numerals"),
    )

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
        "export_annotation_rttm": export_annotation_rttm,
        "export_annotation_textgrid": export_annotation_textgrid,
        "export_annotation_eaf": export_annotation_eaf,
        "export_word_ctm": export_word_ctm,
        "export_parquet_dataset": export_parquet_dataset,
        "chunk_state_dir": chunk_state_dir_arg,
        "chunk_resume": chunk_resume,
        "chunk_jsonl_per_chunk": chunk_jsonl_per_chunk,
        "external_word_timings_json": external_word_timings_json,
        "external_word_timings_strict": external_word_timings_strict,
    }

    audio_list = args.get("audio")
    if external_word_timings_json:
        if not isinstance(audio_list, list) or len(audio_list) != 1:
            parser.error("--external_word_timings_json requires exactly one audio file.")
        if no_align:
            parser.error("--external_word_timings_json requires word-level alignment (omit --no_align).")
    external_timings_payload: dict[str, Any] | None = None
    if external_word_timings_json:
        try:
            external_timings_payload = load_external_word_timings_json(external_word_timings_json)
        except ExternalAlignmentError as exc:
            parser.error(str(exc))

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

    if chunk_state_dir_arg and pipeline_chunk_seconds is None:
        warnings.warn(
            "--chunk_state_dir has no effect without --pipeline_chunk_seconds (single-pass transcription).",
        )

    for audio_path in args.pop("audio"):
        # >> VAD & ASR
        logger.info("Performing transcription...")
        chunk_state_full: str | None = None
        if chunk_state_dir_arg:
            stem = os.path.splitext(os.path.basename(audio_path))[0]
            chunk_state_full = os.path.join(chunk_state_dir_arg, stem)
        result: TranscriptionResult = _transcribe_with_media_chunking(
            model,
            audio_path,
            batch_size=batch_size,
            chunk_size=chunk_size,
            print_progress=print_progress,
            verbose=verbose,
            pipeline_chunk_seconds=pipeline_chunk_seconds,
            pipeline_chunk_overlap_seconds=pipeline_chunk_overlap_seconds,
            chunk_state_dir=chunk_state_full,
            chunk_resume=chunk_resume,
            chunk_jsonl_per_chunk=chunk_jsonl_per_chunk,
        )
        results.append((result, audio_path))

    # Unload Whisper and VAD
    del model
    gc.collect()
    torch.cuda.empty_cache()

    results = _run_full_pipeline_align(
        results,
        no_align=no_align,
        align_language=align_language,
        align_model_name=align_model,
        model_dir=model_dir,
        model_cache_only=model_cache_only,
        device=device,
        interpolate_method=interpolate_method,
        return_char_alignments=return_char_alignments,
        print_progress=print_progress,
    )

    results = _run_full_pipeline_diarize(
        results,
        diarize=diarize,
        hf_token=hf_token,
        diarize_model_name=diarize_model_name,
        device=device,
        model_dir=model_dir,
        force_n_speakers=force_n_speakers,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        return_speaker_embeddings=return_speaker_embeddings,
        print_progress=print_progress,
    )

    _run_full_pipeline_write_outputs(
        results,
        parser,
        args=args,
        align_language=align_language,
        timeline_analysis_config=timeline_analysis_config,
        writer=writer,
        writer_args=writer_args,
        output_dir=output_dir,
        export_data_science=export_data_science,
        export_annotation_rttm=export_annotation_rttm,
        export_annotation_textgrid=export_annotation_textgrid,
        export_annotation_eaf=export_annotation_eaf,
        export_word_ctm=export_word_ctm,
        export_parquet_dataset=export_parquet_dataset,
        external_timings_payload=external_timings_payload,
        external_word_timings_json=external_word_timings_json,
        external_word_timings_strict=external_word_timings_strict,
        run_config_snapshot=run_config_snapshot,
    )


def export_only_task(args: dict, parser: argparse.ArgumentParser) -> None:
    """Re-export subtitle/data-science artifacts from an existing JSON without running ASR."""
    for key in ("command", "config", "immutable_run", "runs_root", "verbose", "log_level"):
        args.pop(key, None)
    for key in ("chunk_state_dir", "chunk_resume", "chunk_jsonl_per_chunk"):
        args.pop(key, None)
    for key in (
        "analysis_speaker_turn_postprocess_preset",
        "analysis_speaker_turn_merge_gap_sec_max",
        "analysis_speaker_turn_split_word_gap_sec",
        "analysis_word_timestamp_stabilize_mode",
        "analysis_word_ts_neighbor_ratio_low",
        "analysis_word_ts_neighbor_ratio_high",
        "analysis_word_ts_smooth_max_sec",
    ):
        args.pop(key, None)
    for key in ("external_word_timings_json", "external_word_timings_strict"):
        args.pop(key, None)
    from_json = args.pop("export_from_json")
    output_dir = args.pop("output_dir")
    output_format = args.pop("output_format")
    export_data_science = args.pop("export_data_science", True)
    export_annotation_rttm = args.pop("export_annotation_rttm", False)
    export_annotation_textgrid = args.pop("export_annotation_textgrid", False)
    export_annotation_eaf = args.pop("export_annotation_eaf", False)
    export_word_ctm = args.pop("export_word_ctm", True)
    export_parquet_dataset = args.pop("export_parquet_dataset", False)
    if args:
        unknown = ", ".join(sorted(args.keys()))
        parser.error(f"Unexpected arguments for export: {unknown}")

    os.makedirs(output_dir, exist_ok=True)
    with open(from_json, "r", encoding="utf-8") as handle:
        result: dict[str, Any] = json.load(handle)

    timeline_analysis_config = {
        "pause_min": DEFAULT_PAUSE_MIN,
        "pause_ignore_below": DEFAULT_PAUSE_IGNORE_BELOW,
        "pause_max": None,
        "include_nonspeech": DEFAULT_ANALYSIS_INCLUDE_NONSPEECH,
        "nonspeech_min_duration": DEFAULT_NONSPEECH_MIN_DURATION,
        "ipu_min_words": DEFAULT_IPU_MIN_WORDS,
        "ipu_min_duration": DEFAULT_IPU_MIN_DURATION,
        "ipu_bridge_short_gaps_under": DEFAULT_IPU_BRIDGE_SHORT_GAPS_UNDER,
    }
    result["timeline"] = build_canonical_timeline(
        result,
        analysis_config=timeline_analysis_config,
    )

    writer = get_writer(output_format, output_dir)
    writer_args = {
        "highlight_words": False,
        "max_line_count": None,
        "max_line_width": None,
        "segment_resolution": "sentence",
    }
    writer(result, from_json, writer_args)

    if export_data_science:
        try:
            whisperx_version = importlib.metadata.version("whisperx")
        except importlib.metadata.PackageNotFoundError:
            whisperx_version = "unknown"
        run_metadata = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "mode": "export_only",
            "input": {"sourceJsonPath": os.path.abspath(from_json)},
            "versions": {
                "whisperx": whisperx_version,
                "python": platform.python_version(),
                "torch": getattr(torch, "__version__", "unknown"),
            },
        }
        write_data_science_exports(
            output_dir=output_dir,
            audio_path=from_json,
            result=result,
            run_metadata=run_metadata,
            export_word_ctm=export_word_ctm,
            export_parquet_dataset=export_parquet_dataset,
        )
    write_annotation_exports(
        output_dir=output_dir,
        audio_path=from_json,
        result=result,
        rttm=bool(export_annotation_rttm),
        textgrid=bool(export_annotation_textgrid),
        eaf=bool(export_annotation_eaf),
    )
