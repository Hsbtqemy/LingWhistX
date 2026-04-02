# Revue par module (whisperx-studio)

Synthèse agrégée ; le détail fichier à fichier est dans [01-inventaire-fichiers.md](./01-inventaire-fichiers.md).

## Point d’entrée & shell (`src/main.tsx`, `App.tsx`, `App.css`)

- **main.tsx** : montage React, thème, strict mode — OK.
- **App.tsx** : orchestration vues (`create`, `workspace`, `jobs`, `player`, `about`), refs pour injection pipeline JSON, erreurs globales — **Attention** : nombre de props/callbacks ; acceptable pour un shell.
- **App.css** : styles shell — OK.

## Types & constantes (`types.ts`, `constants.ts`, `appVersion.ts`, `vite-env.d.ts`)

- **types.ts** : contrat TS ↔ Rust volumineux — **Attention** : garder synchro avec `models.rs` / commandes ; pas de duplication sauvage.
- **constants.ts** : bornes waveform, etc. — OK.
- **appVersion.ts** : version affichée — OK.

## Utilitaires (`appUtils.ts`, `utils/*`, `waveformWxenv.ts`, `docUrls.ts`)

- **appUtils** : chemins, horloge, clamps — bien testé (`appUtils.test.ts`).
- **jobPipelineStages**, **jobLogSections**, **liveTranscript**, **pausesCsv**, **droppedFilePath**, **expectedOutputFormats** : logique pure + tests — **OK**.
- **waveformWxenv.ts** : lecture WXENV côté client — **Attention** : cohérence avec backend `wxenv.rs`.

## Configuration UI (`config/studioHubSections.ts`)

- Sections hub d’accueil — OK ; contenu éditorial.

## Thème (`theme/applyStoredTheme.ts`, `styles/*.css`)

- Tokens + responsive + **main.css** très volumineux — **Suivi** : éviter doublons ; préférer tokens pour nouveaux écrans.

## Hooks racine & orchestration

| Module                                                                | Commentaire                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **useStudioWorkspace**                                                | Cœur Studio : jobs, run details, explorer — **Attention** : fichier dense, point central des régressions. |
| **useJobsList**                                                       | Pagination SQLite — OK ; tests présents.                                                                  |
| **useNewJobForm**                                                     | Formulaire création job — OK.                                                                             |
| **useRuntimeDiagnostics**                                             | Runtime Python / FFmpeg — OK.                                                                             |
| **useStudioExplorer**                                                 | Calques explorer — OK ; sous-modules extraits.                                                            |
| **useAppErrorStack**                                                  | Pile erreurs max 5 — OK ; test présent.                                                                   |
| **usePreviewOutput** / **useOpenLocalPath** / **useSelectedJobMedia** | Utilitaires navigation média — OK.                                                                        |

## Hooks Player & ondeforme

| Module                   | Commentaire                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| **usePlayerPlayback**    | Manifest, média, transport — **Attention** : sync `mediaLoadError` / asset.        |
| **usePlayerKeyboard**    | Raccourcis — OK.                                                                   |
| **usePlayerRunWindow**   | Fenêtre SQLite `query_run_events_window` — OK ; throttle coarse.                   |
| **useWaveformWorkspace** | État ondeforme lourd — **Attention** ; partagé Studio + Player (`playerMediaRef`). |
| **useWaveformCanvas**    | Rendu canvas — OK.                                                                 |

## Hooks transcript (`hooks/transcript/*`)

- Découpage **solide** : I/O Tauri, split/merge, navigation, QA, brouillon, historique, clavier, pointeur waveform.
- **useTranscriptEditor.ts** : agrégateur volumineux — **Attention** : candidat prioritaire découpe (**WX-641**).
- Tests nombreux sur sous-modules — **OK**.

## Hooks explorer (`hooks/explorer/*`)

- Recalcul couches, UI, config — tests unitaires — **OK**.

## Composants racine Studio

- **StudioNav**, **HomeHub**, **StudioHero**, **StudioWorkspaceSection**, sections New job / Jobs / Open run / Advanced / About / Preferences — rôles clairs — OK.
- **WhisperxOptionsForm** : options WhisperX — **Attention** : complexité (formats, pipeline).
- **JobsHistoryPanel** : historique + suppression — OK.

## Composants run details

- **RunDetailsPanel** : composition onglets — OK.
- **AlignmentWorkspacePanel** : ondeforme + alignement — **Attention** : très gros composant.
- **TranscriptEditorPanel**, **LiveTranscriptFeed**, **WaveformOverviewStrip**, etc. — cohérents avec hooks.

## Composants Player

- **PlayerWorkspaceSection** : composition Player + ondeforme — **Attention** : plusieurs hooks synchronisés.
- **PlayerWaveformPanel** : duplication partielle toolbar Studio — **Suivi** : factorisation optionnelle plus tard.

## Composants UI (`components/ui/*`)

- Primitives **Button**, **Tabs**, **Badge**, **LayerList**, **StatsCard** — OK.

## Player logique pure (`player/derivePlayerAlerts.ts`)

- Dérivation alertes depuis slice — testé — OK.

## Web & audio front

- **webAudioPlayback.ts** : Web Audio + IPC base64 — **Attention** perf IPC (**WX-642**).
- **WorkerErrorMessage.tsx** : parsing stderr — OK.

## Dev (`dev/ipcPerf.ts`)

- Outil perf — ne pas embarquer en prod sans garde — **Suivi**.

## Rust `src-tauri/src`

| Fichier / module                                               | Commentaire                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **lib.rs**                                                     | Enregistrement commandes — OK.                                             |
| **main.rs**                                                    | Entrée binaire — OK.                                                       |
| **db.rs** / **jobs.rs**                                        | SQLite jobs — OK.                                                          |
| **job_commands.rs**                                            | CRUD jobs, worker — OK.                                                    |
| **path_guard.rs**                                              | Validation chemins — **force** du produit.                                 |
| **local_fs_commands.rs**                                       | Lecture dossiers / preview texte — OK.                                     |
| **run_commands.rs**                                            | Manifest, runs récents — OK.                                               |
| **run_events/** + **run_events_recalc.rs**                     | Import + requêtes + recalcul — **Attention** complexité SQL.               |
| **transcript_commands.rs**                                     | Save/export transcript — OK.                                               |
| **waveform.rs** / **wxenv.rs**                                 | Génération ondeforme / pyramide — **Attention** tâches async + annulation. |
| **audio_preview.rs**                                           | ffmpeg + lecture WAV IPC — OK.                                             |
| **ffmpeg\_\*.rs** / **python_runtime.rs** / **runtime\_\*.rs** | Installation outils — OK.                                                  |
| **hf_token_commands.rs**                                       | Token HF — OK.                                                             |
| **models.rs**                                                  | Alignement avec `types.ts` — **Suivi** synchro.                            |
| **smoke_tests.rs**                                             | Tests Rust — OK.                                                           |

## Python (`python/worker.py`)

- Orchestration sous-processus WhisperX — **Attention** : ~900 lignes ; logs et codes retour critiques pour l’UI — voir backlog **WX-641** (doc/tests ciblés) si besoin.

## Fichiers de test (`*.test.*`)

- Couverture inégale : **fort** sur utils et transcript ; **plus faible** sur certains composants purement visuels — acceptable si E2E manuel.
