"""
WX-677 — Tests for annotation import parsers (EAF + TextGrid).
Uses in-memory fixture content written to tmp_path — no real ELAN/Praat files required.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from whisperx.annotation_imports import ImportedAnnotation, parse_eaf, parse_textgrid


# ─── EAF fixtures ────────────────────────────────────────────────────────────

MINIMAL_EAF = """\
<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="test" DATE="2024-01-01T00:00:00+00:00" VERSION="0" FORMAT="3.0">
  <HEADER TIME_UNITS="milliseconds">
    <TIME_ORDER>
      <TIME_SLOT TIME_SLOT_ID="ts0" TIME_VALUE="0"/>
      <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="1500"/>
      <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="4000"/>
      <TIME_SLOT TIME_SLOT_ID="ts3" TIME_VALUE="6000"/>
    </TIME_ORDER>
  </HEADER>
  <TIER TIER_ID="SPEAKER_00">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a0" TIME_SLOT_REF1="ts0" TIME_SLOT_REF2="ts1">
        <ANNOTATION_VALUE>Hello world</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <TIER TIER_ID="SPEAKER_01">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts2" TIME_SLOT_REF2="ts3">
        <ANNOTATION_VALUE>Bonjour</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="lt-speaker" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>
"""

EAF_WITH_REF_ANNOTATION = """\
<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="test" DATE="2024-01-01T00:00:00+00:00" VERSION="0" FORMAT="3.0">
  <HEADER TIME_UNITS="milliseconds">
    <TIME_ORDER>
      <TIME_SLOT TIME_SLOT_ID="ts0" TIME_VALUE="1000"/>
      <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="3000"/>
    </TIME_ORDER>
  </HEADER>
  <TIER TIER_ID="SPEAKER_00">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a0" TIME_SLOT_REF1="ts0" TIME_SLOT_REF2="ts1">
        <ANNOTATION_VALUE>Parent annotation</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <TIER TIER_ID="Translation" PARENT_REF="SPEAKER_00">
    <ANNOTATION>
      <REF_ANNOTATION ANNOTATION_ID="a1" ANNOTATION_REF="a0">
        <ANNOTATION_VALUE>Child inherits timing</ANNOTATION_VALUE>
      </REF_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="lt-speaker" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>
"""

EAF_WITH_MEDIA_DESCRIPTOR = """\
<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="test" DATE="2024-01-01T00:00:00+00:00" VERSION="0" FORMAT="3.0">
  <HEADER TIME_UNITS="milliseconds">
    <MEDIA_DESCRIPTOR MEDIA_URL="file:///nonexistent/audio.wav"
                      RELATIVE_MEDIA_URL="audio.wav"
                      MEDIA_TYPE="audio/x-wav"/>
    <TIME_ORDER>
      <TIME_SLOT TIME_SLOT_ID="ts0" TIME_VALUE="0"/>
      <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="2000"/>
    </TIME_ORDER>
  </HEADER>
  <TIER TIER_ID="SPEAKER_00">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a0" TIME_SLOT_REF1="ts0" TIME_SLOT_REF2="ts1">
        <ANNOTATION_VALUE>With media</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="lt" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>
"""

EAF_MULTI_TIER_FOUR_SPEAKERS = """\
<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="test" DATE="2024-01-01T00:00:00+00:00" VERSION="0" FORMAT="3.0">
  <HEADER TIME_UNITS="milliseconds">
    <TIME_ORDER>
      <TIME_SLOT TIME_SLOT_ID="ts0" TIME_VALUE="0"/>
      <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="1000"/>
      <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="2000"/>
      <TIME_SLOT TIME_SLOT_ID="ts3" TIME_VALUE="3000"/>
      <TIME_SLOT TIME_SLOT_ID="ts4" TIME_VALUE="4000"/>
      <TIME_SLOT TIME_SLOT_ID="ts5" TIME_VALUE="5000"/>
      <TIME_SLOT TIME_SLOT_ID="ts6" TIME_VALUE="6000"/>
      <TIME_SLOT TIME_SLOT_ID="ts7" TIME_VALUE="7000"/>
    </TIME_ORDER>
  </HEADER>
  <TIER TIER_ID="SP_A">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a0" TIME_SLOT_REF1="ts0" TIME_SLOT_REF2="ts1">
        <ANNOTATION_VALUE>Alpha</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <TIER TIER_ID="SP_B">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts2" TIME_SLOT_REF2="ts3">
        <ANNOTATION_VALUE>Beta</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <TIER TIER_ID="SP_C">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a2" TIME_SLOT_REF1="ts4" TIME_SLOT_REF2="ts5">
        <ANNOTATION_VALUE>Gamma</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <TIER TIER_ID="SP_D">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a3" TIME_SLOT_REF1="ts6" TIME_SLOT_REF2="ts7">
        <ANNOTATION_VALUE>Delta</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="lt" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>
