from whisperx.timeline import build_canonical_timeline


def test_build_canonical_timeline_keeps_words_segments_and_overlap_events():
    result = {
        "language": "fr",
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "bonjour monde",
                "speaker": "SPEAKER_00",
                "words": [
                    {"word": "bonjour", "start": 0.0, "end": 0.4, "score": 0.93},
                    {"word": "monde", "start": 0.5, "end": 1.0, "score": 0.9},
                ],
            }
        ],
        "speaker_turns": [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
            {"speaker": "SPEAKER_01", "start": 0.6, "end": 1.2},
        ],
    }

    timeline = build_canonical_timeline(result)

    assert timeline["version"] == 1
    assert timeline["segments"][0]["text"] == "bonjour monde"
    assert timeline["words"][0]["token"] == "bonjour"
    assert timeline["words"][0]["speaker"] == "SPEAKER_00"
    overlap_events = [event for event in timeline["events"] if event["type"] == "overlap"]
    assert overlap_events
    assert overlap_events[0]["start"] == 0.6
    assert overlap_events[0]["end"] == 1.0
    assert timeline["analysis"]["overlaps"][0]["dur"] == 0.4


def test_build_canonical_timeline_interpolates_missing_word_bounds():
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.2,
                "text": "a b c",
                "speaker": "SPEAKER_00",
                "words": [
                    {"word": "a", "start": 0.0, "end": 0.2, "score": 0.95},
                    {"word": "b", "start": 0.3},
                    {"word": "c"},
                ],
            }
        ]
    }

    timeline = build_canonical_timeline(result)
    words = timeline["words"]

    assert len(words) == 3
    assert words[1]["start"] == 0.3
    assert words[1]["end"] == 1.2
    assert "interpolated" in words[1]["flags"]
    assert words[2]["start"] == 1.2
    assert words[2]["end"] == 1.2
    assert "interpolated" in words[2]["flags"]


def test_build_canonical_timeline_derives_pauses_and_nonspeech_analysis():
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 0.4,
                "text": "hello",
                "speaker": "SPEAKER_00",
                "words": [
                    {"word": "hello", "start": 0.0, "end": 0.4, "score": 0.95},
                ],
            },
            {
                "start": 0.8,
                "end": 1.2,
                "text": "again",
                "speaker": "SPEAKER_00",
                "words": [
                    {"word": "again", "start": 0.8, "end": 1.2, "score": 0.91},
                ],
            },
        ]
    }

    timeline = build_canonical_timeline(
        result,
        analysis_config={
            "pause_min": 0.15,
            "pause_ignore_below": 0.1,
            "include_nonspeech": True,
            "nonspeech_min_duration": 0.2,
        },
    )

    analysis = timeline["analysis"]
    assert analysis["config"]["pause_effective_min"] == 0.15
    assert len(analysis["pauses"]) == 1
    assert analysis["pauses"][0]["speaker"] == "SPEAKER_00"
    assert analysis["pauses"][0]["dur"] == 0.4
    assert len(analysis["nonspeech_intervals"]) == 1
    assert analysis["nonspeech_intervals"][0]["method"] == "vad_gap"
    non_speech_events = [event for event in timeline["events"] if event["type"] == "non_speech"]
    assert len(non_speech_events) == 1
    assert non_speech_events[0]["start"] == 0.4
    assert non_speech_events[0]["end"] == 0.8


def test_build_canonical_timeline_can_disable_nonspeech_analysis():
    result = {
        "segments": [
            {"start": 0.0, "end": 0.3, "text": "a"},
            {"start": 1.0, "end": 1.3, "text": "b"},
        ]
    }

    timeline = build_canonical_timeline(
        result,
        analysis_config={"include_nonspeech": False},
    )

    assert timeline["analysis"]["nonspeech_intervals"] == []
    assert all(event["type"] != "non_speech" for event in timeline["events"])


def test_build_canonical_timeline_derives_ipus_and_transitions():
    result = {
        "segments": [
            {
                "start": 0.0,
                "end": 0.4,
                "text": "hello",
                "speaker": "SPEAKER_00",
                "words": [{"word": "hello", "start": 0.0, "end": 0.4}],
            },
            {
                "start": 0.8,
                "end": 1.2,
                "text": "again",
                "speaker": "SPEAKER_00",
                "words": [{"word": "again", "start": 0.8, "end": 1.2}],
            },
            {
                "start": 1.3,
                "end": 1.7,
                "text": "next",
                "speaker": "SPEAKER_01",
                "words": [{"word": "next", "start": 1.3, "end": 1.7}],
            },
        ],
        "speaker_turns": [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.2},
            {"speaker": "SPEAKER_01", "start": 1.3, "end": 2.0},
        ],
    }

    timeline = build_canonical_timeline(
        result,
        analysis_config={
            "pause_min": 0.15,
            "pause_ignore_below": 0.1,
            "ipu_min_words": 1,
            "ipu_min_duration": 0.0,
            "ipu_bridge_short_gaps_under": 0.0,
        },
    )

    analysis = timeline["analysis"]
    assert len(analysis["ipus"]) == 3
    assert analysis["ipus"][0]["text"] == "hello"
    assert analysis["ipus"][1]["text"] == "again"
    assert analysis["ipus"][2]["speaker"] == "SPEAKER_01"
    assert len(analysis["transitions"]) == 1
    assert analysis["transitions"][0]["from"] == "SPEAKER_00"
    assert analysis["transitions"][0]["to"] == "SPEAKER_01"
    assert analysis["transitions"][0]["gap"] == 0.1
