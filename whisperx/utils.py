import csv
import json
import os
import re
import sys
import zlib
from typing import Any, Callable, Optional, TextIO

from whisperx.numeric import as_float

LANGUAGES = {
    "en": "english",
    "zh": "chinese",
    "de": "german",
    "es": "spanish",
    "ru": "russian",
    "ko": "korean",
    "fr": "french",
    "ja": "japanese",
    "pt": "portuguese",
    "tr": "turkish",
    "pl": "polish",
    "ca": "catalan",
    "nl": "dutch",
    "ar": "arabic",
    "sv": "swedish",
    "it": "italian",
    "id": "indonesian",
    "hi": "hindi",
    "fi": "finnish",
    "vi": "vietnamese",
    "he": "hebrew",
    "uk": "ukrainian",
    "el": "greek",
    "ms": "malay",
    "cs": "czech",
    "ro": "romanian",
    "da": "danish",
    "hu": "hungarian",
    "ta": "tamil",
    "no": "norwegian",
    "th": "thai",
    "ur": "urdu",
    "hr": "croatian",
    "bg": "bulgarian",
    "lt": "lithuanian",
    "la": "latin",
    "mi": "maori",
    "ml": "malayalam",
    "cy": "welsh",
    "sk": "slovak",
    "te": "telugu",
    "fa": "persian",
    "lv": "latvian",
    "bn": "bengali",
    "sr": "serbian",
    "az": "azerbaijani",
    "sl": "slovenian",
    "kn": "kannada",
    "et": "estonian",
    "mk": "macedonian",
    "br": "breton",
    "eu": "basque",
    "is": "icelandic",
    "hy": "armenian",
    "ne": "nepali",
    "mn": "mongolian",
    "bs": "bosnian",
    "kk": "kazakh",
    "sq": "albanian",
    "sw": "swahili",
    "gl": "galician",
    "mr": "marathi",
    "pa": "punjabi",
    "si": "sinhala",
    "km": "khmer",
    "sn": "shona",
    "yo": "yoruba",
    "so": "somali",
    "af": "afrikaans",
    "oc": "occitan",
    "ka": "georgian",
    "be": "belarusian",
    "tg": "tajik",
    "sd": "sindhi",
    "gu": "gujarati",
    "am": "amharic",
    "yi": "yiddish",
    "lo": "lao",
    "uz": "uzbek",
    "fo": "faroese",
    "ht": "haitian creole",
    "ps": "pashto",
    "tk": "turkmen",
    "nn": "nynorsk",
    "mt": "maltese",
    "sa": "sanskrit",
    "lb": "luxembourgish",
    "my": "myanmar",
    "bo": "tibetan",
    "tl": "tagalog",
    "mg": "malagasy",
    "as": "assamese",
    "tt": "tatar",
    "haw": "hawaiian",
    "ln": "lingala",
    "ha": "hausa",
    "ba": "bashkir",
    "jw": "javanese",
    "su": "sundanese",
    "yue": "cantonese",
}

# language code lookup by name, with a few language aliases
TO_LANGUAGE_CODE = {
    **{language: code for code, language in LANGUAGES.items()},
    "burmese": "my",
    "valencian": "ca",
    "flemish": "nl",
    "haitian": "ht",
    "letzeburgesch": "lb",
    "pushto": "ps",
    "panjabi": "pa",
    "moldavian": "ro",
    "moldovan": "ro",
    "sinhalese": "si",
    "castilian": "es",
}

LANGUAGES_WITHOUT_SPACES = ["ja", "zh"]

# Mapping of language codes to NLTK Punkt tokenizer model names
PUNKT_LANGUAGES = {
    'cs': 'czech',
    'da': 'danish', 
    'de': 'german',
    'el': 'greek',
    'en': 'english',
    'es': 'spanish',
    'et': 'estonian',
    'fi': 'finnish',
    'fr': 'french',
    'it': 'italian',
    'nl': 'dutch',
    'no': 'norwegian',
    'pl': 'polish',
    'pt': 'portuguese',
    'sl': 'slovene',
    'sv': 'swedish',
    'tr': 'turkish',
    "ml": "malayalam",
    "ru": "russian",
}

