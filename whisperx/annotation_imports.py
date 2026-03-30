"""
WX-673/674 — Parse ELAN EAF and Praat TextGrid annotation files for import.

Supports:
  EAF  (WX-673): ELAN 2.7 + 3.0, ALIGNABLE_ANNOTATION + REF_ANNOTATION,
                  multi-tier, LINKED_FILE_DESCRIPTOR / MEDIA_DESCRIPTOR resolution.
  TextGrid (WX-674): Praat long format and short format, IntervalTier + PointTier,
                      UTF-8 BOM / Latin-1 encoding detection, multi-line text.
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "parse_eaf",
    "parse_textgrid",
    "ImportedAnnotation",
]


# ─── Result type ─────────────────────────────────────────────────────────────


@dataclass
class ImportedAnnotation:
    """Parsed annotation file, format-agnostic."""

    tiers: list[dict[str, Any]]
    """One entry per tier: {"tier_id": str, "segments": [{"start": float, "end": float, "text": str}]}"""

    media_path: str | None
    """Resolved absolute path to the linked media file, or None if not found."""

    duration_s: float
    """Estimated audio duration in seconds (from annotations or file metadata)."""

    source_format: str
    """'eaf' or 'textgrid'."""

    warnings: list[str] = field(default_factory=list)
    """Non-fatal issues encountered during parsing."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "tiers": self.tiers,
            "media_path": self.media_path,
            "duration_s": self.duration_s,
            "source_format": self.source_format,
            "warnings": self.warnings,
        }


# ─── EAF parser (WX-673) ─────────────────────────────────────────────────────


