# LingWhistX Studio (Tauri)

Desktop local-first wrapper skeleton for WhisperX:

- Tauri + React frontend
- Rust command layer for local job orchestration
- Python side worker for pipeline execution (`mock`, `whisperx`, or `analyze_only`)
- Native folder/file picker (Tauri dialog plugin)
- SQLite persistence for local job history
- Realtime logs by stage + job cancellation
- Run Details panel (timeline logs + output preview + open/export actions)
- Transcript editor (segment text edits + save/export SRT/VTT/TXT/JSON)
- Runtime diagnostics panel (Python + WhisperX + ffmpeg readiness)
- First-run assistant to install local runtime from the app (without Docker)
- Alignment workspace (audio/video player + interactive waveform seek + segment start/end drag handles)
- Advanced aligned export rules (min duration, min gap, overlap correction + export report)
- Canonical timeline analytics (pauses, IPU, transitions, overlaps)
- Data-science exports (`run.json`, `timeline.json`, `words.csv`, `pauses.csv`, `ipu.csv`)
- **Ouvrir un run (WX-611)** : valide un dossier contenant `run_manifest.json` (schema v1, produit par le pipeline WhisperX), affiche un résumé, mémorise les dossiers récents, et propose d’ouvrir l’espace de travail si un job Studio pointe vers le même répertoire de sortie.
- **Indexer `events.sqlite` (WX-612)** : depuis un run valide, importe mots / tours / pauses / IPU depuis le `timeline_json` du manifest (fichier `*.timeline.json`) dans une base SQLite `events.sqlite` au même dossier — requêtes fenêtre pour `query_window` (WX-613).
- **Requête fenêtre (WX-613)** : commande `query_run_events_window` avec `{ request: { runDir, t0Ms, t1Ms, layers?, speakers?, limits? } }` — overlap `start_ms < t1Ms AND end_ms > t0Ms`, plafonds par défaut (ex. 5000 mots), JSON compact. Bouton de test 0–30 s après indexation.
- **Pyramide WXENV1 (WX-614)** : commande `build_waveform_pyramid` — décode mono via ffmpeg (f32), enveloppes min/max int16 par blocs de 256… puis fusion ×4 pour niveaux L1–L4 (`block_size` 256/1024/4096/16384/65536 à 16 kHz). Fichiers `envelope_L0.bin` … `envelope_L4.bin` sous `app_local_data/waveforms_wxenv/<hash>/` (header `WXENV1` + payload). Le cache JSON `WaveformPeaks` existant (`waveforms/*.json`) reste utilisé par l’UI actuelle ; les `.bin` sont un format parallèle pour l’overview multi-résolution.
- **Overview + détail WXENV (WX-615)** : commandes `read_wxenv_meta` / `read_wxenv_slice` (tranches ≤ 65 536 blocs par IPC). Après « Pyramide WXENV », bandeau overview (L3 ou L4 selon densité de blocs) + rectangle de fenêtre draggable ; le canvas détail lit l’enveloppe du niveau Lk adapté à la fenêtre visible (sinon repli sur les peaks JSON). Seuils UI : segments overlay si fenêtre ≤ 60 s ; politique mots timeline indiquée (au-delà de 60 s masqués, ≤ 30 s limite future).
- **Explorateur workspace (WX-616)** : barre supérieure (ouvrir run / fichier, indexer `events.sqlite`, export pack JSON+SRT+CSV depuis l’éditeur, résumé média+durée, device job + badges runtime Py/WX/ffmpeg, pastilles stats manifest). Panneau calques (toggles persistés session) et locuteurs (alias, visibilité, solo après `list_run_speakers`). Navigation « pause suivante » via `query_run_events_window` ; « overlap suivant » réservé. Export CSV segments : format `csv` dans `export_transcript`.
- **Recalcul pauses / IPU (WX-617)** : commande `recalc_pauses_ipu` (aperçu `persist: false` ou écriture SQLite `persist: true`) — dérive pauses et IPU depuis la table `words` uniquement (aucun WhisperX). Panneau latéral avec sliders (pause min, ignorer sous, pause max, filtres IPU), stats live (#pauses, moyenne / p95 durée pause, #IPU, overlap total ms).
- **Advanced / compute lourd (WX-618)** : préréglages (WhisperX ± diarization, analyze-only) + rappel explicite que les sliders d’analyse ne déclenchent pas le worker ; confirmation `window.confirm` avant lancement effectif des modes lourds ; progression via lignes JSON `__WXLOG__` sur stdout ; annulation documentée (`kill_process_tree` / `taskkill /T` sous Windows).
- **Lecture Web Audio (WX-619)** : case « Lecture Web Audio » dans l’espace d’alignement ; commande `extract_audio_wav_window` (ffmpeg, WAV mono 16 kHz en cache app, fenêtre autour du playhead, plafond 60 s) ; `WebAudioWindowPlayer` charge les tranches au besoin ; la vidéo reste sur le lecteur natif.
- **IPC Explorer (WX-620)** : documentation des commandes Tauri (pas de timeline complet côté front après import ; fenêtres bornées) ; checklist perf manuelle ; en dev, journalisation des appels IPC Explorer via `ipcInvokeDev` (`src/dev/ipcPerf.ts`).
- **Vue média omniprésente (WX-621)** : dès qu’un chemin média est renseigné sur « Nouveau job », un panneau **Aperçu média** affiche le lecteur (vidéo ou audio) et l’ondeforme sur la même page ; pour la vidéo, lecteur et ondeforme sont dans des zones distinctes (empilées). Le temps de lecture et le seek sont partagés via `useWaveformWorkspace` (même hook que l’espace d’alignement sur un job). Dans l’historique / détail de run, l’**Alignment Workspace** utilise le même découpage visuel.
- **Plage + preview Web Audio (WX-622)** : dans l’Alignment Workspace, sélection d’une plage `[t0, t1]` (glisser sur la waveform en mode dédié, ou saisie numérique, ou bouton « Plage = fenêtre visible »). En lecture « Web Audio », la lecture peut charger uniquement l’extrait plage (`loadRangeChunk`, ffmpeg jusqu’à 60 s). Chaîne preview gain / EQ shelf / balance avec bypass ; le fichier source n’est pas modifié. Bandes vertes / jaunes sur le canvas pour plage validée / drag.

## Prerequisites

- Node.js + npm (after cloning, run `npm ci` or `npm install` inside `whisperx-studio/` so `tsc` and Vite are available)
- Rust toolchain (`rustc`, `cargo`)
- Python 3.10+ for `whisperx` mode
- **`ffmpeg` / `ffprobe`** : obligatoires pour les jobs réels ; **non** installés par `npm run runtime:setup` (seulement Python + WhisperX). Dans l’app : panneau **Runtime** → **Installer ffmpeg (automatique)** si Homebrew, **winget** ou **Chocolatey** est disponible ; sinon installe à la main (ex. `brew install ffmpeg`).

## Run in Dev

```bash
cd whisperx-studio
npm install
npm run tauri dev
```

If WhisperX runtime is not installed yet : le script crée un venv sous le dossier données de l’app et installe **le fork WhisperX du dépôt** (`pip install -e <racine du repo>`) lorsque `pyproject.toml` et `whisperx/` sont présents au-dessus de `whisperx-studio/`. Sans monorepo complet, il retombe sur `pip install whisperx` (PyPI) — dans ce cas les options d’analyse (`--analysis_*`, etc.) **ne sont pas** dans le CLI amont et les jobs peuvent échouer avec affichage de l’aide argparse (code de sortie 2).

```bash
cd whisperx-studio
npm run runtime:setup
```

(Sur Windows, `npm run runtime:setup:ps1` appelle encore le script PowerShell si tu préfères.)

**Dépannage** : si un job `whisperx` se termine avec « whisperx command failed » et des lignes `usage: __main__.py`, réinstalle depuis la racine du clone :  
`"<venv>/bin/python3" -m pip install --upgrade -e /chemin/vers/LingWhistX`

Variables utiles : `PYTHON_EXE` (défaut `python3` / `python`), `RUNTIME_DIR` (chemin du venv), `WHISPERX_STUDIO_BUNDLE_ID` (défaut `com.hsemil01.whisperx-studio`). Forcer l’installation PyPI : `WHISPERX_STUDIO_PIP_WHISPERX=pypi` (déconseillé pour Studio complet).

In the app:

- `mock` mode writes sample artifacts without running ASR.
- `whisperx` mode runs `python -m whisperx ...` and writes outputs in the selected folder.
- `analyze_only` mode re-reads an existing run JSON and recomputes analysis metrics without rerunning ASR/alignment/diarization.
- Jobs are persisted in a local SQLite DB and reloaded on restart.
- **Job history pagination** : only the **200 most recent** jobs are loaded into memory at startup; use **“Charger les jobs plus anciens”** in the workspace to fetch older rows from SQLite in batches (avoids loading tens of thousands of rows at once).
- **Concurrent jobs** : at most **4** jobs may be `queued` or `running` at the same time; further `create_job` calls fail until one finishes or is cancelled.
- **Custom output folder** : must be an **absolute** path under allowed roots (app data, Documents, Downloads, home, temp, removable volumes on macOS/Linux, or a non-system path on Windows). Leave empty to use the default run folder under app local data.
- Realtime logs are streamed in each job card.
- Running jobs can be cancelled from the UI.
- Runtime status is visible in the "Nouveau Job" panel.

Data-science artifacts are generated by default for WhisperX/analyze-only runs:

- `<basename>.run.json`
- `<basename>.timeline.json`
- `<basename>.words.csv`
- `<basename>.pauses.csv`
- `<basename>.ipu.csv`

In `analyze_only`, outputs are versioned in an `analysis-<timestamp>` subfolder inside the selected output directory.

## Documentation utilisateur & QA

- **Parcours** « ouvrir run → indexer → recalcul léger → export » : [`docs/studio-user-flow.md`](docs/studio-user-flow.md) — aligné sur l’audit [`../audit/ui-ux-harmonization-spec.md`](../audit/ui-ux-harmonization-spec.md) section **F.2**.
- **QA UI** (contraste, focus, zoom, Hi-DPI) : [`docs/qa-ui.md`](docs/qa-ui.md) — checklist **F.1** avec cases à cocher et trace manuelle macOS / Windows.
- **Libellé onglet workspace** : décision produit **WX-637** — [`docs/workspace-tab-label.md`](docs/workspace-tab-label.md) (nom officiel **Studio** pour la vue jobs / Explorer).

## Executable Backlog

Backlog source:

- `backlog/backlog.json`

CLI helpers:

- `scripts/backlog.ps1` (Windows PowerShell)
- `scripts/backlog.mjs` + `scripts/backlog.sh` (macOS/Linux ou tout environnement avec Node)

Commands:

```bash
npm run backlog:list
npm run backlog:ready
npm run backlog:next
npm run backlog:show -- -Id WX-201
npm run backlog:set -- -Id WX-201 -Status in_progress
npm run backlog:set -- -Id WX-201 -Status done
```

Sur macOS/Linux (sans PowerShell), équivalents :

```bash
npm run backlog:list:unix
./scripts/backlog.sh -Action ready
node ./scripts/backlog.mjs -Action set -Id WX-201 -Status done
```

Rules:

- A task is `ready` only if `status=todo` and all `dependsOn` are `done`.
- `backlog:next` returns the highest-priority ready task (`P0` > `P1` > `P2`).
- Each task contains `scope`, `execute`, `definitionOfDone`, and `acceptance`.

## Architecture IPC (Tauri) — WX-620

Principes pour limiter le trafic front ↔ Rust et garder l’Explorer réactif sur de longs runs :

- **Explorer / timeline** : les événements temporels passent par `query_run_events_window` avec plafonds (`limits`, défauts documentés dans `run_events.rs`, ex. 5000 mots). Le `timeline.json` complet **n’est pas** renvoyé au front après import : les données indexées vivent dans `events.sqlite` sur disque.
- **Import** : `import_run_events` lit le `timeline.json` **côté Rust**, remplit SQLite, et ne renvoie que des **compteurs** et chemins (`RunEventsImportResult`).
- **Éditeur de transcription** : `load_transcript_document` / `load_transcript_draft` chargent **volontairement** tout le JSON segmenté lorsque l’utilisateur ouvre un fichier — flux réservé à l’édition, pas au parcours type Explorer.
- **Waveform WXENV** : `read_wxenv_slice` est borné (≤ 65 536 blocs par appel) ; `read_wxenv_meta` reste léger.

| Commande (extraits)         | Rôle                        | Retour côté front                        |
| --------------------------- | --------------------------- | ---------------------------------------- |
| `query_run_events_window`   | Fenêtre `[t0Ms, t1Ms)`      | Sous-ensemble de lignes (plafonné)       |
| `import_run_events`         | Timeline → SQLite           | Métadonnées + comptages                  |
| `read_run_manifest_summary` | Résumé manifest             | Petit objet                              |
| `recalc_pauses_ipu`         | Recalcul pauses / IPU       | Stats + `persisted`                      |
| `load_transcript_document`  | Éditeur                     | Transcript complet (ouverture explicite) |
| `read_wxenv_slice`          | Enveloppe détail / overview | Tranche bornée                           |

**Instrumentation dev** : en `npm run tauri dev`, les appels IPC de l’Explorer passent par `src/dev/ipcPerf.ts` (`ipcInvokeDev`) et journalisent la durée + des comptages (console du navigateur embarqué).

**Checklist manuelle (run long ~2 h, hors CI)** — à remplir lors des revues perf :

| Critère                                   | Cible (guide)                             | Mesure / note |
| ----------------------------------------- | ----------------------------------------- | ------------- |
| Bandeau overview WXENV utilisable         | viser moins de 1 s une fois le cache prêt |               |
| Drag overview → détail                    | viser moins de 100 ms                     |               |
| `query_run_events_window` fenêtre typique | noter le ms (console `[ipc]`)             |               |

## Build Desktop Installer

```bash
cd whisperx-studio
npm install
npm run tauri build
```

Generated installers/bundles are created under:

- `src-tauri/target/release/bundle/`

Main Windows outputs:

- `src-tauri/target/release/bundle/msi/whisperx-studio_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/whisperx-studio_0.1.0_x64-setup.exe`

## Build Portable EXE (Standalone)

Generate a portable executable without MSI/NSIS installer:

```bash
npm run build:portable-exe
```

Output:

- `src-tauri/target/release/portable/whisperx-studio_0.1.0_portable.exe`
- `src-tauri/target/release/portable/whisperx-studio_0.1.0_portable.exe.sha256`

Notes:

- The app now embeds fallbacks for `worker.py` and `setup-local-runtime.ps1` so the portable `.exe` can run without shipping these files alongside it.
- Windows WebView2 runtime is still required on the target machine.

## Smoke E2E + Release Trace

Run the end-to-end smoke flow (`mock job -> transcript edit/save -> export -> installer build -> artifact hashes`):

```bash
npm run smoke:e2e
```

The script generates a report under:

- `runs/smoke/smoke-release-<timestamp>.md`

Release checklist versioned in repo:

- `release-checklist.v1.md`

## Project Layout

- `docs/`: parcours utilisateur Explorer, checklist QA UI, décision libellé onglet Studio (WX-635–WX-637)
- `src/`: React UI (jobs, logs, run details, transcript editor, runtime status, analyze-only)
- `src-tauri/src/lib.rs`: Rust commands (`create_job`, `list_jobs`, `get_job`, runtime checks, waveform peaks, transcript export/edit helpers)
- `python/worker.py`: worker entrypoint used by Rust (`mock` + `whisperx` + `analyze_only`)
- `scripts/setup-local-runtime.ps1`: local runtime bootstrap (venv + whisperx install)
- `scripts/build-portable-exe.ps1`: portable `.exe` builder (no installer)
- `scripts/smoke-e2e.ps1`: smoke orchestration + MSI/EXE verification report
- `src-tauri/tauri.conf.json`: Tauri config + resource bundling
- `src-tauri/capabilities/default.json`: desktop permissions
