"""
Réduction des chemins personnels et masquage de secrets dans les messages de log (worker, modules audio, CLI preview).

Utilisé par `worker.py`, `studio_audio_modules.py`, `preview_preprocess.py`.
"""

from __future__ import annotations

import os
from pathlib import Path


def sanitize_path_for_log(path: str) -> str:
    """Réduit l'exposition des chemins absolus (préfixe répertoire personnel → ~)."""
    if not path:
        return path
    try:
        expanded = str(Path(path).expanduser())
    except OSError:
        expanded = path
    home = str(Path.home())
    if home and expanded.startswith(home):
        tail = expanded[len(home) :]
        if tail and tail[0] not in "/\\":
            tail = "/" + tail
        return ("~" + tail).replace("\\", "/")
    return expanded.replace("\\", "/")


def sanitize_log_line(text: str) -> str:
    """Masque les préfixes de répertoire personnel dans une ligne de log arbitraire."""
    if not text:
        return text
    out = text
    home = str(Path.home())
    if home and home in out:
        out = out.replace(home, "~")
    profile = os.environ.get("USERPROFILE", "")
    if profile and profile not in (home, "") and profile in out:
        out = out.replace(profile, "~")
    # Cas rare : AppData\\Local hors du préfixe déjà couvert par USERPROFILE.
    localappdata = os.environ.get("LOCALAPPDATA", "")
    if localappdata and localappdata not in (home, profile, "") and localappdata in out:
        out = out.replace(localappdata, "~LOCALAPPDATA")
    return out


def sanitize_exception_message(exc: BaseException) -> str:
    """Message d’exception prêt pour les logs (chemins personnels réduits)."""
    return sanitize_log_line(str(exc))


def format_command_for_log(argv: list[str]) -> str:
    """Joint une argv pour affichage dans les logs, masquant l'argument après --hf_token."""
    visible_parts: list[str] = []
    hide_next = False
    for part in argv:
        if hide_next:
            visible_parts.append("***")
            hide_next = False
            continue
        if part.startswith("--hf_token="):
            visible_parts.append("--hf_token=***")
            continue
        visible_parts.append(part)
        if part == "--hf_token":
            hide_next = True
    raw = " ".join(visible_parts)
    return sanitize_log_line(raw)


__all__ = [
    "format_command_for_log",
    "sanitize_exception_message",
    "sanitize_log_line",
    "sanitize_path_for_log",
]