system_encoding = sys.getdefaultencoding()

if system_encoding != "utf-8":

    def make_safe(string):
        # replaces any character not representable using the system default encoding with an '?',
        # avoiding UnicodeEncodeError (https://github.com/openai/whisper/discussions/729).
        return string.encode(system_encoding, errors="replace").decode(system_encoding)

else:

    def make_safe(string):
        # utf-8 can encode any Unicode code point, so no need to do the round-trip encoding
        return string


def exact_div(x, y):
    assert x % y == 0
    return x // y


def str2bool(string):
    if isinstance(string, bool):
        return string
    normalized = str(string).strip().lower()
    str2val = {"true": True, "false": False}
    if normalized in str2val:
        return str2val[normalized]
    raise ValueError(f"Expected one of {set(str2val.keys())}, got {string!r}")


def optional_int(string):
    return None if string == "None" else int(string)


def optional_float(string):
    return None if string == "None" else float(string)


def compression_ratio(text) -> float:
    text_bytes = text.encode("utf-8")
    return len(text_bytes) / len(zlib.compress(text_bytes))


def format_timestamp(
    seconds: float, always_include_hours: bool = False, decimal_marker: str = "."
):
    assert seconds >= 0, "non-negative timestamp expected"
    milliseconds = round(seconds * 1000.0)

    hours = milliseconds // 3_600_000
    milliseconds -= hours * 3_600_000

    minutes = milliseconds // 60_000
    milliseconds -= minutes * 60_000

    seconds = milliseconds // 1_000
    milliseconds -= seconds * 1_000

    hours_marker = f"{hours:02d}:" if always_include_hours or hours > 0 else ""
    return (
        f"{hours_marker}{minutes:02d}:{seconds:02d}{decimal_marker}{milliseconds:03d}"
    )


class ResultWriter:
    extension: str

    def __init__(self, output_dir: str):
        self.output_dir = output_dir

    def __call__(self, result: dict, audio_path: str, options: dict):
        audio_basename = os.path.basename(audio_path)
        audio_basename = os.path.splitext(audio_basename)[0]
        output_path = os.path.join(
            self.output_dir, audio_basename + "." + self.extension
        )

        with open(output_path, "w", encoding="utf-8") as f:
            self.write_result(result, file=f, options=options)

    def write_result(self, result: dict, file: TextIO, options: dict):
        raise NotImplementedError


class WriteTXT(ResultWriter):
    extension: str = "txt"

    def write_result(self, result: dict, file: TextIO, options: dict):
        for segment in result["segments"]:
            speaker = segment.get("speaker")
            text = segment["text"].strip()
            if speaker is not None:
                print(f"[{speaker}]: {text}", file=file, flush=True)
            else:
                print(text, file=file, flush=True)


