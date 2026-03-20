from typing import Callable, TypedDict, Optional, List, Tuple

ProgressCallback = Optional[Callable[[float], None]]

try:
    from typing import NotRequired
except ImportError:
    from typing_extensions import NotRequired


class SingleWordSegment(TypedDict):
    """
    A single word of a speech.
    """
    word: str
    start: float
    end: float
    score: float

class SingleCharSegment(TypedDict):
    """
    A single char of a speech.
    """
    char: str
    start: float
    end: float
    score: float


class SingleSegment(TypedDict):
    """
    A single segment (up to multiple sentences) of a speech.
    """

    start: float
    end: float
    text: str
    avg_logprob: NotRequired[float]


class SegmentData(TypedDict):
    """
    Temporary processing data used during alignment.
    Contains cleaned and preprocessed data for each segment.
    """
    clean_char: List[str]  # Cleaned characters that exist in model dictionary
    clean_cdx: List[int]   # Original indices of cleaned characters
    clean_wdx: List[int]   # Indices of words containing valid characters
    sentence_spans: List[Tuple[int, int]]  # Start and end indices of sentences


class SingleAlignedSegment(TypedDict):
    """
    A single segment (up to multiple sentences) of a speech with word alignment.
    """

    start: float
    end: float
    text: str
    avg_logprob: NotRequired[float]
    words: List[SingleWordSegment]
    chars: Optional[List[SingleCharSegment]]


class CanonicalTimelineWord(TypedDict):
    token: str
    start: float
    end: float
    speaker: NotRequired[str]
    confidence: NotRequired[float]
    flags: NotRequired[List[str]]


class CanonicalTimelineSegment(TypedDict):
    text: str
    start: float
    end: float
    speaker: NotRequired[str]
    confidence: NotRequired[float]


class CanonicalTimelineSpeakerTurn(TypedDict):
    speaker: str
    start: float
    end: float


class CanonicalTimelineEvent(TypedDict):
    type: str
    start: float
    end: float
    speakers: NotRequired[List[str]]


class CanonicalTimelinePause(TypedDict):
    start: float
    end: float
    dur: float
    type: str
    speaker: NotRequired[str]


class CanonicalTimelineNonSpeechInterval(TypedDict):
    start: float
    end: float
    dur: float
    method: str


class CanonicalTimelineIpu(TypedDict):
    start: float
    end: float
    dur: float
    text: str
    n_words: int
    speaker: NotRequired[str]


CanonicalTimelineTransition = TypedDict(
    "CanonicalTimelineTransition",
    {"from": str, "to": str, "gap": float, "start": float, "end": float},
)


class CanonicalTimelineOverlap(TypedDict):
    speakers: List[str]
    start: float
    end: float
    dur: float


class CanonicalTimelineAnalysisConfig(TypedDict):
    pause_min: float
    pause_ignore_below: float
    pause_effective_min: float
    pause_max: NotRequired[float]
    include_nonspeech: bool
    nonspeech_min_duration: float
    ipu_min_words: int
    ipu_min_duration: float
    ipu_bridge_short_gaps_under: float


class CanonicalTimelineAnalysis(TypedDict):
    config: CanonicalTimelineAnalysisConfig
    pauses: List[CanonicalTimelinePause]
    nonspeech_intervals: List[CanonicalTimelineNonSpeechInterval]
    ipus: List[CanonicalTimelineIpu]
    transitions: List[CanonicalTimelineTransition]
    overlaps: List[CanonicalTimelineOverlap]


class CanonicalTimeline(TypedDict):
    version: int
    words: List[CanonicalTimelineWord]
    segments: List[CanonicalTimelineSegment]
    speaker_turns: List[CanonicalTimelineSpeakerTurn]
    events: List[CanonicalTimelineEvent]
    analysis: NotRequired[CanonicalTimelineAnalysis]


class TranscriptionResult(TypedDict):
    """
    A list of segments and word segments of a speech.
    """
    segments: List[SingleSegment]
    language: str
    timeline: NotRequired[CanonicalTimeline]
    speaker_turns: NotRequired[List[CanonicalTimelineSpeakerTurn]]
    events: NotRequired[List[CanonicalTimelineEvent]]


class AlignedTranscriptionResult(TypedDict):
    """
    A list of segments and word segments of a speech.
    """
    segments: List[SingleAlignedSegment]
    word_segments: List[SingleWordSegment]
    timeline: NotRequired[CanonicalTimeline]
    speaker_turns: NotRequired[List[CanonicalTimelineSpeakerTurn]]
    events: NotRequired[List[CanonicalTimelineEvent]]