def parse_eaf(path: str) -> ImportedAnnotation:
    """
    Parse an ELAN EAF file and return tiers with time-aligned segments.

    Handles:
    - ALIGNABLE_ANNOTATION (direct TIME_SLOT timing)
    - REF_ANNOTATION (inherits timing from referenced annotation, recursively)
    - One output tier per TIER element in the file
    - Media path resolution via MEDIA_DESCRIPTOR and LINKED_FILE_DESCRIPTOR
    """
    eaf_dir = os.path.dirname(os.path.abspath(path))
    warnings: list[str] = []

    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:
        raise ValueError(f"EAF XML parse error in '{path}': {exc}") from exc

    root = tree.getroot()

    # ── 1. Build time-slot lookup: slot_id → milliseconds ─────────────────
    time_slots: dict[str, int] = {}
    for ts in root.iter("TIME_SLOT"):
        slot_id = ts.get("TIME_SLOT_ID", "")
        slot_val = ts.get("TIME_VALUE")
        if not slot_id or slot_val is None:
            continue
        try:
            time_slots[slot_id] = int(slot_val)
        except (ValueError, TypeError):
            warnings.append(f"Invalid TIME_VALUE '{slot_val}' for TIME_SLOT '{slot_id}'")

    # ── 2. Build annotation map: ann_id → record ───────────────────────────
    # Two passes: first collect all annotations, then resolve REF timings.
    ann_by_id: dict[str, dict[str, Any]] = {}

    for tier_el in root.iter("TIER"):
        for ann_wrapper in tier_el:
            if ann_wrapper.tag != "ANNOTATION":
                continue
            for child in ann_wrapper:
                ann_id = child.get("ANNOTATION_ID", "")
                val_el = child.find("ANNOTATION_VALUE")
                text = (val_el.text or "").strip() if val_el is not None else ""

                if child.tag == "ALIGNABLE_ANNOTATION":
                    ts1 = child.get("TIME_SLOT_REF1", "")
                    ts2 = child.get("TIME_SLOT_REF2", "")
                    start_ms = time_slots.get(ts1)
                    end_ms = time_slots.get(ts2)
                    if not ann_id:
                        continue
                    if start_ms is None or end_ms is None:
                        warnings.append(
                            f"Annotation '{ann_id}': unresolved time slot "
                            f"(REF1='{ts1}', REF2='{ts2}')"
                        )
                        continue
                    ann_by_id[ann_id] = {
                        "type": "alignable",
                        "start_ms": min(start_ms, end_ms),
                        "end_ms": max(start_ms, end_ms),
                        "text": text,
                    }

                elif child.tag == "REF_ANNOTATION":
                    ann_ref = child.get("ANNOTATION_REF", "")
                    if not ann_id:
                        continue
                    ann_by_id[ann_id] = {
                        "type": "ref",
                        "ann_ref": ann_ref,
                        "text": text,
                    }

    # Resolve REF_ANNOTATION timing (recursive, with cycle guard)
    def _resolve(ann_id: str, seen: set[str]) -> tuple[int, int] | None:
        if ann_id in seen:
            return None  # cycle
        rec = ann_by_id.get(ann_id)
        if rec is None:
            return None
        if rec["type"] == "alignable":
            return rec["start_ms"], rec["end_ms"]
        seen = seen | {ann_id}
        return _resolve(rec.get("ann_ref", ""), seen)

    for ann_id, rec in ann_by_id.items():
        if rec["type"] == "ref" and "start_ms" not in rec:
            timing = _resolve(ann_id, set())
            if timing:
                rec["start_ms"], rec["end_ms"] = timing
            else:
                warnings.append(
                    f"REF_ANNOTATION '{ann_id}' → '{rec.get('ann_ref')}': "
                    "could not resolve timing (unresolved chain or cycle)"
                )

    # ── 3. Build tiers ─────────────────────────────────────────────────────
    tiers: list[dict[str, Any]] = []
    max_end_ms = 0

    for tier_el in root.iter("TIER"):
        tier_id = (tier_el.get("TIER_ID") or "").strip()
        if not tier_id:
            continue

        segments: list[dict[str, Any]] = []
        for ann_wrapper in tier_el:
            if ann_wrapper.tag != "ANNOTATION":
                continue
            for child in ann_wrapper:
                ann_id = child.get("ANNOTATION_ID", "")
                rec = ann_by_id.get(ann_id)
                if rec is None or "start_ms" not in rec:
                    continue
                start_s = rec["start_ms"] / 1000.0
                end_s = rec["end_ms"] / 1000.0
                segments.append({"start": start_s, "end": end_s, "text": rec["text"]})
                max_end_ms = max(max_end_ms, rec["end_ms"])

        segments.sort(key=lambda s: s["start"])
        tiers.append({"tier_id": tier_id, "segments": segments})

    # ── 4. Resolve media path ──────────────────────────────────────────────
    media_path: str | None = None

    # EAF 3.0: HEADER > MEDIA_DESCRIPTOR
    for desc in root.iter("MEDIA_DESCRIPTOR"):
        for attr in ("MEDIA_URL", "RELATIVE_MEDIA_URL"):
            url = desc.get(attr, "")
            candidate = _resolve_file_url(url, eaf_dir)
            if candidate and os.path.isfile(candidate):
                media_path = candidate
                break
        if media_path:
            break

    # EAF 2.x fallback: LINKED_FILE_DESCRIPTOR
    if media_path is None:
        for lfd in root.iter("LINKED_FILE_DESCRIPTOR"):
            for attr in ("LINK_URL", "RELATIVE_LINK_URL"):
                url = lfd.get(attr, "")
                candidate = _resolve_file_url(url, eaf_dir)
                if candidate and os.path.isfile(candidate):
                    media_path = candidate
                    break
            if media_path:
                break

    duration_s = max_end_ms / 1000.0

    return ImportedAnnotation(
        tiers=tiers,
        media_path=media_path,
        duration_s=duration_s,
        source_format="eaf",
        warnings=warnings,
    )


def _resolve_file_url(url: str, base_dir: str) -> str | None:
    """
    Convert a MEDIA_URL or RELATIVE_MEDIA_URL value to an absolute filesystem path.

    Handles:
    - 'file:///path/to/file'  (Unix)
    - 'file:///C:/path/file'  (Windows)
    - 'file://localhost/path'
    - relative paths (resolved against base_dir)
    - absolute paths (returned as-is after normpath)
    """
    if not url:
        return None

    if url.startswith("file://"):
        rest = url[7:]  # strip "file://"
        # Strip optional "localhost" host
        if rest.startswith("localhost/"):
            rest = rest[9:]
        # Windows: "/C:/..." → "C:/..."
        if re.match(r"^/[A-Za-z]:[/\\]", rest):
            rest = rest[1:]
        return os.path.normpath(rest)

    if os.path.isabs(url):
        return os.path.normpath(url)

    # Relative
    return os.path.normpath(os.path.join(base_dir, url))


# ─── TextGrid parser (WX-674) ─────────────────────────────────────────────────


