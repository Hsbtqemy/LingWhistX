# LingWhistX — CLAUDE.md

Application desktop de transcription automatique avec diarisation, basée sur WhisperX.
Architecture : **React 19 + TypeScript** (UI) / **Tauri 2 + Rust** (backend) / **Python** (pipeline ASR).

---

## Structure du projet

```
LingWhistX/
├── whisperx-studio/          # Application desktop Tauri
│   ├── src/                  # Frontend React/TypeScript
│   ├── src-tauri/src/        # Backend Rust (28 fichiers .rs)
│   ├── python/               # Worker IPC (worker.py)
│   └── backlog/backlog.json  # Backlog exécutable (WX-xxx)
├── whisperx/                 # Package Python CLI (28 modules)
│   ├── cli.py                # Sous-commandes : run, transcribe, align, diarize, analyze, export
│   ├── transcribe.py         # ASR faster-whisper
│   ├── alignment.py          # Alignement phonémique wav2vec2
│   ├── diarize.py            # Diarisation pyannote-audio
│   ├── analysis.py           # Pauses / IPU / tours de parole
│   └── annotation_exports.py # SRT, VTT, JSON, CSV, ELAN (à venir)
└── tests/                    # Tests d'intégration Python
```

---

## Commandes essentielles

**Toutes les commandes frontend/Rust se lancent depuis `whisperx-studio/`.**

```bash
# Frontend
npm run build          # tsc + vite build
npm run dev            # dev server Vite
npm test               # vitest run (tests unitaires)
npm run lint           # eslint
npm run format:check   # prettier check

# Rust
cargo check            # vérification rapide (depuis whisperx-studio/)
cargo test             # tests Rust

# Tauri
npm run tauri dev      # app complète en dev
npm run tauri build    # build release

# Backlog (macOS/Linux)
npm run backlog:list:unix
npm run backlog:next:unix
npm run backlog:show:unix -- --id WX-655
npm run backlog:set:unix  -- --id WX-655 --status in_progress

# Python
python -m pytest tests/
python -m whisperx run <media> --output_dir <dir>
```

---

## Architecture frontend (src/)

### Fichiers clés

| Fichier | Rôle |
|---|---|
| `src/types.ts` | Toutes les interfaces TypeScript (~600 lignes) |
| `src/constants.ts` | Presets de profils, valeurs par défaut |
| `src/App.tsx` | Shell principal, routing par onglets |
| `src/hooks/useStudioWorkspace.ts` | Orchestrateur central (jobs, formulaires, explorateur) |
| `src/hooks/useTranscriptEditor.ts` | Éditeur de transcript (segments, historique, QA, draft) |
| `src/hooks/usePlayerPlayback.ts` | Contrôle média (play, seek, volume, loop A-B) |
| `src/hooks/usePlayerRunWindow.ts` | Requêtes SQLite fenêtrées pour le player |
| `src/hooks/useWaveformWorkspace.ts` | État waveform pour un job sélectionné |
| `src/hooks/useWaveformCanvas.ts` | Rendu canvas waveform |

### Sous-dossiers hooks

- `hooks/transcript/` — mutations segments, dirty tracking, draft persistence
- `hooks/explorer/` — toggles de couches, config recalc

### Composants player (`src/components/player/`)

| Fichier | Rôle |
|---|---|
| `PlayerWorkspaceSection.tsx` | Conteneur principal du player |
| `PlayerRunWindowViews.tsx` | 6 vues : lanes, chat, words, columns, rythmo, karaoke |
| `PlayerWaveformPanel.tsx` | Panneau waveform avec sync playhead |
| `playerViewportContract.ts` | Contrats de vue (en cours — WX-660) |

### Vues player disponibles

`lanes` · `chat` · `words` · `columns` · `rythmo` · `karaoke`

---

## Architecture Rust (src-tauri/src/)

### Fichiers clés

