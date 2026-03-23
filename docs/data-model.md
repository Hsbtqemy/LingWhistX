# Modèle de données v1 (timeline + run)

Résumé pour contributeurs : objets principaux, invariants, exports. Détail code : `whisperx/schema.py`, `whisperx/timeline.py`, `whisperx/run_manifest.py`.

## Objets A–J (vue synthétique)

| Id | Objet | Rôle |
|----|--------|------|
| A | RunManifest | Identifiant de run, média, pipeline, chemins d’artefacts relatifs, stats |
| B | MediaInfo | Fingerprint, durée, format |
| C | Segment | Texte, start/end, speaker, chunk |
| D | Word | token, intervalle, alignment_status, flags |
| E | SpeakerTurn | Intervalle par locuteur |
| F | Pause | intra_speaker_word_gap, transition_gap, global_nonspeech |
| G | IPU | Unités de parole entre pauses (`word_ids`, flags) |
| H | Transition | Locuteurs from/to, bornes, gap |
| I | Overlap | Chevauchement de tours |
| J | Événements | overlap, non_speech, etc. |

## Invariants (rappel)

- Temps en secondes, quantification ms stable (`quantize_time_seconds` / arrondi cohérent).
- Intervalles : `start < end` pour tout objet temporel validé.
- CSV / JSONL : UTF-8, en-têtes stables (voir `write_data_science_exports`).

## Exports obligatoires par run (data science)

`run_manifest.json`, `*.timeline.json`, `*.timeline.jsonl`, `*.words.csv`, `*.pauses.csv`, `*.ipu.csv`, `*.segments.srt`, `*.segments.vtt`.

Formats optionnels annotation : RTTM, TextGrid, EAF (WX-311).

## Carte des tests backlog (WX-505 … WX-510)

| ID | Fichier(s) test | Focus |
|----|-------------------|--------|
| WX-505 | `tests/test_analysis_pure.py` | Temps, intervalles, tri |
| WX-506 | `tests/test_synthetic_timeline.py` | Timeline synthétique |
| WX-507 | `tests/test_pipeline_e2e_real_audio.py` | E2E audio (marqueur `integration`) |
| WX-508 | `tests/test_chunking_merge.py`, `tests/test_chunk_merge_regression.py` | Merge chunks, offsets |
| WX-509 | `tests/test_robustness_errors.py` | Erreurs prévisibles |
| WX-510 | `tests/test_regression_golden.py`, `tests/fixtures/golden_metrics.json` | Métriques figées |

Mise à jour golden : `UPDATE_GOLDEN_METRICS=1 pytest tests/test_regression_golden.py -q` puis relecture du diff.

## Prochaine tâche

Lister les items : `node whisperx-studio/scripts/backlog.mjs -Action list` (depuis `whisperx-studio/`, voir `package.json`).
