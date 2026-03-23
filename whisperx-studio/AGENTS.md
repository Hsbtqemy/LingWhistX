# AGENTS.md

Guide de passation rapide pour les futurs agents sur `whisperx-studio`.

## 1) Contexte projet

- Nom produit UI: `LingWhistX`.
- Stack: Tauri v2 + React + Rust + worker Python.
- Objectif: wrapper local-first WhisperX avec edition transcript/timings, analyse linguistique, exports et runs reproductibles.

## 2) Etat actuel

- Backlog executable: `backlog/backlog.json`
- IPC / tailles de payloads : section **Architecture IPC (Tauri)** dans `README.md` (WX-620).
- Tickets historiques `WX-201` a `WX-210`: `done`
- Tickets audit/reprise deja livres:
  - `WX-301` timeline canonique (segments/words/speaker_turns/events)
  - `WX-302` pipeline chunked gros fichiers + merge offsets
  - `WX-303` diarization avancee min/max/force_n
  - `WX-304` analyses pauses lexicalisees + non-speech
  - `WX-305` IPU + transitions + overlaps analytiques
  - `WX-306` metriques qualite + zones suspectes + resume dans artefacts
  - `WX-307` exports data-science (`run.json`, `timeline.json`, `words.csv`, `pauses.csv`, `ipu.csv`)
  - `WX-310` mode `analyze_only` (recalcul metriques sans relancer ASR)
- `WX-308` CLI orchestrateur: sous-commandes `run`/`transcribe`/`align`/`diarize`/`analyze`/`export`, `--config` YAML/TOML, `--immutable-run` + `manifest.json` sous `runs/`.
- `WX-309` Studio: diarization min/max/force + erreurs worker enrichies (Rust) + affichage multiligne / aides HF dans l UI.
- `WX-311` exports annotation: `--export_annotation_rttm` / `--export_annotation_textgrid` / `--export_annotation_eaf` (voir README LingWhistX additions).
- `WX-312` non-regression chunk: `whisperx/chunk_merge.py`, `tests/test_chunk_merge_regression.py`, E2E optionnel `test_pipeline_e2e_media_chunking` + workflow nightly (voir README).

## 3) Commandes utiles

- Premier clone: `cd whisperx-studio && npm ci` (recommande) ou `npm install`
- Dev:
  - `npm run tauri dev`
- Build app:
  - `npm run build`
  - `cargo check --manifest-path .\src-tauri\Cargo.toml`
  - `npm run tauri build`
- Qualite (ESLint + Prettier + Vitest):
  - `npm run lint`
  - `npm run format` (ou `npm run format:check` en CI)
  - `npm run test`
- Rust (crate Tauri, depuis la racine du repo ou `whisperx-studio/src-tauri`):
  - `cargo fmt --manifest-path whisperx-studio/src-tauri/Cargo.toml` (formater)
  - `cargo fmt --manifest-path whisperx-studio/src-tauri/Cargo.toml --check` (verifier en CI)
  - `cargo clippy --manifest-path whisperx-studio/src-tauri/Cargo.toml -- -D warnings`
  - `cargo test --manifest-path whisperx-studio/src-tauri/Cargo.toml`
- Backlog:
  - `npm run backlog:list`
  - `npm run backlog:ready`
  - `npm run backlog:next`
  - `npm run backlog:set -- -Id WX-XXX -Status done`
  - macOS/Linux (sans PowerShell): `npm run backlog:list:unix` (idem `ready:unix`, `next:unix`, `show:unix`, `set:unix`) ou `./scripts/backlog.sh -Action list`
- Runtime local:
  - `npm run runtime:setup`
- Smoke release:
  - `npm run smoke:e2e`
- EXE portable:
  - `npm run build:portable-exe`

## 4) Modes worker

- `mock`: ecriture d artefacts de test sans ASR.
- `whisperx`: pipeline complet ASR + align + diarization + timeline.
- `analyze_only`: relit un JSON existant et recalcule analyses timeline (pauses/IPU/transitions) sans relancer ASR/alignment/diarization.

## 5) Exports

- Exports standards WhisperX: `json/srt/vtt/txt/tsv/aud` selon option.
- Exports data-science (actifs par defaut):
  - `<basename>.run.json`
  - `<basename>.timeline.json`
  - `<basename>.words.csv`
  - `<basename>.pauses.csv`
  - `<basename>.ipu.csv`
- En `analyze_only`: nouveaux artefacts ecrits dans un sous-dossier versionne `analysis-<timestamp>` du dossier output.

## 6) Livrables release

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

## 7) Pieges connus / decisions

- Pour un exe desktop valide, eviter `cargo build` direct pour distribution.
  - Utiliser `tauri build --no-bundle` via `npm run build:portable-exe`.
  - Sinon risque d ouverture sur `localhost` (mode dev URL).
- `build-portable-exe.ps1` coupe automatiquement le process cible si exe locke.
- Compat parsing worker Python:
  - backend Rust accepte `output_files` (snake_case) + camelCase.
- Fallback ressources:
  - `worker.py` et `setup-local-runtime.ps1` embarques en fallback dans le binaire (`app_local_data_dir/embedded-resources`).
- Runtime machine cible:
  - `whisperx` complet: Python + WhisperX + ffmpeg.
  - `analyze_only`: Python + WhisperX (pas de ffmpeg obligatoire).

## 8) Fichiers coeur

- Frontend:
  - `src/App.tsx`
  - `src/App.css`
  - Erreurs utilisateur: composant `src/components/ErrorBanner.tsx` (`role="alert"`), prop `multiline` pour logs ou `<WorkerErrorMessage />` ; styles dans `App.css` (`.error-banner*`). Eviter les boites d erreur ad hoc.
- Backend Rust:
  - `src-tauri/src/lib.rs`
- Worker:
  - `python/worker.py`
- Coeur Python:
  - `../whisperx/transcribe.py`
  - `../whisperx/timeline.py`
  - `../whisperx/utils.py`
- Scripts:
  - `scripts/smoke-e2e.ps1`
  - `scripts/build-portable-exe.ps1`
  - `scripts/setup-local-runtime.ps1`
  - `scripts/backlog.ps1`

## 9) Regle de travail recommandee

1. Verifier `git status` avant modification.
2. Conserver le mode local-first (pas de dependance cloud imposee).
3. Valider au minimum:
   - `python -m pytest -q tests`
   - `npm run build`
   - `cargo check --manifest-path .\src-tauri\Cargo.toml`
4. Si impact release:
   - `npm run smoke:e2e`
5. Commit atomique + message explicite + push `main`.
