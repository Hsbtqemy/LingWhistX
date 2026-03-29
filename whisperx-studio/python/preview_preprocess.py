#!/usr/bin/env python3
"""
WX-665 — CLI helper : applique le pipeline audio préconfiguré sur un WAV temporaire
et retourne (stdout) le chemin absolu du fichier WAV résultant.

Usage :
    python preview_preprocess.py --input <wav> --out-dir <dir> --modules-json <json>

Si le JSON est vide ({}) ou ne contient aucun module actif, retourne le chemin d'entrée
tel quel (aucun traitement appliqué).
"""
from __future__ import annotations

import argparse
import json
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        description="WX-665 — audio preview preprocessing CLI"
    )
    parser.add_argument("--input", required=True, help="Chemin du WAV d'entrée")
    parser.add_argument("--out-dir", required=True, help="Répertoire de sortie temporaire")
    parser.add_argument(
        "--modules-json", required=True, help="Objet JSON audioPipelineModules"
    )
    args = parser.parse_args()

    # Rendre studio_audio_modules importable (répertoire du script)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    try:
        from studio_audio_modules import maybe_prepare_audio_input  # type: ignore
    except ImportError as exc:
        print(f"ERROR: studio_audio_modules introuvable : {exc}", file=sys.stderr)
        sys.exit(1)

    from pathlib import Path

    try:
        modules = json.loads(args.modules_json)
    except json.JSONDecodeError as exc:
        print(f"ERROR: --modules-json JSON invalide : {exc}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(modules, dict) or not modules:
        # Aucun module configuré — retourne le fichier d'entrée inchangé
        print(args.input, end="")
        return

    options: dict = {"audioPipelineModules": modules}
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    result = maybe_prepare_audio_input(args.input, out_dir, options)
    print(result, end="")


if __name__ == "__main__":
    main()
