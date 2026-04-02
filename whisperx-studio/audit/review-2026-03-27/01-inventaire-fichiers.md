# Inventaire fichier par fichier

Légende : **OK** / **Att.** attention / **Suiv.** suivi backlog.

## 1. Fichiers priorisés (note détaillée)

| Fichier                                                 | Niveau    | Note                                                              |
| ------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `python/worker.py`                                      | **Att.**  | ~900 lignes ; sous-processus WhisperX.                            |
| `src-tauri/src/audio_preview.rs`                        | **OK**    | ffmpeg + lecture WAV via IPC base64.                              |
| `src-tauri/src/job_commands.rs`                         | **Att.**  | Création jobs + lancement worker.                                 |
| `src-tauri/src/lib.rs`                                  | **OK**    | Table des commandes Tauri.                                        |
| `src-tauri/src/path_guard.rs`                           | **OK**    | Garde-fous chemins IPC — critique sécurité.                       |
| `src-tauri/src/run_events/mod.rs`                       | **Att.**  | Import SQLite + schéma events.                                    |
| `src-tauri/src/waveform.rs`                             | **Att.**  | Tâches async ondeforme + annulation.                              |
| `src/App.tsx`                                           | **Att.**  | Shell vues + erreurs ; point d’entrée des régressions navigation. |
| `src/components/WhisperxOptionsForm.tsx`                | **Att.**  | Options WhisperX + formats sortie.                                |
| `src/components/player/PlayerWaveformPanel.tsx`         | **Suiv.** | Duplication partielle toolbar vs Studio.                          |
| `src/components/player/PlayerWorkspaceSection.tsx`      | **Att.**  | Player + ondeforme + sync temps.                                  |
| `src/components/runDetails/AlignmentWorkspacePanel.tsx` | **Att.**  | UI ondeforme + média très dense.                                  |
| `src/dev/ipcPerf.ts`                                    | **Suiv.** | Outil dev ; ne pas exposer en prod.                               |
| `src/hooks/usePlayerPlayback.ts`                        | **Att.**  | Manifest + convertFileSrc + erreurs chargement média.             |
| `src/hooks/useStudioWorkspace.ts`                       | **Att.**  | Orchestration lourde jobs/run/explorer.                           |
| `src/hooks/useTranscriptEditor.ts`                      | **Att.**  | Fichier volumineux ; agrège transcript + waveform.                |
| `src/hooks/useWaveformWorkspace.ts`                     | **Att.**  | Ondeforme + Web Audio ; partagé Studio/Player.                    |
| `src/types.ts`                                          | **Att.**  | Doit rester aligné avec models.rs / payloads IPC.                 |
| `src/webAudioPlayback.ts`                               | **Att.**  | IPC base64 WAV ; perf si extraits grands.                         |

## 2. Inventaire complet (`src/`, `src-tauri/src/`)

