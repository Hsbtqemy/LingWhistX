import type { RefObject } from "react";
import { useMemo } from "react";
import type { JobsHistoryPanelProps } from "../components/JobsHistoryPanel";
import { buildRunDetailsPanelProps } from "../components/runDetails/buildRunDetailsPanelProps";
import type { RunDetailsPanelProps } from "../components/runDetails/RunDetailsPanel";
import type { RuntimeStatus, SessionRestorePrompt } from "../types";
import { useJobsList } from "./useJobsList";
import { useNewJobForm, type NewJobFormApi } from "./useNewJobForm";
import { useOpenLocalPath } from "./useOpenLocalPath";
import { usePreviewOutput } from "./usePreviewOutput";
import { useSelectedJobMedia } from "./useSelectedJobMedia";
import { useStudioExplorer } from "./useStudioExplorer";
import { useTranscriptEditor } from "./useTranscriptEditor";
import { useWaveformCanvas } from "./useWaveformCanvas";
import { useWaveformWorkspace } from "./useWaveformWorkspace";

export type UseStudioWorkspaceOptions = {
  runDetailsRef: RefObject<HTMLElement | null>;
  setError: (message: string) => void;
  runtimeReady: boolean;
  runtimeCoreReady: boolean;
  runtimeStatus: RuntimeStatus | null;
  /** Après création d’un job depuis le formulaire Studio. */
  onJobCreated?: () => void;
  /** WX-623 — injecte le JSON des plages dans le formulaire « Nouveau job ». */
  injectAudioPipelineSegmentsJson?: (json: string) => void;
  /** Ouvre le dossier de sortie du job dans l’onglet Player. */
  onOpenPlayerRun?: (outputDir: string, label?: string | null) => void;
  /** Après « Voir détails » depuis l’onglet Historique : afficher le détail dans Studio. */
  onNavigateToWorkspace?: () => void;
};

export type StudioWorkspaceModel = {
  jobsHistory: JobsHistoryPanelProps;
  runDetails: RunDetailsPanelProps;
  runningJobs: number;
  refreshJobs: () => Promise<void>;
  setSelectedJobId: (id: string) => void;
  jobForm: NewJobFormApi;
  explorer: ReturnType<typeof useStudioExplorer>;
  sessionRestore: {
    prompt: SessionRestorePrompt | null;
    onRestore: () => void;
    onDismiss: () => void;
  };
};

export function useStudioWorkspace({
  runDetailsRef,
  setError,
  runtimeReady,
  runtimeCoreReady,
  runtimeStatus,
  onJobCreated,
  injectAudioPipelineSegmentsJson,
  onOpenPlayerRun,
  onNavigateToWorkspace,
}: UseStudioWorkspaceOptions): StudioWorkspaceModel {
  const {
    selectedPreviewPath,
    previewContent,
    previewError,
    isPreviewLoading,
    previewOutput,
    clearPreview,
  } = usePreviewOutput();

  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    refreshJobs,
    loadMoreJobs,
    loadMoreJobsLoading,
    jobsPagination,
    cancelJob,
    focusJobDetails,
    selectedJob,
    selectedJobLogs,
    selectedLiveTranscript,
    selectedJobHasJsonOutput,
    runningJobs,
    sessionRestorePrompt,
    restoreSession,
    dismissSessionRestore,
  } = useJobsList({
    runDetailsRef,
    setError,
    onSelectedJobBecameInvalid: clearPreview,
    onAfterFocusJobDetails: onNavigateToWorkspace,
  });

  const jobForm = useNewJobForm({
    setError,
    setSelectedJobId,
    refreshJobs,
    runtimeReady,
    runtimeCoreReady,
    runtimeStatus,
    onJobCreated,
  });

  const { selectedMediaSrc, selectedIsVideo } = useSelectedJobMedia(selectedJob);

  const wf = useWaveformWorkspace({ selectedJob, selectedJobId, selectedIsVideo });
  const te = useTranscriptEditor({ wf, refreshJobs, previewOutput, selectedJobId });

  useWaveformCanvas(
    wf,
    te.editorSegments,
    te.focusedSegmentIndex,
    te.hoveredSegmentEdge,
    te.dragSegmentState,
  );

  const explorer = useStudioExplorer({
    selectedJob,
    wf,
    setSelectedJobId,
    setError,
    runtimeStatus,
    exportTimingPack: te.exportTimingPack,
    hasTranscriptSource: Boolean(te.editorSourcePath),
  });

  const openLocalPath = useOpenLocalPath(setError);

  const runDetails = useMemo(
    () =>
      buildRunDetailsPanelProps({
        selectedJob,
        selectedJobLogs,
        liveTranscriptSegments: selectedLiveTranscript,
        selectedJobHasJsonOutput,
        onCancelJob: cancelJob,
        openLocalPath,
        selectedMediaSrc,
        selectedIsVideo,
        wf,
        te,
        preview: {
          selectedPreviewPath,
          isPreviewLoading,
          previewError,
          previewContent,
        },
        onPreviewOutput: previewOutput,
        injectAudioPipelineSegmentsJson,
        onOpenPlayerRun,
      }),
    [
      selectedJob,
      selectedJobLogs,
      selectedLiveTranscript,
      selectedJobHasJsonOutput,
      cancelJob,
      openLocalPath,
      selectedMediaSrc,
      selectedIsVideo,
      wf,
      te,
      selectedPreviewPath,
      isPreviewLoading,
      previewError,
      previewContent,
      previewOutput,
      injectAudioPipelineSegmentsJson,
      onOpenPlayerRun,
    ],
  );

  const jobsHistory = useMemo(
    (): JobsHistoryPanelProps => ({
      jobs,
      selectedJobId,
      onFocusJobDetails: focusJobDetails,
      onOpenLocalPath: openLocalPath,
      onCancelJob: cancelJob,
      jobsPagination: jobsPagination
        ? { hasMore: jobsPagination.hasMore, totalInDb: jobsPagination.totalInDb }
        : null,
      onLoadMoreJobs: loadMoreJobs,
      loadMoreJobsLoading,
    }),
    [
      jobs,
      selectedJobId,
      focusJobDetails,
      openLocalPath,
      cancelJob,
      jobsPagination,
      loadMoreJobs,
      loadMoreJobsLoading,
    ],
  );

  return {
    jobsHistory,
    runDetails,
    runningJobs,
    refreshJobs,
    setSelectedJobId,
    jobForm,
    explorer,
    sessionRestore: {
      prompt: sessionRestorePrompt,
      onRestore: restoreSession,
      onDismiss: dismissSessionRestore,
    },
  };
}
