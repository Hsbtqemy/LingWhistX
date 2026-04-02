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


def _collect_env_redaction_pairs() -> list[tuple[str, str]]:
    """Chemins d'environnement candidats (ordre libre ; voir `_apply_env_redactions`)."""
    pairs: list[tuple[str, str]] = []
    home = str(Path.home())
    if home:
        pairs.append((home, "~"))
    profile = os.environ.get("USERPROFILE", "")
    if profile:
        pairs.append((profile, "~"))
    localappdata = os.environ.get("LOCALAPPDATA", "")
    if localappdata:
        pairs.append((localappdata, "~LOCALAPPDATA"))
    appdata = os.environ.get("APPDATA", "")
    if appdata:
        pairs.append((appdata, "~APPDATA"))
    for var, ph in (
        ("XDG_CONFIG_HOME", "~XDG_CONFIG_HOME"),
        ("XDG_DATA_HOME", "~XDG_DATA_HOME"),
        ("XDG_STATE_HOME", "~XDG_STATE_HOME"),
        ("XDG_CACHE_HOME", "~XDG_CACHE_HOME"),
    ):
        v = os.environ.get(var, "")
        if v:
            pairs.append((v, ph))
    return pairs


def _apply_env_redactions(text: str, pairs: list[tuple[str, str]]) -> str:
    """Trie les chemins du plus long au plus court, déduplique, puis substitue."""
    ordered = sorted((p for p in pairs if p[0]), key=lambda x: len(x[0]), reverse=True)
    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for val, ph in ordered:
        if val in seen:
            continue
        seen.add(val)
        unique.append((val, ph))
    out = text
    for val, ph in unique:
        out = out.replace(val, ph)
    return out


def sanitize_log_line(text: str) -> str:
    """Masque les préfixes de répertoire personnel dans une ligne de log arbitraire."""
    if not text:
        return text
    return _apply_env_redactions(text, _collect_env_redaction_pairs())


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
