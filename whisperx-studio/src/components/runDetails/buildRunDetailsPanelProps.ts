import type { AnnotationSegment, Job, JobLogEvent, LiveTranscriptSegment } from "../../types";
import type { AlignmentWorkspacePanelProps } from "./AlignmentWorkspacePanel";
import type { RunDetailsPanelProps } from "./RunDetailsPanel";
import type { TranscriptEditorPanelProps } from "./TranscriptEditorPanel";
import type { WaveformWorkspace } from "../../hooks/useWaveformWorkspace";

type TranscriptEditorApi = ReturnType<
  typeof import("../../hooks/useTranscriptEditor").useTranscriptEditor
>;

export function buildAlignmentWorkspaceProps(
  selectedJob: Job,
  selectedMediaSrc: string,
  selectedIsVideo: boolean,
  wf: WaveformWorkspace,
  te: TranscriptEditorApi,
  injectAudioPipelineSegmentsJson?: (json: string) => void,
): AlignmentWorkspacePanelProps {
  return {
    selectedJob,
    selectedIsVideo,
    selectedMediaSrc,
    audioRef: wf.audioRef,
    videoRef: wf.videoRef,
    waveformCanvasRef: wf.waveformCanvasRef,
    waveformBinsPerSecond: wf.waveformBinsPerSecond,
    setWaveformBinsPerSecond: wf.setWaveformBinsPerSecond,
    loadWaveformForSelectedJob: wf.loadWaveformForSelectedJob,
    isWaveformLoading: wf.isWaveformLoading,
    requestCancelWaveformGeneration: wf.requestCancelWaveformGeneration,
    waveformTaskId: wf.waveformTaskId,
    zoomWaveform: wf.zoomWaveform,
    resetWaveformZoom: wf.resetWaveformZoom,
    waveform: wf.waveform,
    waveformZoom: wf.waveformZoom,
    waveformCursorSec: wf.waveformCursorSec,
    mediaCurrentSec: wf.mediaCurrentSec,
    setMediaCurrentSec: wf.setMediaCurrentSec,
    waveformViewStartSec: wf.waveformViewStartSec,
    waveformViewEndSec: wf.waveformViewEndSec,
    waveformMaxViewStartSec: wf.waveformMaxViewStartSec,
    setWaveformZoomAround: wf.setWaveformZoomAround,
    setWaveformViewStart: wf.setWaveformViewStart,
    snapEnabled: wf.snapEnabled,
    setSnapEnabled: wf.setSnapEnabled,
    snapStepMs: wf.snapStepMs,
    setSnapStepMs: wf.setSnapStepMs,
    waveformProgress: wf.waveformProgress,
    waveformProgressMessage: wf.waveformProgressMessage,
    waveformError: wf.waveformError,
    waveformCursorStyle: te.waveformCursorStyle,
    onWaveformMouseDown: te.onWaveformMouseDown,
    onWaveformMouseMove: te.onWaveformMouseMove,
    onWaveformMouseUp: te.onWaveformMouseUp,
    onWaveformMouseLeave: te.onWaveformMouseLeave,
    onWaveformWheel: wf.onWaveformWheel,
    focusedSegment: te.focusedSegment,
    activeSegmentIndex: te.activeSegmentIndex,
    setActiveSegmentIndex: te.setActiveSegmentIndex,
    splitActiveSegmentAtCursor: te.splitActiveSegmentAtCursor,
    canSplitActiveSegment: te.canSplitActiveSegment,
    mergeActiveSegment: te.mergeActiveSegment,
    canMergePrev: te.canMergePrev,
    canMergeNext: te.canMergeNext,
    seekMedia: wf.seekMedia,
    buildWaveformPyramid: wf.buildWaveformPyramid,
    isPyramidBuilding: wf.isPyramidBuilding,
    pyramidError: wf.pyramidError,
    overviewEnvelope: wf.overviewEnvelope,
    isOverviewLoading: wf.isOverviewLoading,
    visibleDurationSec: wf.waveformVisibleDurationSec,
    webAudioMode: wf.webAudioMode,
    setWebAudioMode: wf.setWebAudioMode,
    webAudioError: wf.webAudioError,
    toggleMediaPlayback: wf.toggleMediaPlayback,
    injectAudioPipelineSegmentsJson,
    previewRangeSec: wf.previewRangeSec,
    setPreviewRangeSec: wf.setPreviewRangeSec,
    rangeSelectionMode: wf.rangeSelectionMode,
    setRangeSelectionMode: wf.setRangeSelectionMode,
    setPreviewRangeFromVisibleWindow: wf.setPreviewRangeFromVisibleWindow,
    clearPreviewRange: wf.clearPreviewRange,
    previewWaveGainDb: wf.previewWaveGainDb,
    setPreviewWaveGainDb: wf.setPreviewWaveGainDb,
    previewWaveEqLowDb: wf.previewWaveEqLowDb,
    setPreviewWaveEqLowDb: wf.setPreviewWaveEqLowDb,
    previewWaveBalance: wf.previewWaveBalance,
    setPreviewWaveBalance: wf.setPreviewWaveBalance,
    previewWaveBypassEffects: wf.previewWaveBypassEffects,
    setPreviewWaveBypassEffects: wf.setPreviewWaveBypassEffects,
    resetPreviewWaveEffects: wf.resetPreviewWaveEffects,
    pauseOverlayVisible: wf.pauseOverlayVisible,
    setPauseOverlayVisible: wf.setPauseOverlayVisible,
    pauseOverlaySourcePath: wf.pauseOverlaySourcePath,
    pauseOverlayLoadError: wf.pauseOverlayLoadError,
    loadPauseOverlayFromCsvPath: wf.loadPauseOverlayFromCsvPath,
    clearPauseOverlay: wf.clearPauseOverlay,
  };
}