| Fichier | Rôle |
|---|---|
| `lib.rs` | Registre des 40+ commandes Tauri |
| `models.rs` | Types partagés (Job, WhisperxOptions, EventRow…) |
| `db.rs` | SQLite jobs (pagination, CRUD) |
| `jobs.rs` | Gestion sous-processus worker, parsing logs |
| `job_commands.rs` | IPC handlers jobs |
| `run_events/mod.rs` | Schema events.sqlite (words, turns, pauses, ipus) |
| `run_events/player_derived_alerts.rs` | Heuristiques alertes player |
| `run_commands.rs` | Lecture manifestes, runs récents |
| `transcript_commands.rs` | Load/save/export transcripts |
| `waveform.rs` | Génération peaks via FFmpeg, cache FNV-1a |
| `wxenv.rs` | Pyramide waveform WXENV1 multi-niveaux |
| `path_guard.rs` | Validation sécurité des chemins IPC |
| `app_events.rs` | Émetteurs d'événements Tauri |

### Base de données

- **`jobs` (SQLite global)** — état des jobs, options, output_files
- **`events.sqlite` (par run)** — tables `words`, `turns`, `pauses`, `ipus` avec index sur `start_ms, end_ms`
- **Schema versioning** — PRAGMA user_version, migrations v0→v2

---

## Architecture Python

### Worker IPC (`python/worker.py`)

Protocole stdout actuel (en cours de migration vers JSON-lines structuré — WX-657) :
```
__WXLOG__{"level":"info","stage":"wx_transcribe","message":"...","progress":35}
__WXRESULT__{"message":"Success","output_files":[...]}
```

Modes : `mock` · `whisperx` · `analyze_only`

### Pipeline CLI (`whisperx/cli.py`)

Sous-commandes : `run` · `transcribe` · `align` · `diarize` · `analyze` · `export`

Répertoires de run immuables : `runs/<timestamp>_<short_id>/`
Manifeste : `run_manifest.json` (argv, config, versions)

### Modules audio preprocessing (à venir — WX-661 à WX-666)

- `whisperx/audio_assessment.py` — SNR, clipping, durée parole (WX-661)
- `whisperx/audio_preprocessing.py` — loudness, denoising, smart chunking (WX-662/663/664)
- `whisperx/smart_chunking.py` — découpage VAD intelligent (WX-664)

---

## Backlog

Fichier : `whisperx-studio/backlog/backlog.json`
IDs : `WX-xxx` (dernier ID en production : **WX-654**, nouveaux : **WX-655–WX-672**)

### Groupes actifs (tous en `todo`)

| Groupe | IDs | Thème |
|---|---|---|
| Fondations architecture | WX-655 à WX-660 | Params sémantiques, profils, IPC, undo patches, waveform, player contracts |
| Preprocessing audio | WX-661 à WX-666 | Assessment, loudness, denoising, smart chunking, aperçu A/B, séparation sources |
| Player avancé | WX-667 à WX-669 | Vue prosodique stats, karaoke sync, rythmo |
| Exports & annotations | WX-670 à WX-672 | ELAN/TextGrid, rapport HTML, mode batch |

### Ordre de départ recommandé

**WX-655** (restructure options) → **WX-660** + **WX-657** en parallèle → **WX-661/663/664** (audio preprocessing) → **WX-656** (profils) → reste.

---

## Décisions actives

- **Éditeur de correction IA** : hors scope pour l'instant, reporté à plus tard.
- **Paramètres de fréquence vocale bruts (Hz)** : non exposés. Couverts par le débruitage (WX-663) + normalisation (WX-662). Exception : un mode `telephony_bandpass` (300–3400 Hz) sera une option nommée dans WX-662, pas un slider Hz.
- **WX-657** : migration protocole IPC Python→Rust de sentinelles `__WXLOG__` vers JSON-lines structuré avec champ `type`.
- **WX-655** : `WhisperxOptions` sera décomposé en sous-interfaces : `ModelOptions`, `PipelineOptions`, `DiarizationOptions`, `AnalysisOptions`, `AudioPipelineOptions`.

---

## Conventions de code

- TypeScript strict, pas de `any` explicite
- Rust : `Result<T, String>` pour les commandes IPC
- Tests frontend : Vitest + Testing Library
- Nommage hooks : `use<Domaine><Concept>` (ex: `usePlayerRunWindow`, `useTranscriptEditor`)
- CSS via tokens (`--lx-*`) définis dans `src/styles/tokens.css`
- Pas de librairie de charts — canvas natif pour les visualisations