class SubtitlesWriter(ResultWriter):
    always_include_hours: bool
    decimal_marker: str

    def iterate_result(self, result: dict, options: dict):
        raw_max_line_width: Optional[int] = options["max_line_width"]
        max_line_count: Optional[int] = options["max_line_count"]
        highlight_words: bool = options["highlight_words"]
        segment_resolution: str = options.get("segment_resolution", "sentence")
        max_line_width = 1000 if raw_max_line_width is None else raw_max_line_width
        preserve_segments = segment_resolution != "chunk"

        if len(result["segments"]) == 0:
            return

        def iterate_subtitles():
            line_len = 0
            line_count = 1
            # the next subtitle to yield (a list of word timings with whitespace)
            subtitle: list[dict] = []
            times: list[tuple] = []
            last = result["segments"][0]["start"]
            for segment in result["segments"]:
                for i, original_timing in enumerate(segment["words"]):
                    timing = original_timing.copy()
                    long_pause = not preserve_segments
                    if "start" in timing:
                        long_pause = long_pause and timing["start"] - last > 3.0
                    else:
                        long_pause = False
                    has_room = line_len + len(timing["word"]) <= max_line_width
                    seg_break = i == 0 and len(subtitle) > 0 and preserve_segments
                    if line_len > 0 and has_room and not long_pause and not seg_break:
                        # line continuation
                        line_len += len(timing["word"])
                    else:
                        # new line
                        timing["word"] = timing["word"].strip()
                        if (
                            len(subtitle) > 0
                            and max_line_count is not None
                            and (long_pause or line_count >= max_line_count)
                            or seg_break
                        ):
                            # subtitle break
                            yield subtitle, times
                            subtitle = []
                            times = []
                            line_count = 1
                        elif line_len > 0:
                            # line break
                            line_count += 1
                            timing["word"] = "\n" + timing["word"]
                        line_len = len(timing["word"].strip())
                    subtitle.append(timing)
                    times.append((segment["start"], segment["end"], segment.get("speaker")))
                    if "start" in timing:
                        last = timing["start"]
            if len(subtitle) > 0:
                yield subtitle, times

        if "words" in result["segments"][0]:
            for subtitle, times in iterate_subtitles():
                speaker = times[0][2]

                # Derive cue times from word-level timestamps when available,
                # falling back to segment-level times for fully unalignable subtitles.
                word_starts = [w["start"] for w in subtitle if "start" in w]
                word_ends = [w["end"] for w in subtitle if "end" in w]
                if word_starts and word_ends:
                    subtitle_start = self.format_timestamp(min(word_starts))
                    subtitle_end = self.format_timestamp(max(word_ends))
                else:
                    subtitle_start = self.format_timestamp(times[0][0])
                    subtitle_end = self.format_timestamp(times[0][1])
                if result["language"] in LANGUAGES_WITHOUT_SPACES:
                    subtitle_text = "".join([word["word"] for word in subtitle])
                else:
                    subtitle_text = " ".join([word["word"] for word in subtitle])
                has_timing = any(["start" in word for word in subtitle])

                # add [$SPEAKER_ID]: to each subtitle if speaker is available
                prefix = ""
                if speaker is not None:
                    prefix = f"[{speaker}]: "

                if highlight_words and has_timing:
                    last = subtitle_start
                    all_words = [timing["word"] for timing in subtitle]
                    for i, this_word in enumerate(subtitle):
                        if "start" in this_word:
                            start = self.format_timestamp(this_word["start"])
                            end = self.format_timestamp(this_word["end"])
                            if last != start:
                                yield last, start, prefix + subtitle_text

                            yield start, end, prefix + " ".join(
                                [
                                    re.sub(r"^(\s*)(.*)$", r"\1<u>\2</u>", word)
                                    if j == i
                                    else word
                                    for j, word in enumerate(all_words)
                                ]
                            )
                            last = end
                else:
                    yield subtitle_start, subtitle_end, prefix + subtitle_text
        else:
            for segment in result["segments"]:
                segment_start = self.format_timestamp(segment["start"])
                segment_end = self.format_timestamp(segment["end"])
                segment_text = segment["text"].strip().replace("-->", "->")
                if "speaker" in segment:
                    segment_text = f"[{segment['speaker']}]: {segment_text}"
                yield segment_start, segment_end, segment_text

    def format_timestamp(self, seconds: float):
        return format_timestamp(
            seconds=seconds,
            always_include_hours=self.always_include_hours,
            decimal_marker=self.decimal_marker,
        )


class WriteVTT(SubtitlesWriter):
    extension: str = "vtt"
    always_include_hours: bool = False
    decimal_marker: str = "."

    def write_result(self, result: dict, file: TextIO, options: dict):
        print("WEBVTT\n", file=file)
        for start, end, text in self.iterate_result(result, options):
            print(f"{start} --> {end}\n{text}\n", file=file, flush=True)


class WriteSRT(SubtitlesWriter):
    extension: str = "srt"
    always_include_hours: bool = True
    decimal_marker: str = ","

    def write_result(self, result: dict, file: TextIO, options: dict):
        for i, (start, end, text) in enumerate(
            self.iterate_result(result, options), start=1
        ):
            print(f"{i}\n{start} --> {end}\n{text}\n", file=file, flush=True)