export function buildTranscriptEditorPanelProps(
  te: TranscriptEditorApi,
  openLocalPath: TranscriptEditorPanelProps["openLocalPath"],
  previewOutput: TranscriptEditorPanelProps["previewOutput"],
): TranscriptEditorPanelProps {
  return {
    editorSourcePath: te.editorSourcePath,
    editorLanguage: te.editorLanguage,
    updateEditorLanguage: te.updateEditorLanguage,
    isEditorSaving: te.isEditorSaving,
    isEditorLoading: te.isEditorLoading,
    canUndoEditor: te.canUndoEditor,
    canRedoEditor: te.canRedoEditor,
    undoEditorChange: te.undoEditorChange,
    redoEditorChange: te.redoEditorChange,
    editorHistoryLimitInput: te.editorHistoryLimitInput,
    setEditorHistoryLimitInput: te.setEditorHistoryLimitInput,
    editorHistoryLimit: te.editorHistoryLimit,
    draftAutosaveSecInput: te.draftAutosaveSecInput,
    setDraftAutosaveSecInput: te.setDraftAutosaveSecInput,
    draftAutosaveSec: te.draftAutosaveSec,
    purgeTranscriptDraft: te.purgeTranscriptDraft,
    saveEditedJson: te.saveEditedJson,
    exportEditedTranscript: te.exportEditedTranscript,
    exportRules: te.exportRules,
    setExportRules: te.setExportRules,
    lastExportReport: te.lastExportReport,
    qaGapThresholdSecInput: te.qaGapThresholdSecInput,
    setQaGapThresholdSecInput: te.setQaGapThresholdSecInput,
    qaGapThresholdSec: te.qaGapThresholdSec,
    qaMinWpsInput: te.qaMinWpsInput,
    setQaMinWpsInput: te.setQaMinWpsInput,
    qaMinWps: te.qaMinWps,
    qaMaxWpsInput: te.qaMaxWpsInput,
    setQaMaxWpsInput: te.setQaMaxWpsInput,
    qaMaxWps: te.qaMaxWps,
    runTranscriptQaScan: te.runTranscriptQaScan,
    qaScannedAtMs: te.qaScannedAtMs,
    qaIssues: te.qaIssues,
    qaStatus: te.qaStatus,
    jumpToQaIssue: te.jumpToQaIssue,
    autoFixQaIssue: te.autoFixQaIssue,
    editorSegments: te.editorSegments,
    displayedEditorSegments: te.displayedEditorSegments,
    editorDirty: te.editorDirty,
    editorUndoStack: te.editorUndoStack,
    editorRedoStack: te.editorRedoStack,
    activeSegmentIndex: te.activeSegmentIndex,
    setActiveSegmentIndex: te.setActiveSegmentIndex,
    updateEditorSegmentBoundary: te.updateEditorSegmentBoundary,
    updateEditorSegmentText: te.updateEditorSegmentText,
    focusSegment: te.focusSegment,
    hasMoreEditorSegments: te.hasMoreEditorSegments,
    setEditorVisibleCount: te.setEditorVisibleCount,
    isAutosavingDraft: te.isAutosavingDraft,
    editorDraftUpdatedAtMs: te.editorDraftUpdatedAtMs,
    editorDraftPath: te.editorDraftPath,
    editorAutosaveMessage: te.editorAutosaveMessage,
    editorAutosaveError: te.editorAutosaveError,
    editorStatus: te.editorStatus,
    editorError: te.editorError,
    editorLastOutputPath: te.editorLastOutputPath,
    openLocalPath,
    previewOutput,
  };
}

