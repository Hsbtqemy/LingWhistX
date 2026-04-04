"""VAD — Pyannote et Silero sont chargés à la demande (évite pyannote/torchcodec au simple import)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from whisperx.vads.vad import Vad as Vad

if TYPE_CHECKING:
    from whisperx.vads.pyannote import Pyannote as Pyannote
    from whisperx.vads.silero import Silero as Silero


def __getattr__(name: str) -> Any:
    if name == "Pyannote":
        from whisperx.vads.pyannote import Pyannote

        return Pyannote
    if name == "Silero":
        from whisperx.vads.silero import Silero

        return Silero
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ("Vad", "Silero", "Pyannote")
