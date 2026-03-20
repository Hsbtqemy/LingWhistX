# Objectives Checklist (2026-03-20)

Scope: whisperx core + whisperx-studio wrapper.
Status labels: `present`, `partial`, `absent`, `advanced`.

## 1) Coeur timeline
- [ ] Timeline canonique unique (`words[]`, `segments[]`, `speaker_turns[]`, `events[]`) -> `partial` (WX-301)
- [ ] `speaker_turns[]` first-class export -> `absent` (WX-303)
- [ ] `events[]` (overlap/non-speech/musique/foule) -> `absent` (WX-303, WX-304)

## 2) Entrees et robustesse gros fichiers
- [x] Lecture media locale (audio/video) -> `present`
- [x] Normalisation mono/16k via ffmpeg -> `present`
- [ ] Pipeline chunked explicite + merge offsets globaux -> `partial` (WX-302)
- [ ] Controle niveau peak/RMS configurable -> `absent` (WX-302)

## 3) Transcrire / aligner / diariser
- [x] ASR parametres essentiels (model/language/device/compute_type/batch) -> `present`
- [x] Alignement mot + interpolation nearest/linear/ignore -> `present`
- [ ] Flags qualite mot (`unaligned`, `interpolated`, `low_confidence`) -> `absent` (WX-306)
- [x] Diarization + attribution speaker mots/segments -> `present`
- [ ] UI Studio min/max/force_n_speakers -> `partial` (WX-309)

## 4) Analyse SHS
- [ ] Pauses lexicalisees (`pauses[]`) -> `absent` (WX-304)
- [ ] Pauses acoustiques (`nonspeech_intervals[]`) -> `absent` (WX-304)
- [ ] IPU (`ipus[]`) -> `absent` (WX-305)
- [ ] Transitions (`transitions[]`) -> `absent` (WX-305)
- [ ] Overlaps analytiques (`overlaps[]`) -> `absent` (WX-305)

## 5) Qualite et tracabilite
- [ ] KPIs analytiques (ratios interpolation/non-align, overlap ratio, stats speaker) -> `absent` (WX-306)
- [ ] Flags zones a corriger -> `partial` (QA editor existe, pipeline analytics absent) (WX-306)

## 6) Exports
- [ ] `run.json` complet (config + versions + chunk offsets) -> `absent` (WX-307)
- [ ] `timeline.jsonl`/`transcript.json` canonique -> `partial` (WX-307)
- [ ] `words.csv`, `pauses.csv`, `ipu.csv` -> `absent` (WX-307)
- [x] `SRT/VTT/TXT/JSON` -> `present`
- [ ] `RTTM`, `TextGrid`, `EAF` -> `absent` (WX-311)
- [ ] Parquet -> `absent` (WX-307)

## 7) CLI + config reproductible
- [ ] CLI orchestrateur `run/transcribe/align/diarize/analyze/export` -> `absent` (WX-308)
- [ ] Config YAML/TOML utilisateur -> `absent` (WX-308)
- [ ] Dossier `runs/<timestamp>_<id>/` immuable + manifest -> `partial` (WX-308)

## 8) MVP cible
- [ ] Ingestion + normalisation + chunking + merge offsets -> `partial` (WX-302)
- [x] Transcription + alignement mot -> `present`
- [ ] Diarization controls completes en UI -> `partial` (WX-309)
- [ ] `pauses[]` + `ipus[]` -> `absent` (WX-304, WX-305)
- [ ] Exports JSON+CSV analytiques -> `partial` (WX-307)
- [ ] Rerun analyze-only -> `absent` (WX-310)

## Deja plus avance que cible initiale
- [x] Editeur temporel interactif (split/merge/drag/snap)
- [x] Undo/redo unifie + autosave/recovery draft
- [x] Runtime assistant local + diagnostics
- [x] QA panel transcript (gaps/overlaps/debit) avec auto-fix
- [x] CI Python + Studio + security audit + nightly audio e2e