export type BuildRunDetailsPanelPropsInput = {
  selectedJob: Job | null;
  selectedJobLogs: JobLogEvent[];
  liveTranscriptSegments: LiveTranscriptSegment[];
  selectedJobHasJsonOutput: boolean;
  onCancelJob: RunDetailsPanelProps["onCancelJob"];
  openLocalPath: RunDetailsPanelProps["openLocalPath"];
  selectedMediaSrc: string;
  selectedIsVideo: boolean;
  wf: WaveformWorkspace;
  te: TranscriptEditorApi;
  preview: RunDetailsPanelProps["preview"];
  onPreviewOutput: RunDetailsPanelProps["onPreviewOutput"];
  injectAudioPipelineSegmentsJson?: (json: string) => void;
  onOpenPlayerRun?: RunDetailsPanelProps["onOpenPlayerRun"];
  onLoadAnnotationTier?: (tierId: string, segments: AnnotationSegment[]) => void;
};

export function buildRunDetailsPanelProps(
  input: BuildRunDetailsPanelPropsInput,
): RunDetailsPanelProps {
  const {
    selectedJob,
    selectedJobLogs,
    liveTranscriptSegments,
    selectedJobHasJsonOutput,
    onCancelJob,
    openLocalPath,
    selectedMediaSrc,
    selectedIsVideo,
    wf,
    te,
    preview,
    onPreviewOutput,
    injectAudioPipelineSegmentsJson,
    onOpenPlayerRun,
  } = input;

  return {
    selectedJob,
    selectedJobLogs,
    liveTranscriptSegments,
    selectedJobHasJsonOutput,
    onCancelJob,
    openLocalPath,
    alignment: selectedJob
      ? buildAlignmentWorkspaceProps(
          selectedJob,
          selectedMediaSrc,
          selectedIsVideo,
          wf,
          te,
          injectAudioPipelineSegmentsJson,
        )
      : undefined,
    preview,
    onPreviewOutput,
    onLoadTranscriptEditor: te.loadTranscriptEditor,
    transcriptEditor: te.editorSourcePath
      ? buildTranscriptEditorPanelProps(te, openLocalPath, onPreviewOutput)
      : null,
    onOpenPlayerRun,
    onLoadAnnotationTier: te.loadAnnotationTier,
  };
}