def parse_textgrid(path: str) -> ImportedAnnotation:
    """
    Parse a Praat TextGrid file (long or short format).

    Handles:
    - Long format: labeled key = value blocks (standard Praat output)
    - Short format: "ooTextFile short", values on successive lines
    - IntervalTier: segments with xmin/xmax and text
    - PointTier: point events (start = end = time; zero-duration)
    - Encodings: UTF-8 BOM, UTF-8, Latin-1 fallback
    - Multi-line text values (quoted, "" escape for literal quotes)
    - Empty intervals silently skipped
    """
    warnings: list[str] = []
    content = _read_textgrid(path, warnings)
    lines = content.splitlines()

    if len(lines) < 3:
        raise ValueError(f"TextGrid file too short (< 3 lines): '{path}'")

    first_line = lines[0].strip()
    is_short = "short" in first_line.lower()

    if is_short:
        tiers, duration_s = _parse_textgrid_short(lines, warnings)
    else:
        tiers, duration_s = _parse_textgrid_long(lines, warnings)

    return ImportedAnnotation(
        tiers=tiers,
        media_path=None,  # TextGrid files do not embed media links
        duration_s=duration_s,
        source_format="textgrid",
        warnings=warnings,
    )


def _read_textgrid(path: str, warnings: list[str]) -> str:
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", errors="replace")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        warnings.append("Not valid UTF-8 — falling back to Latin-1 (ISO-8859-1)")
        try:
            return raw.decode("latin-1")
        except UnicodeDecodeError:
            return raw.decode("utf-8", errors="replace")


# ── Long format ───────────────────────────────────────────────────────────────


def _parse_textgrid_long(
    lines: list[str], warnings: list[str]
) -> tuple[list[dict[str, Any]], float]:
    """Parse long-format TextGrid. Returns (tiers, duration_s)."""
    # Find global xmax
    duration_s = 0.0
    for line in lines[:20]:
        m = re.match(r"\s*xmax\s*=\s*(.+)", line)
        if m:
            try:
                duration_s = float(m.group(1).strip())
                break
            except ValueError:
                pass

    tiers: list[dict[str, Any]] = []
    i = 0
    n = len(lines)

    while i < n:
        stripped = lines[i].strip()
        # Top-level item [N]: (not "item []:")
        if re.match(r"item\s*\[\d+\]\s*:\s*$", stripped):
            tier, i = _parse_tier_long(lines, i + 1, warnings)
            if tier is not None:
                tiers.append(tier)
        else:
            i += 1

    return tiers, duration_s


def _parse_tier_long(
    lines: list[str], start: int, warnings: list[str]
) -> tuple[dict[str, Any] | None, int]:
    """
    Parse one tier block starting at line *start*.
    Returns (tier_dict | None, next_line_index).
    """
    n = len(lines)
    i = start
    tier_class: str | None = None
    tier_name: str | None = None
    intervals: list[dict[str, Any]] = []
    points: list[dict[str, Any]] = []

    while i < n:
        stripped = lines[i].strip()

        # Next top-level item → stop parsing this tier
        if re.match(r"item\s*\[\d+\]\s*:\s*$", stripped):
            break

        if re.match(r"class\s*=", stripped):
            tier_class = _extract_quoted(stripped)
        elif re.match(r"name\s*=", stripped):
            tier_name = _extract_quoted(stripped)
        elif re.match(r"intervals\s*\[\d+\]\s*:\s*$", stripped):
            iv, i = _parse_interval_long(lines, i + 1, warnings)
            if iv is not None:
                intervals.append(iv)
            continue
        elif re.match(r"points\s*\[\d+\]\s*:\s*$", stripped):
            pt, i = _parse_point_long(lines, i + 1, warnings)
            if pt is not None:
                points.append(pt)
            continue

        i += 1

    if not tier_name:
        return None, i

    segments = _tier_items_to_segments(
        tier_class or "", intervals, points, warnings
    )
    return {"tier_id": tier_name, "segments": segments}, i


