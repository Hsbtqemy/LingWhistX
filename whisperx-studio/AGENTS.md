# AGENTS.md

Guide de passation rapide pour les futurs agents sur `whisperx-studio`.

## 1) Contexte projet

- Stack: Tauri v2 + React + Rust + worker Python.
- Objectif: wrapper local-first pour pipeline WhisperX, édition alignée texte/timing, export multi-formats.
- Repo principal: `whisperx-studio/` (workspace courant).

## 2) Etat actuel

- Backlog exécutable: `backlog/backlog.json`
- Tous les tickets `WX-201` à `WX-210` sont marqués `done`.
- Features clés déjà en place:
  - édition timing (split/merge, drag start/end, snap, zoom)
  - undo/redo unifié
  - autosave/recovery draft
  - exports avancés (JSON/SRT/VTT/TXT + règles timing + report)
  - QA panel transcript
  - waveform async avec progression/cancel/cache
  - assistant first-run runtime local
  - smoke E2E + checklist release
  - build `.exe` portable

## 3) Commandes utiles

- Dev:
  - `npm run tauri dev`
- Build app:
  - `npm run build`
  - `npm run tauri build`
- Backlog:
  - `npm run backlog:list`
  - `npm run backlog:next`
  - `npm run backlog:set -- -Id WX-XXX -Status done`
- Runtime local:
  - `npm run runtime:setup`
- Smoke release:
  - `npm run smoke:e2e`
- EXE portable:
  - `npm run build:portable-exe`

## 4) Livrables release

- Installers:
  - `src-tauri/target/release/bundle/msi/*.msi`
  - `src-tauri/target/release/bundle/nsis/*.exe`
- Portable:
  - `src-tauri/target/release/portable/whisperx-studio_<version>_portable.exe`
  - `src-tauri/target/release/portable/whisperx-studio_<version>_portable.exe.sha256`
- Traces smoke:
  - `runs/smoke/smoke-release-<timestamp>.md`
- Checklist:
  - `release-checklist.v1.md`

## 5) Pièges connus / décisions

- Important: pour un exe desktop valide, éviter `cargo build` direct pour distribution.
  - Utiliser `tauri build --no-bundle` via `npm run build:portable-exe`.
  - Sinon risque d’ouverture sur `localhost` (mode dev URL).
- Le script `build-portable-exe.ps1` coupe automatiquement le process `whisperx-studio` si l’exe est locké.
- Compat parsing worker Python:
  - le backend Rust accepte `output_files` (snake_case) en plus de camelCase.
- Fallback ressources:
  - `worker.py` et `setup-local-runtime.ps1` sont embarqués en fallback dans le binaire (écriture auto en `app_local_data_dir/embedded-resources` si absent).
- Dépendances machine cible:
  - WebView2 Windows requis.
  - Python/runtime WhisperX requis pour mode `whisperx`.

## 6) Fichiers coeur

- Frontend:
  - `src/App.tsx`
  - `src/App.css`
- Backend Rust:
  - `src-tauri/src/lib.rs`
- Worker:
  - `python/worker.py`
- Scripts:
  - `scripts/smoke-e2e.ps1`
  - `scripts/build-portable-exe.ps1`
  - `scripts/setup-local-runtime.ps1`
  - `scripts/backlog.ps1`

## 7) Règle de travail recommandée

1. Vérifier `git status` avant de modifier.
2. Implémenter en gardant la compat local-first (pas de dépendance cloud imposée).
3. Valider au minimum:
   - `npm run build`
   - `cargo check --manifest-path .\\src-tauri\\Cargo.toml`
4. Si impact release:
   - `npm run smoke:e2e`
5. Commit atomique + message explicite + push `main`.
