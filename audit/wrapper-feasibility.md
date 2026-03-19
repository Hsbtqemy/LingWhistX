# Wrapper Audio/Video - Faisabilite et Design Cible

Date: 2026-03-19

## Objectif

Construire un wrapper qui:

- calibre l'audio (niveau, denoise, segmentation robuste),
- nettoie/cure/retravaille le texte,
- aligne finement texte <-> waveform,
- et, en extension, exploite la video (frames/OCR/cues visuels) pour renforcer l'alignement.

## Reponse courte

Oui, c'est faisable avec cette base, via une couche wrapper modulaire autour de WhisperX.

## Architecture cible (proposee)

### Stage 0 - Ingestion

- Inputs supportes: `wav/mp3/m4a/flac/mp4/mkv`.
- Pour video: extraction audio + metadata timeline + keyframes.

Sorties intermediaires:

- `audio.raw.wav` (16k mono),
- `video.meta.json` (fps, duration, streams).

### Stage 1 - Calibration audio

- Loudness normalization (LUFS policy).
- Denoise optionnel (RNNoise/DeepFilterNet).
- DC offset + clipping detection.
- VAD pre-pass configurable.

Sorties:

- `audio.calibrated.wav`,
- `audio.qc.json` (SNR, clipping ratio, silence ratio).

### Stage 2 - ASR brut

- Appel WhisperX `load_model().transcribe(...)`.
- Capture segments + avg_logprob + langue detectee.

Sorties:

- `transcript.raw.json`.

### Stage 3 - Nettoyage/curation texte

- Normalisation configurable (ponctuation, espaces, casing).
- Regles domaine (glossaires, acronymes, substitutions).
- Optional LLM polishing sur segments faible confiance.

Sorties:

- `transcript.cleaned.json`,
- `transcript.diff.json`.

### Stage 4 - Alignement audio fin

- Appel `load_align_model` + `align`.
- Interpolation policy pour mots non alignables.
- Post-calibration temporelle (smoothing, monotonic constraints).

Sorties:

- `transcript.aligned.json`,
- `word_timing.csv`.

### Stage 5 - Diarization et fusion speaker

- Appel `DiarizationPipeline` + `assign_word_speakers`.
- (Option) embeddings pour stabiliser speaker IDs inter-fichiers.

Sorties:

- `transcript.aligned.speakers.json`.

### Stage 6 - Extension video (phase 2)

- OCR de frames clefs (noms, slides, lower-thirds).
- Face/speaker visual cues (optionnel selon cout).
- Realign contextuel texte-scene (ex: changement slide <-> topic boundary).

Sorties:

- `video.cues.json`,
- `transcript.av_aligned.json`.

## Contrat de donnees recommande

Unifier tous les stages autour d'un schema unique, ex:

- `media_id`
- `source` (audio/video, codecs, duration)
- `segments[]` (raw/clean/aligned fields)
- `words[]` (start/end/score/speaker/source_stage)
- `quality` (confidence, qc audio, warnings)
- `provenance` (models, versions, params, timestamps execution)

## Gaps a combler dans WhisperX avant/pendant wrapper

1. Corriger la langue forcee en sortie (`transcribe.py`).
2. Reconnecter les flags CLI ignores (`best_of`, `condition_on_previous_text`, etc.).
3. Ajouter tests E2E avec golden files (timings + texte + speakers).
4. Ajouter hooks observabilite par stage (durations, erreurs, stats).

## Choix d'implementation wrapper

Option recommandee:

- Nouveau package `whisperx_wrapper/` (orchestration, policies, QA, IO).
- WhisperX conserve comme moteur ASR/align/diarize.
- API Python + CLI propre au wrapper (`wxw run ...`).

Pourquoi:

- limite le risque de casser le moteur existant,
- facilite migration progressive,
- permet mode "strict reproducible pipeline" avec artefacts versionnes.

## Metriques de succes

- WER/CER (global + par domaine).
- Erreur temporelle mediane des mots (ms).
- Drift cumulatif sur long format (par 10 min).
- Couverture alignement (`% words with timestamps`).
- Stabilite diarization (`speaker switch error rate`).
- Pour video: gain relatif sur erreurs temporelles dans scenes complexes.