def _parse_interval_long(
    lines: list[str], start: int, warnings: list[str]
) -> tuple[dict[str, Any] | None, int]:
    """Parse one intervals [N]: block. Returns (interval_dict | None, next_i)."""
    n = len(lines)
    i = start
    xmin: float | None = None
    xmax_val: float | None = None
    text: str | None = None

    while i < n:
        stripped = lines[i].strip()
        if (
            re.match(r"intervals\s*\[\d+\]\s*:\s*$", stripped)
            or re.match(r"points\s*\[\d+\]\s*:\s*$", stripped)
            or re.match(r"item\s*\[\d+\]\s*:\s*$", stripped)
        ):
            break

        if re.match(r"xmin\s*=", stripped):
            try:
                xmin = float(stripped.split("=", 1)[1].strip())
            except ValueError:
                pass
        elif re.match(r"xmax\s*=", stripped):
            try:
                xmax_val = float(stripped.split("=", 1)[1].strip())
            except ValueError:
                pass
        elif re.match(r"text\s*=", stripped):
            text, i = _parse_text_value_long(lines, i, warnings)
            continue

        i += 1

    if xmin is None or xmax_val is None:
        return None, i
    return {"xmin": xmin, "xmax": xmax_val, "text": text or ""}, i


def _parse_point_long(
    lines: list[str], start: int, warnings: list[str]
) -> tuple[dict[str, Any] | None, int]:
    """Parse one points [N]: block. Returns (point_dict | None, next_i)."""
    n = len(lines)
    i = start
    time_val: float | None = None
    mark: str | None = None

    while i < n:
        stripped = lines[i].strip()
        if (
            re.match(r"points\s*\[\d+\]\s*:\s*$", stripped)
            or re.match(r"intervals\s*\[\d+\]\s*:\s*$", stripped)
            or re.match(r"item\s*\[\d+\]\s*:\s*$", stripped)
        ):
            break

        if re.match(r"(time|number)\s*=", stripped):
            try:
                time_val = float(stripped.split("=", 1)[1].strip())
            except ValueError:
                pass
        elif re.match(r"(mark|value)\s*=", stripped):
            mark, i = _parse_text_value_long(lines, i, warnings)
            continue

        i += 1

    if time_val is None:
        return None, i
    return {"time": time_val, "mark": mark or ""}, i


def _parse_text_value_long(
    lines: list[str], i: int, warnings: list[str]
) -> tuple[str, int]:
    """
    Parse a 'text = "..."' or 'mark = "..."' value that may span multiple lines.
    Returns (text_content, next_line_index).
    Praat uses "" to escape a literal " inside the value.
    """
    line = lines[i]
    eq_pos = line.find("=")
    if eq_pos < 0:
        return "", i + 1

    after_eq = line[eq_pos + 1 :].strip()

    if not after_eq.startswith('"'):
        # Unquoted (rare but possible for numbers)
        return after_eq, i + 1

    # Strip opening quote and try to read the full value
    accumulated = after_eq[1:]  # drop opening "
    n = len(lines)

    while True:
        text, complete = _consume_quoted(accumulated)
        if complete:
            return text, i + 1
        # Value continues on the next line
        i += 1
        if i >= n:
            warnings.append("Reached end of file inside a quoted text value")
            return accumulated.replace('""', '"'), i
        accumulated += "\n" + lines[i]


def _consume_quoted(s: str) -> tuple[str, bool]:
    """
    Consume quoted content up to an unescaped closing '"'.
    Returns (text_without_outer_quotes, is_complete).
    '""' inside the content is decoded as a literal '"'.
    """
    result: list[str] = []
    pos = 0
    while pos < len(s):
        c = s[pos]
        if c == '"':
            if pos + 1 < len(s) and s[pos + 1] == '"':
                result.append('"')
                pos += 2
            else:
                return "".join(result), True
        else:
            result.append(c)
            pos += 1
    return "".join(result), False


def _extract_quoted(line: str) -> str:
    """Extract the string value from a 'key = "value"' line."""
    eq_pos = line.find("=")
    if eq_pos < 0:
        return ""
    after = line[eq_pos + 1 :].strip()
    if after.startswith('"') and after.endswith('"') and len(after) >= 2:
        return after[1:-1].replace('""', '"')
    return after


# ── Short format ──────────────────────────────────────────────────────────────


