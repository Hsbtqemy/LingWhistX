# Inventaire fichier par fichier

Légende : **OK** / **Att.** attention / **Suiv.** suivi backlog.

## 1. Fichiers priorisés (note détaillée)

| Fichier | Niveau | Note |
|---------|--------|------|
| `python/worker.py` | **Att.** | ~900 lignes ; sous-processus WhisperX. |
| `src-tauri/src/audio_preview.rs` | **OK** | ffmpeg + lecture WAV via IPC base64. |
| `src-tauri/src/job_commands.rs` | **Att.** | Création jobs + lancement worker. |
| `src-tauri/src/lib.rs` | **OK** | Table des commandes Tauri. |
| `src-tauri/src/path_guard.rs` | **OK** | Garde-fous chemins IPC — critique sécurité. |
| `src-tauri/src/run_events/mod.rs` | **Att.** | Import SQLite + schéma events. |
| `src-tauri/src/waveform.rs` | **Att.** | Tâches async ondeforme + annulation. |
| `src/App.tsx` | **Att.** | Shell vues + erreurs ; point d’entrée des régressions navigation. |
| `src/components/WhisperxOptionsForm.tsx` | **Att.** | Options WhisperX + formats sortie. |
| `src/components/player/PlayerWaveformPanel.tsx` | **Suiv.** | Duplication partielle toolbar vs Studio. |
| `src/components/player/PlayerWorkspaceSection.tsx` | **Att.** | Player + ondeforme + sync temps. |
| `src/components/runDetails/AlignmentWorkspacePanel.tsx` | **Att.** | UI ondeforme + média très dense. |
| `src/dev/ipcPerf.ts` | **Suiv.** | Outil dev ; ne pas exposer en prod. |
| `src/hooks/usePlayerPlayback.ts` | **Att.** | Manifest + convertFileSrc + erreurs chargement média. |
| `src/hooks/useStudioWorkspace.ts` | **Att.** | Orchestration lourde jobs/run/explorer. |
| `src/hooks/useTranscriptEditor.ts` | **Att.** | Fichier volumineux ; agrège transcript + waveform. |
| `src/hooks/useWaveformWorkspace.ts` | **Att.** | Ondeforme + Web Audio ; partagé Studio/Player. |
| `src/types.ts` | **Att.** | Doit rester aligné avec models.rs / payloads IPC. |
| `src/webAudioPlayback.ts` | **Att.** | IPC base64 WAV ; perf si extraits grands. |

## 2. Inventaire complet (`src/`, `src-tauri/src/`)

