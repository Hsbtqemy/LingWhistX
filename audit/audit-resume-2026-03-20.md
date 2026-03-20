# Audit Resume

Date: 2026-03-20

## 1) Scope

Ce document met a jour l'audit initial du 2026-03-19 apres les correctifs pushes sur `main`.

Perimetre:
- package Python `whisperx/`
- desktop app `whisperx-studio/`
- CI GitHub Actions

## 2) Constats critiques de l'audit initial: statut

### A. Contrat CLI incoherent (flags ignores)

Statut: **RESOLU**

Preuves:
- `best_of` passe maintenant de la CLI aux options ASR:
  - `whisperx/__main__.py:52`
  - `whisperx/transcribe.py:115`
- `condition_on_previous_text` n'est plus force a `False` dans `transcribe_task`:
  - `whisperx/__main__.py:62`
  - `whisperx/transcribe.py:122`
- `segment_resolution` est consomme dans le writer:
  - `whisperx/transcribe.py:130`
  - `whisperx/transcribe.py:141`
  - `whisperx/utils.py:256`

### B. Ecrasement de langue en sortie

Statut: **RESOLU**

Preuves:
- conservation de la langue detectee apres alignement:
  - `whisperx/transcribe.py:192`
  - `whisperx/transcribe.py:221`
- fallback langue uniquement si absente:
  - `whisperx/transcribe.py:260`

### C. Exposition du token HF via ligne de commande

Statut: **RESOLU (niveau P0)**

Preuves:
- worker Python lit le token via env vars:
  - `whisperx-studio/python/worker.py:132`
  - `whisperx-studio/python/worker.py:185`
- backend Rust retire le token du JSON worker et l'injecte en env:
  - `whisperx-studio/src-tauri/src/lib.rs:1738`
  - `whisperx-studio/src-tauri/src/lib.rs:1742`
- token retire des options persistees:
  - `whisperx-studio/src-tauri/src/lib.rs:301`
  - `whisperx-studio/src-tauri/src/lib.rs:2125`

### D. Incoherence packaging MANIFEST

Statut: **RESOLU**

Preuve:
- `MANIFEST.in` ne reference plus `requirements.txt`:
  - `MANIFEST.in:1`

### E. Absence de gate quality automatisee

Statut: **PARTIELLEMENT RESOLU**

Preuves:
- nouveau job CI quality Python (`ruff` + `pytest`):
  - `.github/workflows/python-compatibility.yml:11`
  - `.github/workflows/python-compatibility.yml:29`
  - `.github/workflows/python-compatibility.yml:32`
- nouveau workflow CI Studio matrix Windows/Linux:
  - `.github/workflows/studio-ci.yml:20`
  - `.github/workflows/studio-ci.yml:21`
  - `.github/workflows/studio-ci.yml:58`
- tests ajoutes:
  - `tests/test_transcribe_cli_contract.py:89`
  - `tests/test_worker_hf_token_transport.py:33`
  - `tests/test_writer_golden_outputs.py:80`
  - `tests/test_pipeline_e2e_real_audio.py:75`
  - `tests/golden/writers/english_sentence.srt:1`

## 3) Points restant ouverts

### 1. Couverture de tests encore faible sur coeur metier timing

Constat:
- une base golden est en place pour les writers (`JSON/SRT/VTT`) et `segment_resolution`.
- un test E2E sur vrai audio est present en mode opt-in (`WHISPERX_RUN_AUDIO_E2E=1`).
- execution E2E audio reel branchee dans un workflow dedie `nightly + manuel`:
  - `.github/workflows/audio-e2e-nightly.yml:1`

Risque:
- regressions silencieuses possibles sur pipeline complet (pas seulement format d'export).

Priorite: **P1**

### 2. Pas de gate type-check statique

Constat:
- CI execute `ruff` et `pytest`, mais pas `mypy`/`pyright`.

Risque:
- erreurs de type non detectees sur chemins moins couverts par tests.

Priorite: **P2**

### 3. Pas de security/dependency scanning automatise

Constat:
- aucun workflow dedie aux CVE/dependances (`pip-audit`, `safety`, Dependabot).

Risque:
- detection tardive de vuln vulnerabilites supply-chain.

Priorite: **P1**

### 4. Dette de modularite UI Studio

Constat:
- `whisperx-studio/src/App.tsx` reste tres volumineux (~3184 lignes).

Risque:
- cout de revue eleve et probabilite de regressions lors des evolutions UI.

Priorite: **P2**

## 4) Recommandations concretement actionnables

Ordre recommande:

1. Ajouter un mini corpus de tests golden (audio court + snapshots JSON/SRT/VTT attendus).
2. Ajouter un job CI `security-python` (ex: `pip-audit`) en mode warning puis gate.
3. Ajouter `mypy` en mode progressif (start sur `whisperx/transcribe.py`, `whisperx/utils.py`).
4. Decouper `App.tsx` par domaines (jobs, transcript editor, runtime panel, waveform).

## 5) Conclusion

Les points critiques P0 du premier audit (contrat CLI, langue, token HF, packaging) sont traites.
Le niveau global passe de "fonctionnel mais fragile" a "fonctionnel avec quality gates de base".
La prochaine marche de maturite est la robustesse de non-regression sur timings et la securite supply-chain.