def _parse_textgrid_short(
    lines: list[str], warnings: list[str]
) -> tuple[list[dict[str, Any]], float]:
    """
    Parse short-format TextGrid.  Values appear without labels, one per line.

    Short header layout (lines after stripping whitespace):
      0: File type = "ooTextFile short"
      1: "TextGrid"
      2: <xmin>
      3: <xmax>
      4: <exists> | <absent>
      5: <n_tiers>
    Then for each tier:
      "IntervalTier" | "TextTier" | "PointTier"
      "<tier_name>"
      <xmin>
      <xmax>
      <n_items>
      For IntervalTier items:
        <xmin>
        <xmax>
        "<text>"
      For PointTier items:
        <time>
        "<mark>"
    """
    # Strip blank lines and comments for a clean token stream
    tokens: list[str] = [ln.strip() for ln in lines if ln.strip()]

    # Skip header tokens (file type line is token 0; "TextGrid" is token 1)
    i = 2  # skip to xmin

    duration_s = 0.0
    try:
        _float_token(tokens, i)  # xmin (global)
        i += 1
        duration_s = _float_token(tokens, i)  # xmax (global)
        i += 1
    except (IndexError, ValueError):
        warnings.append("Could not read global xmin/xmax in short TextGrid")

    # Skip <exists> flag and tier count
    i += 1  # <exists>
    try:
        n_tiers = int(tokens[i])
        i += 1
    except (IndexError, ValueError):
        warnings.append("Could not read tier count in short TextGrid")
        return [], duration_s

    tiers: list[dict[str, Any]] = []
    for _ in range(n_tiers):
        if i >= len(tokens):
            break
        tier, i = _parse_tier_short(tokens, i, warnings)
        if tier is not None:
            tiers.append(tier)

    return tiers, duration_s


def _parse_tier_short(
    tokens: list[str], i: int, warnings: list[str]
) -> tuple[dict[str, Any] | None, int]:
    if i + 4 >= len(tokens):
        return None, i + 5

    tier_class = tokens[i].strip('"')
    tier_name = tokens[i + 1].strip('"').replace('""', '"')
    i += 4  # skip class, name, xmin, xmax

    try:
        n_items = int(tokens[i])
        i += 1
    except (IndexError, ValueError):
        warnings.append(f"Could not read item count for tier '{tier_name}'")
        return None, i + 1

    intervals: list[dict[str, Any]] = []
    points: list[dict[str, Any]] = []
    is_point = "point" in tier_class.lower()

    for _ in range(n_items):
        if is_point:
            if i + 1 >= len(tokens):
                break
            try:
                t = float(tokens[i])
            except ValueError:
                i += 2
                continue
            mark = tokens[i + 1].strip('"').replace('""', '"')
            points.append({"time": t, "mark": mark})
            i += 2
        else:
            if i + 2 >= len(tokens):
                break
            try:
                xmin = float(tokens[i])
                xmax_val = float(tokens[i + 1])
            except ValueError:
                i += 3
                continue
            text_tok = tokens[i + 2]
            # Handle multi-line quoted values that ended up on one token
            text = text_tok.strip('"').replace('""', '"')
            intervals.append({"xmin": xmin, "xmax": xmax_val, "text": text})
            i += 3

    segments = _tier_items_to_segments(tier_class, intervals, points, warnings)
    return {"tier_id": tier_name, "segments": segments}, i


def _float_token(tokens: list[str], i: int) -> float:
    return float(tokens[i])


# ── Shared helpers ────────────────────────────────────────────────────────────


def _tier_items_to_segments(
    tier_class: str,
    intervals: list[dict[str, Any]],
    points: list[dict[str, Any]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    """Convert raw intervals/points to canonical segment list (non-empty only)."""
    segments: list[dict[str, Any]] = []

    tc = tier_class.lower()
    # "TextTier" is Praat's long-format name for a point tier
    is_point_tier = "point" in tc or tc == "texttier"

    if not is_point_tier:
        for iv in intervals:
            text = iv.get("text", "").strip()
            if not text:
                continue
            xmin = float(iv["xmin"])
            xmax_v = float(iv["xmax"])
            if xmax_v < xmin:
                xmin, xmax_v = xmax_v, xmin
            segments.append({"start": xmin, "end": xmax_v, "text": text})

    elif is_point_tier:
        for pt in points:
            mark = pt.get("mark", "").strip()
            if not mark:
                continue
            t = float(pt["time"])
            # PointTier: zero-duration event; end = start
            segments.append({"start": t, "end": t, "text": mark})

    segments.sort(key=lambda s: s["start"])
    return segments
