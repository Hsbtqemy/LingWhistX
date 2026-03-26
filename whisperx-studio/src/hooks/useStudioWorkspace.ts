import type { RefObject } from "react";
import { useMemo } from "react";
import type { JobsHistoryPanelProps } from "../components/JobsHistoryPanel";
import { buildRunDetailsPanelProps } from "../components/runDetails/buildRunDetailsPanelProps";
import type { RunDetailsPanelProps } from "../components/runDetails/RunDetailsPanel";
import type { RuntimeStatus, SessionRestorePrompt } from "../types";
import { useJobsList } from "./useJobsList";
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
  editorFocusMode: boolean;
  onToggleEditorFocusMode: () => void;
  runtimeStatus: RuntimeStatus | null;
  /** WX-623 — injecte le JSON des plages dans le formulaire « Nouveau job ». */
  injectAudioPipelineSegmentsJson?: (json: string) => void;
};

export type StudioWorkspaceModel = {
  jobsHistory: JobsHistoryPanelProps;
  runDetails: RunDetailsPanelProps;
  runningJobs: number;
  refreshJobs: () => Promise<void>;
  setSelectedJobId: (id: string) => void;
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
  editorFocusMode,
  onToggleEditorFocusMode,
  runtimeStatus,
  injectAudioPipelineSegmentsJson,
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
        editorFocusMode,
        onToggleEditorFocusMode,
        injectAudioPipelineSegmentsJson,
      }),
    [
      selectedJob,
      selectedJobLogs,
      selectedLiveTranscript,
      selectedJobHasJsonOutput,
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
      editorFocusMode,
      onToggleEditorFocusMode,
      injectAudioPipelineSegmentsJson,
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
    explorer,
    sessionRestore: {
      prompt: sessionRestorePrompt,
      onRestore: restoreSession,
      onDismiss: dismissSessionRestore,
    },
  };
}
