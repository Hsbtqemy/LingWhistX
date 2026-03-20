# WhisperX Studio (Tauri)

Desktop local-first wrapper skeleton for WhisperX:

- Tauri + React frontend
- Rust command layer for local job orchestration
- Python side worker for pipeline execution (`mock` or `whisperx` mode)
- Native folder/file picker (Tauri dialog plugin)
- SQLite persistence for local job history
- Realtime logs by stage + job cancellation
- Run Details panel (timeline logs + output preview + open/export actions)
- Transcript editor (segment text edits + save/export SRT/VTT/TXT/JSON)
- Runtime diagnostics panel (Python + WhisperX + ffmpeg readiness)
- Alignment workspace (audio/video player + interactive waveform seek + segment start/end drag handles)
- Advanced aligned export rules (min duration, min gap, overlap correction + export report)

## Prerequisites

- Node.js + npm
- Rust toolchain (`rustc`, `cargo`)
- Python 3.10+ for `whisperx` mode
- `ffmpeg` available in `PATH` for real WhisperX runs

## Run in Dev

```bash
cd whisperx-studio
npm install
npm run tauri dev
```

If WhisperX runtime is not installed yet:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-runtime.ps1
```

Or:

```bash
npm run runtime:setup
```

In the app:

- `mock` mode writes sample artifacts without running ASR.
- `whisperx` mode runs `python -m whisperx ...` and writes outputs in the selected folder.
- Jobs are persisted in a local SQLite DB and reloaded on restart.
- Realtime logs are streamed in each job card.
- Running jobs can be cancelled from the UI.
- Runtime status is visible in the "Nouveau Job" panel.

## Executable Backlog

Backlog source:

- `backlog/backlog.json`

CLI helper:

- `scripts/backlog.ps1`

Commands:

```bash
npm run backlog:list
npm run backlog:ready
npm run backlog:next
npm run backlog:show -- -Id WX-201
npm run backlog:set -- -Id WX-201 -Status in_progress
npm run backlog:set -- -Id WX-201 -Status done
```

Rules:

- A task is `ready` only if `status=todo` and all `dependsOn` are `done`.
- `backlog:next` returns the highest-priority ready task (`P0` > `P1` > `P2`).
- Each task contains `scope`, `execute`, `definitionOfDone`, and `acceptance`.

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

## Project Layout

- `src/`: React UI (jobs, logs, run details, transcript editor, runtime status)
- `src-tauri/src/lib.rs`: Rust commands (`create_job`, `list_jobs`, `get_job`, runtime checks, waveform peaks, transcript export/edit helpers)
- `python/worker.py`: worker entrypoint used by Rust (`mock` + `whisperx`)
- `scripts/setup-local-runtime.ps1`: local runtime bootstrap (venv + whisperx install)
- `src-tauri/tauri.conf.json`: Tauri config + resource bundling
- `src-tauri/capabilities/default.json`: desktop permissions
