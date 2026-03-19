# Workspace Audit

Date: 2026-03-19

## 1) Perimetre et structure

Repo cible: `whisperx` (package Python, CLI + API).

Arborescence principale:

- `whisperx/__main__.py`: CLI.
- `whisperx/transcribe.py`: orchestration pipeline.
- `whisperx/asr.py`: inference ASR batchee (faster-whisper) + VAD.
- `whisperx/alignment.py`: forced alignment wav2vec2.
- `whisperx/diarize.py`: diarization pyannote + attribution speaker.
- `whisperx/audio.py`: chargement et resampling audio via ffmpeg.
- `whisperx/utils.py`: writers (srt/vtt/txt/tsv/json/aud), utilitaires.
- `whisperx/vads/*`: VAD pyannote/silero.

## 2) Capacites fonctionnelles actuelles

- Transcription audio multilingue (faster-whisper).
- Decoupage via VAD (pyannote ou silero).
- Alignement mot/char sur audio via wav2vec2 (torchaudio/HF).
- Diarization speaker (pyannote speaker-diarization-community-1).
- Exports texte/sous-titres: `txt`, `json`, `srt`, `vtt`, `tsv`, `aud`.

## 3) Forces techniques

- Pipeline modulaire clair: ASR -> align -> diarize -> write.
- Support CPU/GPU.
- API Python exploitable pour encapsulation wrapper.
- Typage partiel via `TypedDict` (schema de resultats).
- VAD pyannote embarque avec poids local (`whisperx/assets/pytorch_model.bin`), limitant un telechargement externe.

## 4) Constat quality engineering

### 4.1 CI/tests

- CI existante mais minimale: import test uniquement (`.github/workflows/python-compatibility.yml`).
- Pas de dossier tests (`tests/` absent).
- Pas de lint/typecheck gates (ruff/mypy/pytest absents en pipeline).

Impact: risque de regressions silencieuses sur timing, langue, formats de sortie.

### 4.2 Parametres CLI non exploites ou partiellement exploites

Constats detectes:

- `--segment_resolution` defini mais non consomme (`whisperx/__main__.py`).
- `--fp16` defini mais non consomme (`whisperx/__main__.py`).
- `--best_of` defini CLI mais non injecte dans `asr_options` de `transcribe_task` (`whisperx/transcribe.py`).
- `--condition_on_previous_text` existe mais la valeur est forcee a `False` dans `transcribe_task` (`whisperx/transcribe.py`).

Impact: ecart entre contrat CLI et comportement reel.

### 4.3 Gestion de langue en sortie

`whisperx/transcribe.py` force `result["language"] = align_language` en fin de pipeline.

Effets:

- en autodetection, la langue detectee peut etre ecrasee (ex. fallback `en`);
- en lot multilingue, les fichiers de sortie peuvent recevoir une langue incorrecte.

Impact: degradation possible des regles de rendu (notamment langues sans espaces) et metadonnees incoherentes.

### 4.4 Packaging

`MANIFEST.in` reference `requirements.txt` alors que le fichier n'existe pas.

Impact: fragilite packaging/release (warnings/incoherences).

## 5) Limites par rapport au besoin cible (wrapper calibration/cleaning/alignment)

### 5.1 Nettoyage/curation texte

Le repo fait la transcription + alignement, mais pas de couche explicite de:

- normalisation textuelle configurable (ponctuation, casing, nombres/unites),
- correction contextuelle metier (lexiques domaines, entities),
- score qualite/fiabilite par segment.

### 5.2 Calibration temporelle avancee

Present: alignment phoneme-based.  
Absent: calibration multi-passes et contraintes temporelles globales (drift long format, continuity enforcement, retiming policies).

### 5.3 Video

Aucun pipeline video natif:

- pas d'extraction de frames/shot boundaries,
- pas d'OCR, pas de lip/speaker visual cues,
- pas de fusion audio-image pour realigner texte/scene.

### 5.4 Observabilite et reproductibilite

Pas de couche de telemetry structuree (latence stage, score stage, erreurs stage, artefacts intermediaires traces).

## 6) Faisabilite wrapper

Faisable sans refactor massif car points d'extension deja disponibles:

- `load_audio` (ingestion),
- `load_model(...).transcribe(...)` (ASR),
- `align(...)` (timing fin),
- `DiarizationPipeline(...)/assign_word_speakers(...)`,
- writers `utils.get_writer(...)`.

Recommandation: wrapper externe orchestration + politique qualite, sans casser le coeur WhisperX au debut.

## 7) Risques majeurs a traiter avant production

1. Contrat CLI/API incoherent (options ignorees).
2. Qualite non verifiee automatiquement (absence tests E2E de timing/accuracy).
3. Video non supportee (si objectif final audio+image).
4. Absence de modele de donnees unifie pour artefacts intermediaires (audio cleaned, transcript raw/clean, align map, confidence map).
