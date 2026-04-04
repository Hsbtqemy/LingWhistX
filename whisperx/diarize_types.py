"""Types légers pour la diarisation / VAD — sans pyannote (import léger pour silero, cli, etc.).

Ne pas confondre avec ``alignment.Segment`` : ce dernier est un dataclass interne au graphe CTC
(frames entières, label, score), sans rapport avec l’intervalle temps/locuteur ci-dessous.
"""


class Segment:
    """Intervalle VAD (start, end, locuteur) — utilisé par whisperx.vads (pyannote, silero)."""

    __slots__ = ("start", "end", "speaker")

    def __init__(self, start: float, end: float, speaker: str) -> None:
        self.start = float(start)
        self.end = float(end)
        self.speaker = speaker