class WriteTSV(ResultWriter):
    """
    Write a transcript to a file in TSV (tab-separated values) format containing lines like:
    <start time in integer milliseconds>\t<end time in integer milliseconds>\t<transcript text>

    Using integer milliseconds as start and end times means there's no chance of interference from
    an environment setting a language encoding that causes the decimal in a floating point number
    to appear as a comma; also is faster and more efficient to parse & store, e.g., in C++.
    """

    extension: str = "tsv"

    def write_result(self, result: dict, file: TextIO, options: dict):
        print("start", "end", "text", sep="\t", file=file)
        for segment in result["segments"]:
            print(round(1000 * segment["start"]), file=file, end="\t")
            print(round(1000 * segment["end"]), file=file, end="\t")
            print(segment["text"].strip().replace("\t", " "), file=file, flush=True)

class WriteAudacity(ResultWriter):
    """
    Write a transcript to a text file that audacity can import as labels.
    The extension used is "aud" to distinguish it from the txt file produced by WriteTXT.
    Yet this is not an audacity project but only a label file!
    
    Please note : Audacity uses seconds in timestamps not ms! 
    Also there is no header expected.

    If speaker is provided it is prepended to the text between double square brackets [[]].
    """

    extension: str = "aud"    

    def write_result(self, result: dict, file: TextIO, options: dict):
        ARROW = "\t"
        for segment in result["segments"]:
            print(segment["start"], file=file, end=ARROW)
            print(segment["end"], file=file, end=ARROW)
            print( ( ("[[" + segment["speaker"] + "]]") if "speaker" in segment else "") + segment["text"].strip().replace("\t", " "), file=file, flush=True)

            

class WriteJSON(ResultWriter):
    extension: str = "json"

    def write_result(self, result: dict, file: TextIO, options: dict):
        json.dump(result, file, ensure_ascii=False)


def get_writer(
    output_format: str, output_dir: str
) -> Callable[[dict, str, dict], None]:
    writers = {
        "txt": WriteTXT,
        "vtt": WriteVTT,
        "srt": WriteSRT,
        "tsv": WriteTSV,
        "json": WriteJSON,
    }
    optional_writers = {
        "aud": WriteAudacity,
    }

    if output_format == "all":
        all_writers = [writer(output_dir) for writer in writers.values()]

        def write_all(result: dict, file: str, options: dict):
            for writer in all_writers:
                writer(result, file, options)

        return write_all

    if output_format in optional_writers:
        return optional_writers[output_format](output_dir)
    return writers[output_format](output_dir)


def _safe_float(value, ndigits: int = 3):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            numeric = float(stripped)
        except ValueError:
            return None
    else:
        return None
    return round(numeric, ndigits)