- `src-tauri/src/app_events.rs` — *Rust* — **OK** — —
- `src-tauri/src/app_setup.rs` — *Rust* — **OK** — —
- `src-tauri/src/audio_preview.rs` — *Rust* — **OK** — ffmpeg + lecture WAV via IPC base64.
- `src-tauri/src/db.rs` — *Rust* — **OK** — —
- `src-tauri/src/embedded_resources.rs` — *Rust* — **OK** — —
- `src-tauri/src/ffmpeg_install.rs` — *Rust* — **OK** — —
- `src-tauri/src/ffmpeg_install_commands.rs` — *Rust* — **OK** — —
- `src-tauri/src/ffmpeg_tools.rs` — *Rust* — **OK** — —
- `src-tauri/src/hf_token_commands.rs` — *Rust* — **OK** — —
- `src-tauri/src/job_commands.rs` — *Rust* — **Att.** — Création jobs + lancement worker.
- `src-tauri/src/jobs.rs` — *Rust* — **OK** — —
- `src-tauri/src/lib.rs` — *Rust* — **OK** — Table des commandes Tauri.
- `src-tauri/src/local_fs_commands.rs` — *Rust* — **OK** — —
- `src-tauri/src/main.rs` — *Rust* — **OK** — —
- `src-tauri/src/models.rs` — *Rust* — **OK** — —
- `src-tauri/src/path_guard.rs` — *Rust* — **OK** — Garde-fous chemins IPC — critique sécurité.
- `src-tauri/src/process_utils.rs` — *Rust* — **OK** — —
- `src-tauri/src/python_runtime.rs` — *Rust* — **OK** — —
- `src-tauri/src/run_commands.rs` — *Rust* — **OK** — —
- `src-tauri/src/run_events/mod.rs` — *Rust* — **Att.** — Import SQLite + schéma events.
- `src-tauri/src/run_events/run_events_query_window.rs` — *Rust* — **OK** — —
- `src-tauri/src/run_events_recalc.rs` — *Rust* — **OK** — —
- `src-tauri/src/runtime_setup_commands.rs` — *Rust* — **OK** — —
- `src-tauri/src/runtime_status.rs` — *Rust* — **OK** — —
- `src-tauri/src/smoke_tests.rs` — *Rust* — **OK** — —
- `src-tauri/src/time_utils.rs` — *Rust* — **OK** — —
- `src-tauri/src/transcript.rs` — *Rust* — **OK** — —
- `src-tauri/src/transcript_commands.rs` — *Rust* — **OK** — —
- `src-tauri/src/waveform.rs` — *Rust* — **Att.** — Tâches async ondeforme + annulation.
- `src-tauri/src/wxenv.rs` — *Rust* — **OK** — —
- `src/App.css` — *CSS* — **OK** — —
- `src/App.tsx` — *TSX* — **Att.** — Shell vues + erreurs ; point d’entrée des régressions navigation.
- `src/WorkerErrorMessage.tsx` — *TSX* — **OK** — —
- `src/appUtils.test.ts` — *Test* — **OK** — —
- `src/appUtils.ts` — *TS* — **OK** — —
- `src/appVersion.ts` — *TS* — **OK** — —
- `src/components/AnalysisTimingOptionsForm.tsx` — *TSX* — **OK** — —
- `src/components/ErrorBanner.tsx` — *TSX* — **OK** — —
- `src/components/HfScopeBadge.tsx` — *TSX* — **OK** — —
- `src/components/HfTokenQuickCard.tsx` — *TSX* — **OK** — —
- `src/components/HomeHub.tsx` — *TSX* — **OK** — —
- `src/components/JobsHistoryPanel.test.tsx` — *Test* — **OK** — —
- `src/components/JobsHistoryPanel.tsx` — *TSX* — **OK** — —
- `src/components/LocalRuntimePanel.tsx` — *TSX* — **OK** — —
- `src/components/MachineSummaryPanel.tsx` — *TSX* — **OK** — —
- `src/components/NewJobDropZone.tsx` — *TSX* — **OK** — —
- `src/components/NewJobMediaPreview.tsx` — *TSX* — **OK** — —
- `src/components/RunHfRequirementsSummary.tsx` — *TSX* — **OK** — —
- `src/components/SessionRestoreBanner.tsx` — *TSX* — **OK** — —
- `src/components/StudioAboutView.tsx` — *TSX* — **OK** — —
- `src/components/StudioAdvancedJobSection.tsx` — *TSX* — **OK** — —
- `src/components/StudioExplorerChrome.tsx` — *TSX* — **OK** — —
- `src/components/StudioHero.tsx` — *TSX* — **OK** — —
- `src/components/StudioJobsSection.tsx` — *TSX* — **OK** — —
- `src/components/StudioNav.tsx` — *TSX* — **OK** — —
- `src/components/StudioNewJobSection.tsx` — *TSX* — **OK** — —
- `src/components/StudioOpenRunSection.tsx` — *TSX* — **OK** — —
- `src/components/StudioPreferencesPanel.tsx` — *TSX* — **OK** — —
- `src/components/StudioWorkspaceSection.tsx` — *TSX* — **OK** — —
- `src/components/WhisperxOptionsForm.tsx` — *TSX* — **Att.** — Options WhisperX + formats sortie.
- `src/components/player/PlayerJumpPanel.tsx` — *TSX* — **OK** — —
- `src/components/player/PlayerMediaTransport.tsx` — *TSX* — **OK** — —
- `src/components/player/PlayerRunArtifactsStrip.tsx` — *TSX* — **OK** — —
- `src/components/player/PlayerRunWindowViews.test.tsx` — *Test* — **OK** — —
- `src/components/player/PlayerRunWindowViews.tsx` — *TSX* — **OK** — —
- `src/components/player/PlayerTopBar.tsx` — *TSX* — **OK** — —
- `src/components/player/PlayerWaveformPanel.tsx` — *TSX* — **Suiv.** — Duplication partielle toolbar vs Studio.
- `src/components/player/PlayerWorkspaceSection.tsx` — *TSX* — **Att.** — Player + ondeforme + sync temps.
- `src/components/runDetails/AlignmentWorkspacePanel.tsx` — *TSX* — **Att.** — UI ondeforme + média très dense.
- `src/components/runDetails/JobRunPipelineStrip.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/LiveTranscriptFeed.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/RunDetailsMetaSection.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/RunDetailsOutputFiles.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/RunDetailsPanel.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/RunDetailsPreview.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/RunExpectedExportsStrip.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/RunSourceMediaHero.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/TranscriptEditorPanel.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/WaveformOverviewStrip.tsx` — *TSX* — **OK** — —
- `src/components/runDetails/buildRunDetailsPanelProps.ts` — *TS* — **OK** — —
- `src/components/ui/Badge.tsx` — *TSX* — **OK** — —
- `src/components/ui/Button.tsx` — *TSX* — **OK** — —
- `src/components/ui/LayerList.tsx` — *TSX* — **OK** — —
- `src/components/ui/StatsCard.tsx` — *TSX* — **OK** — —
- `src/components/ui/Tabs.tsx` — *TSX* — **OK** — —
- `src/components/ui/index.ts` — *TS* — **OK** — —
- `src/config/studioHubSections.ts` — *TS* — **OK** — —
- `src/constants.ts` — *TS* — **OK** — —
- `src/dev/ipcPerf.ts` — *TS* — **Suiv.** — Outil dev ; ne pas exposer en prod.
- `src/docUrls.ts` — *TS* — **OK** — —
- `src/hfTokenStorage.ts` — *TS* — **OK** — —
- `src/hooks/explorer/studioExplorerLayers.ts` — *TS* — **OK** — —
- `src/hooks/explorer/studioExplorerRecalcConfig.test.ts` — *Test* — **OK** — —
- `src/hooks/explorer/studioExplorerRecalcConfig.ts` — *TS* — **OK** — —
- `src/hooks/explorer/studioExplorerUi.test.ts` — *Test* — **OK** — —
- `src/hooks/explorer/studioExplorerUi.ts` — *TS* — **OK** — —
- `src/hooks/explorer/useExplorerRecalc.ts` — *TS* — **OK** — —
- `src/hooks/explorer/useExplorerRunContext.ts` — *TS* — **OK** — —
- `src/hooks/transcript/qaAutoFix.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptEditorExportSequences.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/transcriptEditorExportSequences.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptEditorIoHelpers.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/transcriptEditorIoHelpers.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptEditorKeyboard.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptEditorLoad.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/transcriptEditorLoad.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptEditorNavigation.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/transcriptEditorNavigation.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptEditorSplitMerge.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/transcriptEditorSplitMerge.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptEditorTauri.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/transcriptEditorTauri.ts` — *TS* — **OK** — —
- `src/hooks/transcript/transcriptSegmentMutations.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/transcriptSegmentMutations.ts` — *TS* — **OK** — —
- `src/hooks/transcript/useEditorDraftPersistence.test.tsx` — *Test* — **OK** — —
- `src/hooks/transcript/useEditorDraftPersistence.ts` — *TS* — **OK** — —
- `src/hooks/transcript/useEditorHistory.test.tsx` — *Test* — **OK** — —
- `src/hooks/transcript/useEditorHistory.ts` — *TS* — **OK** — —
- `src/hooks/transcript/useEditorQa.test.tsx` — *Test* — **OK** — —
- `src/hooks/transcript/useEditorQa.ts` — *TS* — **OK** — —
- `src/hooks/transcript/useTranscriptWaveformInteraction.ts` — *TS* — **OK** — —
- `src/hooks/transcript/waveformPointer.test.ts` — *Test* — **OK** — —
- `src/hooks/transcript/waveformPointer.ts` — *TS* — **OK** — —
- `src/hooks/useAppErrorStack.test.tsx` — *Test* — **OK** — —
- `src/hooks/useAppErrorStack.ts` — *TS* — **OK** — —
- `src/hooks/useJobsList.test.tsx` — *Test* — **OK** — —
- `src/hooks/useJobsList.ts` — *TS* — **OK** — —
- `src/hooks/useNewJobForm.ts` — *TS* — **OK** — —
- `src/hooks/useOpenLocalPath.ts` — *TS* — **OK** — —
- `src/hooks/usePlayerKeyboard.ts` — *TS* — **OK** — —
- `src/hooks/usePlayerPlayback.ts` — *TS* — **Att.** — Manifest + convertFileSrc + erreurs chargement média.
- `src/hooks/usePlayerRunWindow.ts` — *TS* — **OK** — —
- `src/hooks/usePreviewOutput.ts` — *TS* — **OK** — —
- `src/hooks/useRuntimeDiagnostics.ts` — *TS* — **OK** — —
- `src/hooks/useSelectedJobMedia.ts` — *TS* — **OK** — —
- `src/hooks/useStudioExplorer.ts` — *TS* — **OK** — —
- `src/hooks/useStudioWorkspace.ts` — *TS* — **Att.** — Orchestration lourde jobs/run/explorer.
- `src/hooks/useTranscriptEditor.ts` — *TS* — **Att.** — Fichier volumineux ; agrège transcript + waveform.
- `src/hooks/useWaveformCanvas.ts` — *TS* — **OK** — —
- `src/hooks/useWaveformWorkspace.ts` — *TS* — **Att.** — Ondeforme + Web Audio ; partagé Studio/Player.
- `src/main.tsx` — *TSX* — **OK** — —
- `src/model/localRuntimePanel.ts` — *TS* — **OK** — —
- `src/player/derivePlayerAlerts.test.ts` — *Test* — **OK** — —
- `src/player/derivePlayerAlerts.ts` — *TS* — **OK** — —
- `src/runtimeAdaptivePresets.test.ts` — *Test* — **OK** — —
- `src/runtimeAdaptivePresets.ts` — *TS* — **OK** — —
- `src/studioPreferences.test.ts` — *Test* — **OK** — —
- `src/studioPreferences.ts` — *TS* — **OK** — —
- `src/styles/main.css` — *CSS* — **OK** — —
- `src/styles/responsive.css` — *CSS* — **OK** — —
- `src/styles/tokens.css` — *CSS* — **OK** — —
- `src/test/vitest-setup.ts` — *TS* — **OK** — —
- `src/theme/applyStoredTheme.test.ts` — *Test* — **OK** — —
- `src/theme/applyStoredTheme.ts` — *TS* — **OK** — —
- `src/types.ts` — *TS* — **Att.** — Doit rester aligné avec models.rs / payloads IPC.
- `src/utils/droppedFilePath.test.ts` — *Test* — **OK** — —
- `src/utils/droppedFilePath.ts` — *TS* — **OK** — —
- `src/utils/expectedOutputFormats.test.ts` — *Test* — **OK** — —
- `src/utils/expectedOutputFormats.ts` — *TS* — **OK** — —
- `src/utils/jobLogSections.test.ts` — *Test* — **OK** — —
- `src/utils/jobLogSections.ts` — *TS* — **OK** — —
- `src/utils/jobPipelineStages.test.ts` — *Test* — **OK** — —
- `src/utils/jobPipelineStages.ts` — *TS* — **OK** — —
- `src/utils/liveTranscript.test.ts` — *Test* — **OK** — —
- `src/utils/liveTranscript.ts` — *TS* — **OK** — —
- `src/utils/pausesCsv.test.ts` — *Test* — **OK** — —
- `src/utils/pausesCsv.ts` — *TS* — **OK** — —
- `src/vite-env.d.ts` — *TS* — **OK** — —
- `src/waveformWxenv.ts` — *TS* — **OK** — —
- `src/webAudioPlayback.ts` — *TS* — **Att.** — IPC base64 WAV ; perf si extraits grands.
- `src/whisperxOptionsTransitions.ts` — *TS* — **OK** — —

## 3. Hors arborescence ci-dessus

- `python/worker.py` — *Python* — **Att.** — orchestration sous-processus WhisperX ; logs/stderr consommés par l’UI.
- `tauri.conf.json` — *config* — **Att.** — `security.assetProtocol` (périmètre médias).
- `backlog/backlog.json` — *backlog* — **OK** — tickets exécutables WX-*.