"""

EAF_SPECIAL_CHARS = """\
<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="test" DATE="2024-01-01T00:00:00+00:00" VERSION="0" FORMAT="3.0">
  <HEADER TIME_UNITS="milliseconds">
    <TIME_ORDER>
      <TIME_SLOT TIME_SLOT_ID="ts0" TIME_VALUE="0"/>
      <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="1000"/>
    </TIME_ORDER>
  </HEADER>
  <TIER TIER_ID="SP &amp; Friends">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a0" TIME_SLOT_REF1="ts0" TIME_SLOT_REF2="ts1">
        <ANNOTATION_VALUE>it&apos;s &lt;fine&gt; &amp; good</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="lt" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>
"""


# ─── EAF tests ───────────────────────────────────────────────────────────────


def test_eaf_parse_two_speakers(tmp_path: Path) -> None:
    p = tmp_path / "test.eaf"
    p.write_text(MINIMAL_EAF, encoding="utf-8")

    result = parse_eaf(str(p))
    assert isinstance(result, ImportedAnnotation)
    assert result.source_format == "eaf"
    assert len(result.tiers) == 2

    tier_ids = {t["tier_id"] for t in result.tiers}
    assert "SPEAKER_00" in tier_ids
    assert "SPEAKER_01" in tier_ids

    sp00 = next(t for t in result.tiers if t["tier_id"] == "SPEAKER_00")
    assert len(sp00["segments"]) == 1
    seg = sp00["segments"][0]
    assert seg["start"] == pytest.approx(0.0)
    assert seg["end"] == pytest.approx(1.5)
    assert seg["text"] == "Hello world"

    sp01 = next(t for t in result.tiers if t["tier_id"] == "SPEAKER_01")
    seg = sp01["segments"][0]
    assert seg["start"] == pytest.approx(4.0)
    assert seg["end"] == pytest.approx(6.0)


def test_eaf_duration_from_annotations(tmp_path: Path) -> None:
    p = tmp_path / "test.eaf"
    p.write_text(MINIMAL_EAF, encoding="utf-8")
    result = parse_eaf(str(p))
    assert result.duration_s == pytest.approx(6.0)


def test_eaf_ref_annotation_inherits_timing(tmp_path: Path) -> None:
    p = tmp_path / "ref.eaf"
    p.write_text(EAF_WITH_REF_ANNOTATION, encoding="utf-8")

    result = parse_eaf(str(p))
    translation_tier = next(
        (t for t in result.tiers if t["tier_id"] == "Translation"), None
    )
    assert translation_tier is not None
    segs = translation_tier["segments"]
    assert len(segs) == 1
    assert segs[0]["start"] == pytest.approx(1.0)
    assert segs[0]["end"] == pytest.approx(3.0)
    assert segs[0]["text"] == "Child inherits timing"


def test_eaf_media_path_relative_resolved(tmp_path: Path) -> None:
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"FAKE")

    p = tmp_path / "test.eaf"
    p.write_text(EAF_WITH_MEDIA_DESCRIPTOR, encoding="utf-8")

    result = parse_eaf(str(p))
    # RELATIVE_MEDIA_URL "audio.wav" → resolved to tmp_path/audio.wav
    assert result.media_path is not None
    assert result.media_path == str(audio)


def test_eaf_media_path_none_when_file_missing(tmp_path: Path) -> None:
    p = tmp_path / "test.eaf"
    p.write_text(EAF_WITH_MEDIA_DESCRIPTOR, encoding="utf-8")
    # No audio.wav in tmp_path
    result = parse_eaf(str(p))
    assert result.media_path is None


def test_eaf_four_speakers_separate_tiers(tmp_path: Path) -> None:
    p = tmp_path / "four.eaf"
    p.write_text(EAF_MULTI_TIER_FOUR_SPEAKERS, encoding="utf-8")

    result = parse_eaf(str(p))
    assert len(result.tiers) == 4
    ids = {t["tier_id"] for t in result.tiers}
    assert ids == {"SP_A", "SP_B", "SP_C", "SP_D"}


def test_eaf_xml_entities_decoded(tmp_path: Path) -> None:
    p = tmp_path / "special.eaf"
    p.write_text(EAF_SPECIAL_CHARS, encoding="utf-8")

    result = parse_eaf(str(p))
    assert len(result.tiers) == 1
    tier = result.tiers[0]
    assert tier["tier_id"] == "SP & Friends"
    assert tier["segments"][0]["text"] == "it's <fine> & good"


def test_eaf_invalid_xml_raises(tmp_path: Path) -> None:
    p = tmp_path / "bad.eaf"
    p.write_text("<not valid xml><<<", encoding="utf-8")
    with pytest.raises(ValueError, match="EAF XML parse error"):
        parse_eaf(str(p))


def test_eaf_to_dict_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "test.eaf"
    p.write_text(MINIMAL_EAF, encoding="utf-8")
    result = parse_eaf(str(p))
    d = result.to_dict()
    assert "tiers" in d
    assert "media_path" in d
    assert "duration_s" in d
    assert d["source_format"] == "eaf"


# ─── EAF roundtrip: export then re-import ────────────────────────────────────


def test_eaf_export_then_import_roundtrip(tmp_path: Path) -> None:
    """Write an EAF with write_eaf(), then re-import with parse_eaf()."""
    from whisperx.annotation_exports import write_eaf

    segments = [
        {"start": 0.5, "end": 2.0, "speaker": "Alice", "text": "Hello"},
        {"start": 2.5, "end": 4.0, "speaker": "Bob", "text": "World"},
        {"start": 4.5, "end": 6.0, "speaker": "Alice", "text": "Again"},
    ]
    eaf_path = str(tmp_path / "round.eaf")
    write_eaf(eaf_path, turns=[], xmax=6.0, segments=segments)

    result = parse_eaf(eaf_path)

    alice = next(t for t in result.tiers if t["tier_id"] == "Alice")
    bob = next(t for t in result.tiers if t["tier_id"] == "Bob")

    assert len(alice["segments"]) == 2
    assert alice["segments"][0]["text"] == "Hello"
    assert alice["segments"][1]["text"] == "Again"
    assert len(bob["segments"]) == 1
    assert bob["segments"][0]["text"] == "World"


# ─── TextGrid fixtures ────────────────────────────────────────────────────────

TEXTGRID_LONG_TWO_TIERS = textwrap.dedent("""\
    File type = "ooTextFile"
    Object class = "TextGrid"

    xmin = 0
    xmax = 10.0
    tiers? <exists>
    size = 2
    item []:
        item [1]:
            class = "IntervalTier"
            name = "Alice"
            xmin = 0
            xmax = 10.0
            intervals: size = 3
            intervals [1]:
                xmin = 0
                xmax = 1.0
                text = ""
            intervals [2]:
                xmin = 1.0
                xmax = 3.5
                text = "Hello there"
            intervals [3]:
                xmin = 3.5
                xmax = 10.0
                text = ""
        item [2]:
            class = "IntervalTier"
            name = "Bob"
            xmin = 0
            xmax = 10.0
            intervals: size = 2
            intervals [1]:
                xmin = 0
                xmax = 5.0
                text = ""
            intervals [2]:
                xmin = 5.0
                xmax = 8.0
                text = "Good morning"
