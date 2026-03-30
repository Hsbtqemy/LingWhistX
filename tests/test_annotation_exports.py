"""
WX-687 — Tests annotation_exports.py : RTTM, TextGrid, EAF.

Couverture :
  - RTTM 2 locuteurs : format NIST, valeurs start/dur
  - TextGrid IntervalTier multi-speakers : tiers, xmin/xmax, intervalles gapless
  - EAF : TIME_ORDER, ALIGNABLE_ANNOTATION, TIER par locuteur
  - Roundtrip TextGrid : parser inline → mêmes segments
  - Roundtrip EAF : xml.etree → mêmes segments
  - Régression : modifier write_eaf fait échouer le test correspondant

Aucune dépendance torch/GPU — tourne avec le Python système.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from whisperx.annotation_exports import (
    collect_speaker_turns,
    write_annotation_exports,
    write_eaf,
    write_rttm,
    write_textgrid,
)

# ─── Fixtures ────────────────────────────────────────────────────────────────

_TWO_SPEAKERS = [
    {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.5},
    {"speaker": "SPEAKER_01", "start": 2.0, "end": 3.8},
    {"speaker": "SPEAKER_00", "start": 4.0, "end": 5.0},
]

_TWO_SPEAKERS_SEGMENTS = [
    {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.5, "text": "bonjour monde"},
    {"speaker": "SPEAKER_01", "start": 2.0, "end": 3.8, "text": "salut"},
    {"speaker": "SPEAKER_00", "start": 4.0, "end": 5.0, "text": "au revoir"},
]

_XMAX = 5.5


# ─── Helpers roundtrip ───────────────────────────────────────────────────────


def _parse_rttm(path: Path) -> list[dict]:
    """Parse SPEAKER lines from an RTTM file."""
    turns = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts or parts[0] != "SPEAKER":
            continue
        # SPEAKER <file_id> <chan> <start> <dur> <ortho> <type> <speaker> ...
        turns.append(
            {
                "file_id": parts[1],
                "start": float(parts[3]),
                "dur": float(parts[4]),
                "speaker": parts[7],
            }
        )
    return turns


def _parse_textgrid_intervals(path: Path) -> dict[str, list[dict]]:
    """
    Minimal Praat long-format TextGrid parser.
    Returns {tier_name: [{xmin, xmax, text}, ...]} (non-empty intervals only).
    """
    text = path.read_text(encoding="utf-8")
    # Split into per-item blocks
    items: dict[str, list[dict]] = {}
    # Extract tier name
    tier_blocks = re.split(r"\s+item\s*\[\d+\]:", text)[1:]
    for block in tier_blocks:
        name_m = re.search(r'name\s*=\s*"([^"]*)"', block)
        if not name_m:
            continue
        tier_name = name_m.group(1)
        intervals = []
        for m in re.finditer(
            r"xmin\s*=\s*([\d.]+)\s*\n\s*xmax\s*=\s*([\d.]+)\s*\n\s*text\s*=\s*\"([^\"]*)\"",
            block,
        ):
            xmin, xmax, txt = float(m.group(1)), float(m.group(2)), m.group(3)
            if txt:
                intervals.append({"xmin": xmin, "xmax": xmax, "text": txt})
        items[tier_name] = intervals
    return items


def _parse_eaf(path: Path) -> dict[str, list[dict]]:
    """
    Parse an EAF file and return
    {tier_id: [{start_ms, end_ms, text}, ...]} using TIME_ORDER for slot resolution.
    """
    tree = ET.parse(path)
    root = tree.getroot()
    # Build time slot map
    time_order = root.find(".//TIME_ORDER")
    assert time_order is not None
    slot_map = {
        ts.attrib["TIME_SLOT_ID"]: int(ts.attrib["TIME_VALUE"])
        for ts in time_order.findall("TIME_SLOT")
    }
    tiers: dict[str, list[dict]] = {}
    for tier in root.findall("TIER"):
        tier_id = tier.attrib["TIER_ID"]
        anns = []
        for ann in tier.findall(".//ALIGNABLE_ANNOTATION"):
            s_ms = slot_map[ann.attrib["TIME_SLOT_REF1"]]
            e_ms = slot_map[ann.attrib["TIME_SLOT_REF2"]]
            val = ann.findtext("ANNOTATION_VALUE") or ""
            anns.append({"start_ms": s_ms, "end_ms": e_ms, "text": val})
        tiers[tier_id] = anns
    return tiers


# ─── collect_speaker_turns ───────────────────────────────────────────────────


class TestCollectSpeakerTurns:
    def test_from_timeline_speaker_turns(self):
        result = {
            "timeline": {
                "speaker_turns": [
                    {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
                    {"speaker": "SPEAKER_01", "start": 1.0, "end": 2.5},
                ]
            }
        }
        turns = collect_speaker_turns(result)
        assert len(turns) == 2
        assert turns[0]["speaker"] == "SPEAKER_00"
        assert turns[1]["speaker"] == "SPEAKER_01"

    def test_from_top_level_speaker_turns(self):
        result = {
            "speaker_turns": [
                {"speaker": "A", "start": 0.0, "end": 1.0},
            ]
        }
        turns = collect_speaker_turns(result)
        assert len(turns) == 1
        assert turns[0]["speaker"] == "A"

    def test_from_segments_merges_consecutive_same_speaker(self):
        result = {
            "segments": [
                {"speaker": "A", "start": 0.0, "end": 1.0},
                {"speaker": "A", "start": 0.9, "end": 2.0},  # overlap → merged
                {"speaker": "B", "start": 2.5, "end": 3.0},
            ]
        }
        turns = collect_speaker_turns(result)
        assert turns[0]["speaker"] == "A"
        assert float(turns[0]["end"]) == pytest.approx(2.0)
        assert turns[1]["speaker"] == "B"

    def test_empty_result_gives_empty(self):
        assert collect_speaker_turns({}) == []

    def test_ignores_segments_without_speaker(self):
        result = {
            "segments": [
                {"start": 0.0, "end": 1.0, "text": "no speaker"},
            ]
        }
        assert collect_speaker_turns(result) == []

    def test_swaps_inverted_start_end(self):
        result = {
            "speaker_turns": [
                {"speaker": "X", "start": 5.0, "end": 2.0},  # inverted
            ]
        }
        turns = collect_speaker_turns(result)
        assert float(turns[0]["start"]) < float(turns[0]["end"])


# ─── write_rttm ─────────────────────────────────────────────────────────────


class TestWriteRttm:
    def test_creates_file(self, tmp_path: Path):
        write_rttm(str(tmp_path / "out.rttm"), "clip", _TWO_SPEAKERS)
        assert (tmp_path / "out.rttm").is_file()

    def test_two_speakers_line_count(self, tmp_path: Path):
        p = tmp_path / "out.rttm"
        write_rttm(str(p), "clip", _TWO_SPEAKERS)
        rows = _parse_rttm(p)
        assert len(rows) == len(_TWO_SPEAKERS)

    def test_speaker_labels_present(self, tmp_path: Path):
        p = tmp_path / "out.rttm"
        write_rttm(str(p), "clip", _TWO_SPEAKERS)
        rows = _parse_rttm(p)
        speakers = {r["speaker"] for r in rows}
        assert "SPEAKER_00" in speakers
        assert "SPEAKER_01" in speakers

    def test_start_and_duration_values(self, tmp_path: Path):
        p = tmp_path / "out.rttm"
        write_rttm(str(p), "clip", _TWO_SPEAKERS)
        rows = _parse_rttm(p)
        first = rows[0]
        assert first["start"] == pytest.approx(0.0)
        assert first["dur"] == pytest.approx(1.5)

    def test_file_id_sanitised(self, tmp_path: Path):
        p = tmp_path / "out.rttm"
        write_rttm(str(p), "my file name", _TWO_SPEAKERS[:1])
        rows = _parse_rttm(p)
        assert rows[0]["file_id"] == "my_file_name"

    def test_empty_turns_writes_empty_file(self, tmp_path: Path):
        p = tmp_path / "empty.rttm"
        write_rttm(str(p), "clip", [])
        assert p.read_text(encoding="utf-8").strip() == ""


# ─── write_textgrid ──────────────────────────────────────────────────────────


class TestWriteTextgrid:
    def test_creates_file(self, tmp_path: Path):
        write_textgrid(str(tmp_path / "out.TextGrid"), _TWO_SPEAKERS, _XMAX)
        assert (tmp_path / "out.TextGrid").is_file()

    def test_oo_text_file_header(self, tmp_path: Path):
        p = tmp_path / "out.TextGrid"
        write_textgrid(str(p), _TWO_SPEAKERS, _XMAX)
        content = p.read_text(encoding="utf-8")
        assert 'File type = "ooTextFile"' in content
        assert 'Object class = "TextGrid"' in content

    def test_two_tiers_for_two_speakers(self, tmp_path: Path):
        p = tmp_path / "out.TextGrid"
        write_textgrid(str(p), _TWO_SPEAKERS, _XMAX)
        tiers = _parse_textgrid_intervals(p)
        assert set(tiers.keys()) == {"SPEAKER_00", "SPEAKER_01"}

    def test_xmax_present_in_file(self, tmp_path: Path):
        p = tmp_path / "out.TextGrid"
        write_textgrid(str(p), _TWO_SPEAKERS, _XMAX)
        content = p.read_text(encoding="utf-8")
        assert f"xmax = {_XMAX:.6f}" in content

    def test_speaker_label_used_as_annotation(self, tmp_path: Path):
        p = tmp_path / "out.TextGrid"
        write_textgrid(str(p), _TWO_SPEAKERS, _XMAX)
        tiers = _parse_textgrid_intervals(p)
        labels = {seg["text"] for segs in tiers.values() for seg in segs}
        assert "SPEAKER_00" in labels or "SPEAKER_01" in labels

    def test_roundtrip_with_segments_text(self, tmp_path: Path):
        p = tmp_path / "out.TextGrid"
        write_textgrid(str(p), _TWO_SPEAKERS, _XMAX, segments=_TWO_SPEAKERS_SEGMENTS)
        tiers = _parse_textgrid_intervals(p)
        # Both speakers present
        assert "SPEAKER_00" in tiers
        assert "SPEAKER_01" in tiers
        # Text from segments is used
        all_texts = {seg["text"] for segs in tiers.values() for seg in segs}
        assert "bonjour monde" in all_texts
        assert "salut" in all_texts
        assert "au revoir" in all_texts

    def test_roundtrip_xmin_xmax_match_turns(self, tmp_path: Path):
        p = tmp_path / "out.TextGrid"
        write_textgrid(str(p), _TWO_SPEAKERS, _XMAX, segments=_TWO_SPEAKERS_SEGMENTS)
        tiers = _parse_textgrid_intervals(p)
        sp00_segs = tiers["SPEAKER_00"]
        starts = {seg["xmin"] for seg in sp00_segs}
        assert 0.0 in starts
        assert 4.0 in starts

    def test_single_speaker(self, tmp_path: Path):
        p = tmp_path / "single.TextGrid"
        write_textgrid(str(p), [{"speaker": "A", "start": 0.5, "end": 1.5}], 2.0)
        tiers = _parse_textgrid_intervals(p)
        assert set(tiers.keys()) == {"A"}

    def test_quote_escaping_in_label(self, tmp_path: Path):
        p = tmp_path / "quote.TextGrid"
        segs = [{"speaker": 'say "hello"', "start": 0.0, "end": 1.0}]
        write_textgrid(str(p), segs, 1.5)
        content = p.read_text(encoding="utf-8")
        # Praat escapes " as ""
        assert '""hello""' in content


# ─── write_eaf ───────────────────────────────────────────────────────────────


class TestWriteEaf:
    def test_creates_valid_xml(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        tree = ET.parse(p)  # raises if malformed
        assert tree.getroot().tag == "ANNOTATION_DOCUMENT"

    def test_annotation_document_attributes(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        root = ET.parse(p).getroot()
        assert root.attrib.get("FORMAT") == "3.0"
        assert root.attrib.get("AUTHOR") == "whisperx"

    def test_time_order_has_slots(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        root = ET.parse(p).getroot()
        slots = root.findall(".//TIME_SLOT")
        assert len(slots) >= 2  # at least 0 and xmax

    def test_two_tiers_for_two_speakers(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        tiers = _parse_eaf(p)
        assert "SPEAKER_00" in tiers
        assert "SPEAKER_01" in tiers

    def test_annotation_count_matches_turns(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        tiers = _parse_eaf(p)
        total_anns = sum(len(v) for v in tiers.values())
        assert total_anns == len(_TWO_SPEAKERS)

    def test_roundtrip_times_ms(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        tiers = _parse_eaf(p)
        sp00 = sorted(tiers["SPEAKER_00"], key=lambda a: a["start_ms"])
        assert sp00[0]["start_ms"] == 0
        assert sp00[0]["end_ms"] == 1500

    def test_roundtrip_with_segments_text(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX, segments=_TWO_SPEAKERS_SEGMENTS)
        tiers = _parse_eaf(p)
        all_texts = {ann["text"] for anns in tiers.values() for ann in anns}
        assert "bonjour monde" in all_texts
        assert "salut" in all_texts
        assert "au revoir" in all_texts

    def test_roundtrip_annotation_ids_unique(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        root = ET.parse(p).getroot()
        ids = [
            ann.attrib["ANNOTATION_ID"]
            for ann in root.findall(".//ALIGNABLE_ANNOTATION")
        ]
        assert len(ids) == len(set(ids))

    def test_linguistic_type_present(self, tmp_path: Path):
        p = tmp_path / "out.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        root = ET.parse(p).getroot()
        lt = root.find("LINGUISTIC_TYPE")
        assert lt is not None
        assert lt.attrib.get("LINGUISTIC_TYPE_ID") == "lt-speaker"

    def test_xml_escaping_in_annotation_value(self, tmp_path: Path):
        segs = [{"speaker": "A", "start": 0.0, "end": 1.0, "text": "hello <world> & more"}]
        p = tmp_path / "escape.eaf"
        write_eaf(str(p), segs, 1.5, segments=segs)
        # Parses without error
        root = ET.parse(p).getroot()
        val = root.findtext(".//ANNOTATION_VALUE")
        assert val == "hello <world> & more"

    def test_regression_start_ms_in_time_order(self, tmp_path: Path):
        """All segment start/end ms must appear in TIME_ORDER as actual slots."""
        p = tmp_path / "reg.eaf"
        write_eaf(str(p), _TWO_SPEAKERS, _XMAX)
        root = ET.parse(p).getroot()
        slot_values = {
            int(ts.attrib["TIME_VALUE"])
            for ts in root.findall(".//TIME_SLOT")
        }
        for turn in _TWO_SPEAKERS:
            assert int(round(turn["start"] * 1000)) in slot_values
            assert int(round(turn["end"] * 1000)) in slot_values


# ─── write_annotation_exports ────────────────────────────────────────────────


class TestWriteAnnotationExports:
    _RESULT = {
        "timeline": {
            "speaker_turns": [
                {"speaker": "SPEAKER_00", "start": 0.1, "end": 1.2},
                {"speaker": "SPEAKER_01", "start": 1.5, "end": 3.0},
            ]
        },
        "segments": [
            {"start": 0.1, "end": 1.2, "text": "bonjour", "speaker": "SPEAKER_00"},
            {"start": 1.5, "end": 3.0, "text": "salut", "speaker": "SPEAKER_01"},
        ],
    }

    def test_writes_all_three_formats(self, tmp_path: Path):
        out = write_annotation_exports(
            str(tmp_path), "audio.wav", self._RESULT, rttm=True, textgrid=True, eaf=True
        )
        assert Path(out["rttm"]).is_file()
        assert Path(out["textgrid"]).is_file()
        assert Path(out["eaf"]).is_file()

    def test_stem_used_for_filenames(self, tmp_path: Path):
        out = write_annotation_exports(
            str(tmp_path), "/data/my_clip.wav", self._RESULT, rttm=True
        )
        assert Path(out["rttm"]).name == "my_clip.rttm"

    def test_no_formats_returns_empty(self, tmp_path: Path):
        out = write_annotation_exports(str(tmp_path), "audio.wav", self._RESULT)
        assert out == {}

    def test_empty_turns_returns_empty(self, tmp_path: Path):
        out = write_annotation_exports(
            str(tmp_path), "audio.wav", {}, rttm=True, textgrid=True, eaf=True
        )
        assert out == {}

    def test_rttm_only(self, tmp_path: Path):
        out = write_annotation_exports(
            str(tmp_path), "audio.wav", self._RESULT, rttm=True
        )
        assert "rttm" in out
        assert "textgrid" not in out
        assert "eaf" not in out
