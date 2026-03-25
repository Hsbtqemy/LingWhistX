import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_QA_GAP_SEC, DEFAULT_QA_MAX_WPS, DEFAULT_QA_MIN_WPS } from "../../constants";
import { buildTranscriptQaIssues, qaIssueLabel } from "../../appUtils";
import type { EditableSegment, EditorSnapshot, TranscriptQaIssue } from "../../types";
import { applyQaAutoFixSnapshot } from "./qaAutoFix";
import type { WaveformWorkspace } from "../useWaveformWorkspace";

export type UseEditorQaArgs = {
  editorSourcePath: string;
  editorSegmentsRef: MutableRefObject<EditableSegment[]>;
  editorVisibleCount: number;
  setEditorVisibleCount: Dispatch<SetStateAction<number>>;
  wf: WaveformWorkspace;
  applyEditorSnapshotMutation: (
    mutator: (current: EditorSnapshot) => EditorSnapshot,
    options?: { recordHistory?: boolean; clearRedo?: boolean },
  ) => boolean;
  setActiveSegmentIndex: Dispatch<SetStateAction<number | null>>;
};

export function useEditorQa({
  editorSourcePath,
  editorSegmentsRef,
  editorVisibleCount,
  setEditorVisibleCount,
  wf,
  applyEditorSnapshotMutation,
  setActiveSegmentIndex,
}: UseEditorQaArgs) {
  const [qaGapThresholdSecInput, setQaGapThresholdSecInput] = useState(String(DEFAULT_QA_GAP_SEC));
  const [qaMinWpsInput, setQaMinWpsInput] = useState(String(DEFAULT_QA_MIN_WPS));
  const [qaMaxWpsInput, setQaMaxWpsInput] = useState(String(DEFAULT_QA_MAX_WPS));
  const [qaIssues, setQaIssues] = useState<TranscriptQaIssue[]>([]);
  const [qaScannedAtMs, setQaScannedAtMs] = useState<number | null>(null);
  const [qaStatus, setQaStatus] = useState("");

  const qaGapThresholdSec = useMemo(() => {
    const parsed = Number(qaGapThresholdSecInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_QA_GAP_SEC;
    }
    return Math.max(0, parsed);
  }, [qaGapThresholdSecInput]);
  const qaMinWps = useMemo(() => {
    const parsed = Number(qaMinWpsInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_QA_MIN_WPS;
    }
    return Math.max(0.1, parsed);
  }, [qaMinWpsInput]);
  const qaMaxWps = useMemo(() => {
    const parsed = Number(qaMaxWpsInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_QA_MAX_WPS;
    }
    return Math.max(0.1, parsed);
  }, [qaMaxWpsInput]);

  function ensureEditorSegmentVisible(index: number) {
    if (index < 0) {
      return;
    }
    const pageSize = 120;
    if (index >= editorVisibleCount) {
      const nextVisible = Math.ceil((index + 1) / pageSize) * pageSize;
      setEditorVisibleCount(nextVisible);
    }
  }

  function runTranscriptQaScan() {
    const maxWps = Math.max(qaMinWps, qaMaxWps);
    const issues = buildTranscriptQaIssues(
      editorSegmentsRef.current,
      qaGapThresholdSec,
      qaMinWps,
      maxWps,
    );
    setQaIssues(issues);
    setQaScannedAtMs(Date.now());
    setQaStatus(
      issues.length === 0
        ? "QA: aucune anomalie detectee."
        : `QA: ${issues.length} anomalie(s) detectee(s).`,
    );
  }

  function jumpToQaIssue(issue: TranscriptQaIssue) {
    const index = issue.segmentIndex;
    const segment = editorSegmentsRef.current[index];
    if (!segment) {
      return;
    }
    ensureEditorSegmentVisible(index);
    setActiveSegmentIndex(index);
    wf.seekMedia(segment.start);
    setQaStatus(`QA focus: segment #${index + 1}.`);
  }

  function autoFixQaIssue(issue: TranscriptQaIssue) {
    const changed = applyEditorSnapshotMutation((current) => {
      const result = applyQaAutoFixSnapshot(current, issue, {
        waveformDurationSec: wf.waveform?.durationSec,
        qaMinWps,
        qaMaxWps,
      });
      return result ?? current;
    });

    if (!changed) {
      setQaStatus(`Auto-fix impossible pour ${qaIssueLabel(issue.type).toLowerCase()}.`);
      return;
    }

    setQaStatus(
      `Auto-fix applique (${qaIssueLabel(issue.type)}) sur segment #${issue.segmentIndex + 1}.`,
    );
    ensureEditorSegmentVisible(issue.segmentIndex);
    setActiveSegmentIndex(issue.segmentIndex);
    runTranscriptQaScan();
  }

  function seedQaFromLoadedSegments(segments: EditableSegment[]) {
    const initialQaIssues = buildTranscriptQaIssues(
      segments,
      qaGapThresholdSec,
      qaMinWps,
      Math.max(qaMinWps, qaMaxWps),
    );
    setQaIssues(initialQaIssues);
    setQaScannedAtMs(Date.now());
    setQaStatus(
      initialQaIssues.length === 0
        ? "QA: aucune anomalie detectee."
        : `QA: ${initialQaIssues.length} anomalie(s) detectee(s).`,
    );
  }

  function clearQaState() {
    setQaIssues([]);
    setQaScannedAtMs(null);
    setQaStatus("");
  }

  useEffect(() => {
    if (editorSourcePath) {
      return;
    }
    setQaIssues([]);
    setQaScannedAtMs(null);
    setQaStatus("");
  }, [editorSourcePath]);

  return {
    qaGapThresholdSecInput,
    setQaGapThresholdSecInput,
    qaGapThresholdSec,
    qaMinWpsInput,
    setQaMinWpsInput,
    qaMinWps,
    qaMaxWpsInput,
    setQaMaxWpsInput,
    qaMaxWps,
    qaIssues,
    qaScannedAtMs,
    qaStatus,
    runTranscriptQaScan,
    jumpToQaIssue,
    autoFixQaIssue,
    seedQaFromLoadedSegments,
    clearQaState,
  };
}