""")

TEXTGRID_LONG_WITH_QUOTES = textwrap.dedent("""\
    File type = "ooTextFile"
    Object class = "TextGrid"

    xmin = 0
    xmax = 5.0
    tiers? <exists>
    size = 1
    item []:
        item [1]:
            class = "IntervalTier"
            name = "SP"
            xmin = 0
            xmax = 5.0
            intervals: size = 2
            intervals [1]:
                xmin = 0
                xmax = 2.0
                text = "she said ""hi"" to him"
            intervals [2]:
                xmin = 2.0
                xmax = 5.0
                text = ""
""")

TEXTGRID_LONG_MULTILINE_TEXT = textwrap.dedent("""\
    File type = "ooTextFile"
    Object class = "TextGrid"

    xmin = 0
    xmax = 5.0
    tiers? <exists>
    size = 1
    item []:
        item [1]:
            class = "IntervalTier"
            name = "SP"
            xmin = 0
            xmax = 5.0
            intervals: size = 1
            intervals [1]:
                xmin = 0
                xmax = 5.0
                text = "first line
second line"
""")

TEXTGRID_LONG_POINT_TIER = textwrap.dedent("""\
    File type = "ooTextFile"
    Object class = "TextGrid"

    xmin = 0
    xmax = 10.0
    tiers? <exists>
    size = 1
    item []:
        item [1]:
            class = "TextTier"
            name = "Events"
            xmin = 0
            xmax = 10.0
            points: size = 2
            points [1]:
                number = 2.5
                mark = "click"
            points [2]:
                number = 7.0
                mark = "boundary"