def _safe_int(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(float(stripped))
        except ValueError:
            return None
    return None


def _safe_text(value):
    if value is None:
        return ""
    return str(value)


def _write_csv_rows(csv_path: str, fieldnames: list[str], rows: list[dict]) -> None:
    with open(csv_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _write_segments_srt_vtt(
    output_dir: str,
    audio_basename: str,
    raw_segments: list | None,
) -> tuple[str, str]:
    """
    Sous-titres segment-level (spec WX-504) : un bloc par segment avec texte non vide.
    """
    from whisperx.SubtitlesProcessor import format_timestamp as subtitle_format_ts

    srt_path = os.path.join(output_dir, f"{audio_basename}.segments.srt")
    vtt_path = os.path.join(output_dir, f"{audio_basename}.segments.vtt")
    segments = raw_segments if isinstance(raw_segments, list) else []

    def _segment_text_for_srt(seg: dict) -> str:
        t = seg.get("text")
        if t is None:
            return ""
        return str(t).strip().replace("\r\n", " ").replace("\n", " ")

    srt_blocks: list[str] = []
    vtt_blocks: list[str] = []
    cue_idx = 1
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        text = _segment_text_for_srt(seg)
        if not text:
            continue
        try:
            start = max(0.0, float(seg.get("start", 0.0)))
            end = max(0.0, float(seg.get("end", 0.0)))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        srt_blocks.append(
            f"{cue_idx}\n"
            f"{subtitle_format_ts(start)} --> {subtitle_format_ts(end)}\n"
            f"{text}\n"
        )
        vtt_blocks.append(
            f"{cue_idx}\n"
            f"{subtitle_format_ts(start, True)} --> {subtitle_format_ts(end, True)}\n"
            f"{text}\n"
        )
        cue_idx += 1

    with open(srt_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(srt_blocks))
        if srt_blocks:
            handle.write("\n")

    with open(vtt_path, "w", encoding="utf-8") as handle:
        handle.write("WEBVTT\n\n")
        handle.write("\n".join(vtt_blocks))
        if vtt_blocks:
            handle.write("\n")

    return srt_path, vtt_path


def _ctm_safe_utterance_id(name: str) -> str:
    s = re.sub(r"\s+", "_", (name or "utt").strip())
    return s or "utt"


def _ctm_sanitize_token(text: str) -> str:
    t = text.replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()
    return t if t else "<unk>"


def write_word_ctm(path: str, utterance_id: str, word_rows: list[dict]) -> None:
    """
    NIST-style CTM (one word per line) for ASR / scoring interop.

    Columns: utterance_id channel start_sec duration_sec word confidence
    (channel is fixed to 1; confidence from CSV row or 1.0).
    """
    uid = _ctm_safe_utterance_id(utterance_id)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(";; CTM word timings (NIST-style). LingWhistX WX-608.\n")
        handle.write(";; Columns: utterance channel start_sec duration_sec word confidence\n")
        for row in word_rows:
            w = _ctm_sanitize_token(str(row.get("word", "")))
            start_v = row.get("start")
            end_v = row.get("end")
            try:
                start = float(start_v) if start_v is not None else 0.0
            except (TypeError, ValueError):
                start = 0.0
            try:
                end = float(end_v) if end_v is not None else start
            except (TypeError, ValueError):
                end = start
            dur = max(0.0, end - start)
            conf_v = row.get("confidence")
            try:
                conf = float(conf_v) if conf_v is not None else 1.0
            except (TypeError, ValueError):
                conf = 1.0
            handle.write(f"{uid} 1 {start:.4f} {dur:.4f} {w} {conf:.4f}\n")


def try_write_parquet_dataset_tables(
    dataset_dir: str,
    word_rows: list[dict],
    pause_rows: list[dict],
    ipu_rows: list[dict],
) -> dict[str, str]:
    """
    Optional Parquet mirrors of CSV tables. Requires pandas + pyarrow (pip install pandas pyarrow).
    Returns mapping artifact_key -> absolute path for files actually written.
    """
    out: dict[str, str] = {}
    try:
        import pandas as pd
    except ImportError:
        return out
    try:
        import pyarrow  # noqa: F401
    except ImportError:
        return out

    os.makedirs(dataset_dir, exist_ok=True)
    if word_rows:
        p = os.path.join(dataset_dir, "words.parquet")
        pd.DataFrame(word_rows).to_parquet(p, index=False)
        out["words_parquet"] = p
    if pause_rows:
        p = os.path.join(dataset_dir, "pauses.parquet")
        pd.DataFrame(pause_rows).to_parquet(p, index=False)
        out["pauses_parquet"] = p
    if ipu_rows:
        p = os.path.join(dataset_dir, "ipus.parquet")
        pd.DataFrame(ipu_rows).to_parquet(p, index=False)
        out["ipus_parquet"] = p
    return out


def write_open_science_dataset_readme(
    path: str,
    audio_basename: str,
    parquet_written: dict[str, str],
) -> None:
    """README under output_dir/dataset/ describing the Open Science layout (WX-608)."""
    lines = [
        f"# Dataset bundle — `{audio_basename}`",
        "",
        "This folder is produced when `--export_parquet_dataset True` is used with data-science exports.",
        "Tabular content mirrors the parent directory CSVs (`*.words.csv`, `*.pauses.csv`, `*.ipu.csv`).",
        "",
        "## Layout",
        "",
        "- `README.md` — this file",
        "- `words.parquet` — word-level alignment (if pandas+pyarrow available)",
        "- `pauses.parquet` — pause intervals",
        "- `ipus.parquet` — inter-pausal units",
        "",
        "Sibling files (run root) include `*.words.ctm` (NIST-style word timings) when `--export_word_ctm True`.",
        "Speaker-level RTTM remains optional via `--export_annotation_rttm` (WX-311), not duplicated here.",
        "",
        "## Parquet dependencies",
        "",
        "```bash",
        "pip install pandas pyarrow",
        "```",
        "",
        "## One-liner (pandas)",
        "",
        "```python",
        "import pandas as pd",
        'words = pd.read_parquet("words.parquet")',
        "print(words.head())",
        "```",
        "",
    ]
    if not parquet_written:
        lines.extend(
            [
                "## Note",
                "",
                "Parquet files were not written (missing pandas/pyarrow or empty tables).",
                "",
            ]
        )
    else:
        lines.extend(["## Written in this run", ""])
        for k, abs_p in sorted(parquet_written.items()):
            lines.append(f"- `{os.path.basename(abs_p)}` (`{k}`)")
        lines.append("")

    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


def write_data_science_exports(
    output_dir: str,
    audio_path: str,
    result: dict,
    run_metadata: Optional[dict] = None,
    *,
    export_word_ctm: bool = True,
    export_parquet_dataset: bool = False,
) -> dict[str, str]:
    """
    Export normalized data-science artifacts derived from canonical timeline.

    Returns a mapping of artifact keys to generated absolute file paths.
    """
    os.makedirs(output_dir, exist_ok=True)
    audio_basename = os.path.splitext(os.path.basename(audio_path))[0]

    timeline_payload = result.get("timeline")
    if not isinstance(timeline_payload, dict):
        timeline_payload = {
            "version": 1,
            "words": [],
            "segments": [],
            "speaker_turns": [],
            "events": [],
            "analysis": {
                "config": {},
                "pauses": [],
                "nonspeech_intervals": [],
                "ipus": [],
                "transitions": [],
                "overlaps": [],
            },
        }

    analysis_payload = timeline_payload.get("analysis")
    if not isinstance(analysis_payload, dict):
        analysis_payload = {}

    words_payload = timeline_payload.get("words")
    words = words_payload if isinstance(words_payload, list) else []
    pauses_payload = analysis_payload.get("pauses")
    pauses = pauses_payload if isinstance(pauses_payload, list) else []
    ipus_payload = analysis_payload.get("ipus")
    ipus = ipus_payload if isinstance(ipus_payload, list) else []

    timeline_path = os.path.join(output_dir, f"{audio_basename}.timeline.json")
    words_csv_path = os.path.join(output_dir, f"{audio_basename}.words.csv")
    pauses_csv_path = os.path.join(output_dir, f"{audio_basename}.pauses.csv")
    ipu_csv_path = os.path.join(output_dir, f"{audio_basename}.ipu.csv")
    run_json_path = os.path.join(output_dir, f"{audio_basename}.run.json")
    timeline_jsonl_path = os.path.join(output_dir, f"{audio_basename}.timeline.jsonl")
    raw_segs = timeline_payload.get("segments")
    segments_srt_path, segments_vtt_path = _write_segments_srt_vtt(
        output_dir,
        audio_basename,
        raw_segs if isinstance(raw_segs, list) else [],
    )

    with open(timeline_path, "w", encoding="utf-8") as handle:
        json.dump(timeline_payload, handle, ensure_ascii=False, indent=2)

    def _timeline_jsonl_lines() -> list[dict]:
        lines: list[dict] = []
        for w in words:
            if isinstance(w, dict):
                lines.append({"object": "word", "data": w})
        segs = timeline_payload.get("segments")
        if isinstance(segs, list):
            for s in segs:
                if isinstance(s, dict):
                    lines.append({"object": "segment", "data": s})
        st = timeline_payload.get("speaker_turns")
        if isinstance(st, list):
            for t in st:
                if isinstance(t, dict):
                    lines.append({"object": "speaker_turn", "data": t})
        if isinstance(analysis_payload, dict):
            for p in pauses:
                if isinstance(p, dict):
                    lines.append({"object": "pause", "data": p})
            for ipu in ipus:
                if isinstance(ipu, dict):
                    lines.append({"object": "ipu", "data": ipu})
            for tr in analysis_payload.get("transitions") or []:
                if isinstance(tr, dict):
                    lines.append({"object": "transition", "data": tr})
            for ov in analysis_payload.get("overlaps") or []:
                if isinstance(ov, dict):
                    lines.append({"object": "overlap", "data": ov})
        return lines

    with open(timeline_jsonl_path, "w", encoding="utf-8") as handle:
        for row in _timeline_jsonl_lines():
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    word_rows: list[dict] = []
    for raw_word in words:
        if not isinstance(raw_word, dict):
            continue
        flags = raw_word.get("flags")
        if isinstance(flags, list):
            flag_text = "|".join(_safe_text(flag) for flag in flags if _safe_text(flag))
        else:
            flag_text = ""
        word_rows.append(
            {
                "speaker": _safe_text(raw_word.get("speaker")),
                "word": _safe_text(raw_word.get("token")),
                "start": _safe_float(raw_word.get("start")),
                "end": _safe_float(raw_word.get("end")),
                "confidence": _safe_float(raw_word.get("confidence")),
                "flags": flag_text,
            }
        )
    _write_csv_rows(
        words_csv_path,
        ["speaker", "word", "start", "end", "confidence", "flags"],
        word_rows,
    )

    pause_rows: list[dict] = []
    for raw_pause in pauses:
        if not isinstance(raw_pause, dict):
            continue
        pause_rows.append(
            {
                "speaker": _safe_text(raw_pause.get("speaker")),
                "start": _safe_float(raw_pause.get("start")),
                "end": _safe_float(raw_pause.get("end")),
                "dur": _safe_float(raw_pause.get("dur")),
                "type": _safe_text(raw_pause.get("type")),
            }
        )
    _write_csv_rows(
        pauses_csv_path,
        ["speaker", "start", "end", "dur", "type"],
        pause_rows,
    )

    ipu_rows: list[dict] = []
    for raw_ipu in ipus:
        if not isinstance(raw_ipu, dict):
            continue
        ipu_rows.append(
            {
                "speaker": _safe_text(raw_ipu.get("speaker")),
                "start": _safe_float(raw_ipu.get("start")),
                "end": _safe_float(raw_ipu.get("end")),
                "text": _safe_text(raw_ipu.get("text")),
                "n_words": _safe_int(raw_ipu.get("n_words")),
                "dur": _safe_float(raw_ipu.get("dur")),
            }
        )
    _write_csv_rows(
        ipu_csv_path,
        ["speaker", "start", "end", "text", "n_words", "dur"],
        ipu_rows,
    )

    word_ctm_path = os.path.join(output_dir, f"{audio_basename}.words.ctm")
    if export_word_ctm and word_rows:
        write_word_ctm(word_ctm_path, audio_basename, word_rows)

    dataset_dir = os.path.join(output_dir, "dataset")
    dataset_readme_path = os.path.join(dataset_dir, "README.md")
    parquet_written: dict[str, str] = {}
    if export_parquet_dataset:
        os.makedirs(dataset_dir, exist_ok=True)
        parquet_written = try_write_parquet_dataset_tables(
            dataset_dir, word_rows, pause_rows, ipu_rows
        )
        write_open_science_dataset_readme(dataset_readme_path, audio_basename, parquet_written)

    metadata = dict(run_metadata or {})
    metadata.setdefault("schemaVersion", 1)
    metadata.setdefault(
        "input",
        {"audioPath": os.path.abspath(audio_path)},
    )
    metadata["artifacts"] = {
        "runJson": os.path.basename(run_json_path),
        "timelineJson": os.path.basename(timeline_path),
        "timelineJsonl": os.path.basename(timeline_jsonl_path),
        "segmentsSrt": os.path.basename(segments_srt_path),
        "segmentsVtt": os.path.basename(segments_vtt_path),
        "wordsCsv": os.path.basename(words_csv_path),
        "pausesCsv": os.path.basename(pauses_csv_path),
        "ipuCsv": os.path.basename(ipu_csv_path),
    }
    if export_word_ctm and word_rows:
        metadata["artifacts"]["wordCtm"] = os.path.basename(word_ctm_path)
    if export_parquet_dataset:
        metadata["artifacts"]["datasetReadme"] = "dataset/README.md"
        for rel_key, basename in (
            ("wordsParquet", "words.parquet"),
            ("pausesParquet", "pauses.parquet"),
            ("ipusParquet", "ipus.parquet"),
        ):
            p = os.path.join(dataset_dir, basename)
            if os.path.isfile(p):
                metadata["artifacts"][rel_key] = f"dataset/{basename}"
    metadata["counts"] = {
        "segments": len(timeline_payload.get("segments", [])) if isinstance(timeline_payload.get("segments"), list) else 0,
        "words": len(words),
        "speakerTurns": len(timeline_payload.get("speaker_turns", [])) if isinstance(timeline_payload.get("speaker_turns"), list) else 0,
        "events": len(timeline_payload.get("events", [])) if isinstance(timeline_payload.get("events"), list) else 0,
        "pauses": len(pauses),
        "ipus": len(ipus),
    }

    with open(run_json_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)

    from whisperx.run_manifest import RunManifestBuildInput, build_run_manifest_v1, write_run_manifest_v1_file

    artifact_rel = {
        "run_json": os.path.basename(run_json_path),
        "timeline_json": os.path.basename(timeline_path),
        "timeline_jsonl": os.path.basename(timeline_jsonl_path),
        "segments_srt": os.path.basename(segments_srt_path),
        "segments_vtt": os.path.basename(segments_vtt_path),
        "words_csv": os.path.basename(words_csv_path),
        "pauses_csv": os.path.basename(pauses_csv_path),
        "ipu_csv": os.path.basename(ipu_csv_path),
    }
    if export_word_ctm and word_rows:
        artifact_rel["word_ctm"] = os.path.basename(word_ctm_path)
    if export_parquet_dataset:
        artifact_rel["dataset_readme"] = "dataset/README.md"
        for basename in ("words.parquet", "pauses.parquet", "ipus.parquet"):
            p = os.path.join(dataset_dir, basename)
            if os.path.isfile(p):
                key = basename.replace(".", "_")
                artifact_rel[key] = f"dataset/{basename}"
    manifest_inp = RunManifestBuildInput(
        output_dir=output_dir,
        audio_path=audio_path,
        artifact_keys_to_rel_path=artifact_rel,
        run_metadata=metadata,
        run_id=metadata.get("runId") if isinstance(metadata.get("runId"), str) else None,
        warnings=list(w) if isinstance((w := metadata.get("warnings")), list) else [],
        pipeline_chunking=result.get("pipeline_chunking") if isinstance(result, dict) else None,
    )
    manifest_payload = build_run_manifest_v1(manifest_inp)
    run_manifest_path = write_run_manifest_v1_file(output_dir, manifest_payload)

    out_paths: dict[str, str] = {
        "run_json": run_json_path,
        "timeline_json": timeline_path,
        "timeline_jsonl": timeline_jsonl_path,
        "segments_srt": segments_srt_path,
        "segments_vtt": segments_vtt_path,
        "words_csv": words_csv_path,
        "pauses_csv": pauses_csv_path,
        "ipu_csv": ipu_csv_path,
        "run_manifest_json": run_manifest_path,
    }
    if export_word_ctm and word_rows:
        out_paths["word_ctm"] = word_ctm_path
    if export_parquet_dataset:
        out_paths["dataset_readme"] = dataset_readme_path
        out_paths.update({k: v for k, v in parquet_written.items()})
    return out_paths

def interpolate_nans(x, method='nearest'):
    if x.notnull().sum() > 1:
        return x.interpolate(method=method).ffill().bfill()
    else:
        return x.ffill().bfill()
