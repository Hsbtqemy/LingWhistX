# Roadmap Implementation

Date: 2026-03-19

## Phase 0 - Stabilisation moteur (1-3 jours)

Objectif: fiabiliser la base avant wrapper.

Actions:

1. Corriger `result["language"]` pour conserver la langue reelle par fichier.
2. Rebrancher options CLI ignorees (`best_of`, `condition_on_previous_text`, `segment_resolution` ou suppression du flag).
3. Nettoyer packaging (`MANIFEST.in` vs fichiers reels).
4. Ajouter smoke tests CLI minimum.

Livrables:

- PR "engine-consistency".
- 5-10 tests unitaires/smoke.

## Phase 1 - MVP wrapper audio (3-7 jours)

Objectif: pipeline audio complet avec artefacts intermediaires.

Actions:

1. Creer package `whisperx_wrapper/`.
2. Implementer stages: ingest -> calibrate -> asr -> clean -> align -> diarize -> export.
3. Definir schema `RunArtifact` unique (`jsonschema` ou pydantic).
4. Sorties standardisees (`*.raw.json`, `*.cleaned.json`, `*.aligned.json`, `*.srt`).
5. Rapport QA auto (`report.md` + `metrics.json`).

Livrables:

- CLI wrapper: `wxw run input.ext --profile <name>`.
- Config par profils YAML (podcast, meeting, interview, noisy).

## Phase 2 - Qualite et calibration avancee (4-10 jours)

Objectif: robustesse production audio.

Actions:

1. Ajouter calibration audio configurable (loudness/denoise/noise gate).
2. Post-align smoothing et contraintes monotones.
3. Confidence-aware rewriting (segments low confidence only).
4. Benchmarks automatiques sur corpus de reference.

Livrables:

- Table comparative avant/apres (WER/CER + timing error).

## Phase 3 - Extension video (7-20 jours)

Objectif: AV alignment.

Actions:

1. Extraction audio+frames+metadata (ffmpeg/pyav).
2. OCR keyframes (slides, lower-thirds, name tags).
3. Fusion cues visuels avec segments alignes audio.
4. Export enrichi (JSON timeline unifiee + sous-titres ameliores).

Livrables:

- `transcript.av_aligned.json`.
- Dataset de validation video et metriques dediees.

## Backlog prioritaire (ordre strict)

1. Fix langue en sortie.
2. Fix options CLI incoherentes.
3. Ajouter tests timing/alignement (golden files).
4. Introduire wrapper audio minimal.
5. Ajouter calibration audio avancee.
6. Ajouter pipeline video.

## Risques de planning

1. Dependances lourdes GPU/pyannote selon environnements.
2. Variabilite des performances selon langues/domaines.
3. Cout de la phase video (OCR + fusion cues) potentiellement eleve.

## Definition of done (MVP audio)

1. Execution stable sur un lot de fichiers heterogenes.
2. Artefacts intermediaires complets et reproductibles.
3. Rapport qualite genere automatiquement.
4. Regression couverte par tests CI.