- `src-tauri/src/app_events.rs` — _Rust_ — **OK** — —
- `src-tauri/src/app_setup.rs` — _Rust_ — **OK** — —
- `src-tauri/src/audio_preview.rs` — _Rust_ — **OK** — ffmpeg + lecture WAV via IPC base64.
- `src-tauri/src/db.rs` — _Rust_ — **OK** — —
- `src-tauri/src/embedded_resources.rs` — _Rust_ — **OK** — —
- `src-tauri/src/ffmpeg_install.rs` — _Rust_ — **OK** — —
- `src-tauri/src/ffmpeg_install_commands.rs` — _Rust_ — **OK** — —
- `src-tauri/src/ffmpeg_tools.rs` — _Rust_ — **OK** — —
- `src-tauri/src/hf_token_commands.rs` — _Rust_ — **OK** — —
- `src-tauri/src/job_commands.rs` — _Rust_ — **Att.** — Création jobs + lancement worker.
- `src-tauri/src/jobs.rs` — _Rust_ — **OK** — —
- `src-tauri/src/lib.rs` — _Rust_ — **OK** — Table des commandes Tauri.
- `src-tauri/src/local_fs_commands.rs` — _Rust_ — **OK** — —
- `src-tauri/src/main.rs` — _Rust_ — **OK** — —
- `src-tauri/src/models.rs` — _Rust_ — **OK** — —
- `src-tauri/src/path_guard.rs` — _Rust_ — **OK** — Garde-fous chemins IPC — critique sécurité.
- `src-tauri/src/process_utils.rs` — _Rust_ — **OK** — —
- `src-tauri/src/python_runtime.rs` — _Rust_ — **OK** — —
- `src-tauri/src/run_commands.rs` — _Rust_ — **OK** — —
- `src-tauri/src/run_events/mod.rs` — _Rust_ — **Att.** — Import SQLite + schéma events.
- `src-tauri/src/run_events/run_events_query_window.rs` — _Rust_ — **OK** — —
- `src-tauri/src/run_events_recalc.rs` — _Rust_ — **OK** — —
- `src-tauri/src/runtime_setup_commands.rs` — _Rust_ — **OK** — —
- `src-tauri/src/runtime_status.rs` — _Rust_ — **OK** — —
- `src-tauri/src/smoke_tests.rs` — _Rust_ — **OK** — —
- `src-tauri/src/time_utils.rs` — _Rust_ — **OK** — —
- `src-tauri/src/transcript.rs` — _Rust_ — **OK** — —
- `src-tauri/src/transcript_commands.rs` — _Rust_ — **OK** — —
- `src-tauri/src/waveform.rs` — _Rust_ — **Att.** — Tâches async ondeforme + annulation.
- `src-tauri/src/wxenv.rs` — _Rust_ — **OK** — —
- `src/App.css` — _CSS_ — **OK** — —
- `src/App.tsx` — _TSX_ — **Att.** — Shell vues + erreurs ; point d’entrée des régressions navigation.
- `src/WorkerErrorMessage.tsx` — _TSX_ — **OK** — —
- `src/appUtils.test.ts` — _Test_ — **OK** — —
- `src/appUtils.ts` — _TS_ — **OK** — —
- `src/appVersion.ts` — _TS_ — **OK** — —
- `src/components/AnalysisTimingOptionsForm.tsx` — _TSX_ — **OK** — —
- `src/components/ErrorBanner.tsx` — _TSX_ — **OK** — —
- `src/components/HfScopeBadge.tsx` — _TSX_ — **OK** — —
- `src/components/HfTokenQuickCard.tsx` — _TSX_ — **OK** — —
- `src/components/HomeHub.tsx` — _TSX_ — **OK** — —
- `src/components/JobsHistoryPanel.test.tsx` — _Test_ — **OK** — —
- `src/components/JobsHistoryPanel.tsx` — _TSX_ — **OK** — —
- `src/components/LocalRuntimePanel.tsx` — _TSX_ — **OK** — —
- `src/components/MachineSummaryPanel.tsx` — _TSX_ — **OK** — —
- `src/components/NewJobDropZone.tsx` — _TSX_ — **OK** — —
- `src/components/NewJobMediaPreview.tsx` — _TSX_ — **OK** — —
- `src/components/RunHfRequirementsSummary.tsx` — _TSX_ — **OK** — —
- `src/components/SessionRestoreBanner.tsx` — _TSX_ — **OK** — —
- `src/components/StudioAboutView.tsx` — _TSX_ — **OK** — —
- `src/components/StudioAdvancedJobSection.tsx` — _TSX_ — **OK** — —
- `src/components/StudioExplorerChrome.tsx` — _TSX_ — **OK** — —
- `src/components/StudioHero.tsx` — _TSX_ — **OK** — —
- `src/components/StudioJobsSection.tsx` — _TSX_ — **OK** — —
- `src/components/StudioNav.tsx` — _TSX_ — **OK** — —
- `src/components/StudioNewJobSection.tsx` — _TSX_ — **OK** — —
- `src/components/StudioOpenRunSection.tsx` — _TSX_ — **OK** — —
- `src/components/StudioPreferencesPanel.tsx` — _TSX_ — **OK** — —
- `src/components/StudioWorkspaceSection.tsx` — _TSX_ — **OK** — —
- `src/components/WhisperxOptionsForm.tsx` — _TSX_ — **Att.** — Options WhisperX + formats sortie.
- `src/components/player/PlayerJumpPanel.tsx` — _TSX_ — **OK** — —
- `src/components/player/PlayerMediaTransport.tsx` — _TSX_ — **OK** — —
- `src/components/player/PlayerRunArtifactsStrip.tsx` — _TSX_ — **OK** — —
- `src/components/player/PlayerRunWindowViews.test.tsx` — _Test_ — **OK** — —
- `src/components/player/PlayerRunWindowViews.tsx` — _TSX_ — **OK** — —
- `src/components/player/PlayerTopBar.tsx` — _TSX_ — **OK** — —
- `src/components/player/PlayerWaveformPanel.tsx` — _TSX_ — **Suiv.** — Duplication partielle toolbar vs Studio.
- `src/components/player/PlayerWorkspaceSection.tsx` — _TSX_ — **Att.** — Player + ondeforme + sync temps.
- `src/components/runDetails/AlignmentWorkspacePanel.tsx` — _TSX_ — **Att.** — UI ondeforme + média très dense.
- `src/components/runDetails/JobRunPipelineStrip.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/LiveTranscriptFeed.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/RunDetailsMetaSection.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/RunDetailsOutputFiles.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/RunDetailsPanel.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/RunDetailsPreview.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/RunExpectedExportsStrip.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/RunSourceMediaHero.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/TranscriptEditorPanel.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/WaveformOverviewStrip.tsx` — _TSX_ — **OK** — —
- `src/components/runDetails/buildRunDetailsPanelProps.ts` — _TS_ — **OK** — —
- `src/components/ui/Badge.tsx` — _TSX_ — **OK** — —
- `src/components/ui/Button.tsx` — _TSX_ — **OK** — —
- `src/components/ui/LayerList.tsx` — _TSX_ — **OK** — —
- `src/components/ui/StatsCard.tsx` — _TSX_ — **OK** — —
- `src/components/ui/Tabs.tsx` — _TSX_ — **OK** — —
- `src/components/ui/index.ts` — _TS_ — **OK** — —
- `src/config/studioHubSections.ts` — _TS_ — **OK** — —
- `src/constants.ts` — _TS_ — **OK** — —
- `src/dev/ipcPerf.ts` — _TS_ — **Suiv.** — Outil dev ; ne pas exposer en prod.
- `src/docUrls.ts` — _TS_ — **OK** — —
- `src/hfTokenStorage.ts` — _TS_ — **OK** — —
- `src/hooks/explorer/studioExplorerLayers.ts` — _TS_ — **OK** — —
- `src/hooks/explorer/studioExplorerRecalcConfig.test.ts` — _Test_ — **OK** — —
- `src/hooks/explorer/studioExplorerRecalcConfig.ts` — _TS_ — **OK** — —
- `src/hooks/explorer/studioExplorerUi.test.ts` — _Test_ — **OK** — —
- `src/hooks/explorer/studioExplorerUi.ts` — _TS_ — **OK** — —
- `src/hooks/explorer/useExplorerRecalc.ts` — _TS_ — **OK** — —
- `src/hooks/explorer/useExplorerRunContext.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/qaAutoFix.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptEditorExportSequences.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/transcriptEditorExportSequences.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptEditorIoHelpers.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/transcriptEditorIoHelpers.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptEditorKeyboard.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptEditorLoad.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/transcriptEditorLoad.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptEditorNavigation.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/transcriptEditorNavigation.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptEditorSplitMerge.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/transcriptEditorSplitMerge.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptEditorTauri.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/transcriptEditorTauri.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/transcriptSegmentMutations.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/transcriptSegmentMutations.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/useEditorDraftPersistence.test.tsx` — _Test_ — **OK** — —
- `src/hooks/transcript/useEditorDraftPersistence.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/useEditorHistory.test.tsx` — _Test_ — **OK** — —
- `src/hooks/transcript/useEditorHistory.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/useEditorQa.test.tsx` — _Test_ — **OK** — —
- `src/hooks/transcript/useEditorQa.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/useTranscriptWaveformInteraction.ts` — _TS_ — **OK** — —
- `src/hooks/transcript/waveformPointer.test.ts` — _Test_ — **OK** — —
- `src/hooks/transcript/waveformPointer.ts` — _TS_ — **OK** — —
- `src/hooks/useAppErrorStack.test.tsx` — _Test_ — **OK** — —
- `src/hooks/useAppErrorStack.ts` — _TS_ — **OK** — —
- `src/hooks/useJobsList.test.tsx` — _Test_ — **OK** — —
- `src/hooks/useJobsList.ts` — _TS_ — **OK** — —
- `src/hooks/useNewJobForm.ts` — _TS_ — **OK** — —
- `src/hooks/useOpenLocalPath.ts` — _TS_ — **OK** — —
- `src/hooks/usePlayerKeyboard.ts` — _TS_ — **OK** — —
- `src/hooks/usePlayerPlayback.ts` — _TS_ — **Att.** — Manifest + convertFileSrc + erreurs chargement média.
- `src/hooks/usePlayerRunWindow.ts` — _TS_ — **OK** — —
- `src/hooks/usePreviewOutput.ts` — _TS_ — **OK** — —
- `src/hooks/useRuntimeDiagnostics.ts` — _TS_ — **OK** — —
- `src/hooks/useSelectedJobMedia.ts` — _TS_ — **OK** — —
- `src/hooks/useStudioExplorer.ts` — _TS_ — **OK** — —
- `src/hooks/useStudioWorkspace.ts` — _TS_ — **Att.** — Orchestration lourde jobs/run/explorer.
- `src/hooks/useTranscriptEditor.ts` — _TS_ — **Att.** — Fichier volumineux ; agrège transcript + waveform.
- `src/hooks/useWaveformCanvas.ts` — _TS_ — **OK** — —
- `src/hooks/useWaveformWorkspace.ts` — _TS_ — **Att.** — Ondeforme + Web Audio ; partagé Studio/Player.
- `src/main.tsx` — _TSX_ — **OK** — —
- `src/model/localRuntimePanel.ts` — _TS_ — **OK** — —
- `src/player/derivePlayerAlerts.test.ts` — _Test_ — **OK** — —
- `src/player/derivePlayerAlerts.ts` — _TS_ — **OK** — —
- `src/runtimeAdaptivePresets.test.ts` — _Test_ — **OK** — —
- `src/runtimeAdaptivePresets.ts` — _TS_ — **OK** — —
- `src/studioPreferences.test.ts` — _Test_ — **OK** — —
- `src/studioPreferences.ts` — _TS_ — **OK** — —
- `src/styles/main.css` — _CSS_ — **OK** — —
- `src/styles/responsive.css` — _CSS_ — **OK** — —
- `src/styles/tokens.css` — _CSS_ — **OK** — —
- `src/test/vitest-setup.ts` — _TS_ — **OK** — —
- `src/theme/applyStoredTheme.test.ts` — _Test_ — **OK** — —
- `src/theme/applyStoredTheme.ts` — _TS_ — **OK** — —
- `src/types.ts` — _TS_ — **Att.** — Doit rester aligné avec models.rs / payloads IPC.
- `src/utils/droppedFilePath.test.ts` — _Test_ — **OK** — —
- `src/utils/droppedFilePath.ts` — _TS_ — **OK** — —
- `src/utils/expectedOutputFormats.test.ts` — _Test_ — **OK** — —
- `src/utils/expectedOutputFormats.ts` — _TS_ — **OK** — —
- `src/utils/jobLogSections.test.ts` — _Test_ — **OK** — —
- `src/utils/jobLogSections.ts` — _TS_ — **OK** — —
- `src/utils/jobPipelineStages.test.ts` — _Test_ — **OK** — —
- `src/utils/jobPipelineStages.ts` — _TS_ — **OK** — —
- `src/utils/liveTranscript.test.ts` — _Test_ — **OK** — —
- `src/utils/liveTranscript.ts` — _TS_ — **OK** — —
- `src/utils/pausesCsv.test.ts` — _Test_ — **OK** — —
- `src/utils/pausesCsv.ts` — _TS_ — **OK** — —
- `src/vite-env.d.ts` — _TS_ — **OK** — —
- `src/waveformWxenv.ts` — _TS_ — **OK** — —
- `src/webAudioPlayback.ts` — _TS_ — **Att.** — IPC base64 WAV ; perf si extraits grands.
- `src/whisperxOptionsTransitions.ts` — _TS_ — **OK** — —

## 3. Hors arborescence ci-dessus

- `python/worker.py` — _Python_ — **Att.** — orchestration sous-processus WhisperX ; logs/stderr consommés par l’UI.
- `tauri.conf.json` — _config_ — **Att.** — `security.assetProtocol` (périmètre médias).
- `backlog/backlog.json` — _backlog_ — **OK** — tickets exécutables WX-\*.