""")

TEXTGRID_SHORT_TWO_TIERS = textwrap.dedent("""\
    File type = "ooTextFile short"
    "TextGrid"
    0
    8.0
    <exists>
    2
    "IntervalTier"
    "Alice"
    0
    8.0
    3
    0
    2.0
    ""
    2.0
    5.0
    "hello short"
    5.0
    8.0
    ""
    "IntervalTier"
    "Bob"
    0
    8.0
    2
    0
    3.0
    ""
    3.0
    8.0
    "bonjour"
""")


# ─── TextGrid tests ───────────────────────────────────────────────────────────


def test_textgrid_long_two_tiers(tmp_path: Path) -> None:
    p = tmp_path / "t.TextGrid"
    p.write_text(TEXTGRID_LONG_TWO_TIERS, encoding="utf-8")

    result = parse_textgrid(str(p))
    assert result.source_format == "textgrid"
    assert result.media_path is None
    assert len(result.tiers) == 2

    alice = next(t for t in result.tiers if t["tier_id"] == "Alice")
    bob = next(t for t in result.tiers if t["tier_id"] == "Bob")

    assert len(alice["segments"]) == 1
    seg = alice["segments"][0]
    assert seg["start"] == pytest.approx(1.0)
    assert seg["end"] == pytest.approx(3.5)
    assert seg["text"] == "Hello there"

    assert len(bob["segments"]) == 1
    assert bob["segments"][0]["text"] == "Good morning"


def test_textgrid_long_duration(tmp_path: Path) -> None:
    p = tmp_path / "t.TextGrid"
    p.write_text(TEXTGRID_LONG_TWO_TIERS, encoding="utf-8")
    result = parse_textgrid(str(p))
    assert result.duration_s == pytest.approx(10.0)


def test_textgrid_long_quoted_escaped(tmp_path: Path) -> None:
    p = tmp_path / "q.TextGrid"
    p.write_text(TEXTGRID_LONG_WITH_QUOTES, encoding="utf-8")
    result = parse_textgrid(str(p))
    assert len(result.tiers) == 1
    seg = result.tiers[0]["segments"][0]
    assert seg["text"] == 'she said "hi" to him'


def test_textgrid_long_multiline_text(tmp_path: Path) -> None:
    p = tmp_path / "ml.TextGrid"
    p.write_text(TEXTGRID_LONG_MULTILINE_TEXT, encoding="utf-8")
    result = parse_textgrid(str(p))
    seg = result.tiers[0]["segments"][0]
    assert "first line" in seg["text"]
    assert "second line" in seg["text"]


def test_textgrid_long_point_tier(tmp_path: Path) -> None:
    p = tmp_path / "pt.TextGrid"
    p.write_text(TEXTGRID_LONG_POINT_TIER, encoding="utf-8")
    result = parse_textgrid(str(p))
    assert len(result.tiers) == 1
    segs = result.tiers[0]["segments"]
    assert len(segs) == 2
    assert segs[0]["start"] == pytest.approx(2.5)
    assert segs[0]["end"] == pytest.approx(2.5)
    assert segs[0]["text"] == "click"


def test_textgrid_short_format(tmp_path: Path) -> None:
    p = tmp_path / "short.TextGrid"
    p.write_text(TEXTGRID_SHORT_TWO_TIERS, encoding="utf-8")
    result = parse_textgrid(str(p))
    assert result.source_format == "textgrid"
    assert len(result.tiers) == 2

    alice = next(t for t in result.tiers if t["tier_id"] == "Alice")
    bob = next(t for t in result.tiers if t["tier_id"] == "Bob")

    assert len(alice["segments"]) == 1
    assert alice["segments"][0]["text"] == "hello short"
    assert alice["segments"][0]["start"] == pytest.approx(2.0)

    assert len(bob["segments"]) == 1
    assert bob["segments"][0]["text"] == "bonjour"
    assert bob["segments"][0]["start"] == pytest.approx(3.0)


def test_textgrid_latin1_encoding(tmp_path: Path) -> None:
    # Write a file with Latin-1 encoded content (é, ü, ñ)
    content = TEXTGRID_LONG_TWO_TIERS.replace("Hello there", "Héllo thère")
    p = tmp_path / "latin1.TextGrid"
    p.write_bytes(content.encode("latin-1"))

    result = parse_textgrid(str(p))
    # Should decode without error; at least one tier should parse
    assert len(result.tiers) >= 1
    # Latin-1 decoded correctly
    alice = next((t for t in result.tiers if "Alice" in t["tier_id"]), None)
    assert alice is not None
    if alice["segments"]:
        assert "Héllo" in alice["segments"][0]["text"]


def test_textgrid_utf8_bom(tmp_path: Path) -> None:
    p = tmp_path / "bom.TextGrid"
    raw = b"\xef\xbb\xbf" + TEXTGRID_LONG_TWO_TIERS.encode("utf-8")
    p.write_bytes(raw)
    result = parse_textgrid(str(p))
    assert len(result.tiers) == 2


def test_textgrid_empty_file_raises(tmp_path: Path) -> None:
    p = tmp_path / "empty.TextGrid"
    p.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="too short"):
        parse_textgrid(str(p))


def test_textgrid_to_dict_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "t.TextGrid"
    p.write_text(TEXTGRID_LONG_TWO_TIERS, encoding="utf-8")
    result = parse_textgrid(str(p))
    d = result.to_dict()
    assert d["source_format"] == "textgrid"
    assert d["media_path"] is None
    assert isinstance(d["tiers"], list)


# ─── TextGrid roundtrip: export then re-import ───────────────────────────────


def test_textgrid_export_then_import_roundtrip(tmp_path: Path) -> None:
    """Write a TextGrid with write_textgrid(), then re-import with parse_textgrid()."""
    from whisperx.annotation_exports import write_textgrid

    segments = [
        {"start": 0.0, "end": 2.0, "speaker": "Alice", "text": "First"},
        {"start": 2.5, "end": 5.0, "speaker": "Bob", "text": "Second"},
        {"start": 5.5, "end": 7.0, "speaker": "Alice", "text": "Third"},
    ]
    tg_path = str(tmp_path / "round.TextGrid")
    write_textgrid(tg_path, turns=[], xmax=8.0, segments=segments)

    result = parse_textgrid(tg_path)

    alice = next(t for t in result.tiers if t["tier_id"] == "Alice")
    bob = next(t for t in result.tiers if t["tier_id"] == "Bob")

    assert len(alice["segments"]) == 2
    assert alice["segments"][0]["text"] == "First"
    assert alice["segments"][1]["text"] == "Third"
    assert len(bob["segments"]) == 1
    assert bob["segments"][0]["text"] == "Second"
