import type { Dispatch, SetStateAction } from "react";
import { runInTransition } from "../../whisperxOptionsTransitions";
import {
  MAX_DRAFT_AUTOSAVE_SEC,
  MAX_EDITOR_HISTORY_LIMIT,
  MIN_DRAFT_AUTOSAVE_SEC,
  MIN_EDITOR_HISTORY_LIMIT,
} from "../../constants";
import { isPreviewableFile, parseFiniteNumberInput, qaIssueLabel } from "../../appUtils";
import { ErrorBanner } from "../ErrorBanner";
import type {
  EditableSegment,
  ExportCorrectionReport,
  ExportTimingRules,
  HistoryEntry,
  TranscriptQaIssue,
} from "../../types";

export type TranscriptEditorPanelProps = {
  editorSourcePath: string;
  editorLanguage: string;
  updateEditorLanguage: (value: string) => void;
  isEditorSaving: boolean;
  isEditorLoading: boolean;
  canUndoEditor: boolean;
  canRedoEditor: boolean;
  undoEditorChange: () => void;
  redoEditorChange: () => void;
  editorHistoryLimitInput: string;
  setEditorHistoryLimitInput: Dispatch<SetStateAction<string>>;
  editorHistoryLimit: number;
  draftAutosaveSecInput: string;
  setDraftAutosaveSecInput: Dispatch<SetStateAction<string>>;
  draftAutosaveSec: number;
  purgeTranscriptDraft: (manual: boolean) => void;
  saveEditedJson: (overwriteSource: boolean) => void;
  exportEditedTranscript: (format: "srt" | "vtt" | "txt" | "json") => void;
  exportRules: ExportTimingRules;
  setExportRules: Dispatch<SetStateAction<ExportTimingRules>>;
  lastExportReport: ExportCorrectionReport | null;
  qaGapThresholdSecInput: string;
  setQaGapThresholdSecInput: Dispatch<SetStateAction<string>>;
  qaGapThresholdSec: number;
  qaMinWpsInput: string;
  setQaMinWpsInput: Dispatch<SetStateAction<string>>;
  qaMinWps: number;
  qaMaxWpsInput: string;
  setQaMaxWpsInput: Dispatch<SetStateAction<string>>;
  qaMaxWps: number;
  runTranscriptQaScan: () => void;
  qaScannedAtMs: number | null;
  qaIssues: TranscriptQaIssue[];
  qaStatus: string;
  jumpToQaIssue: (issue: TranscriptQaIssue) => void;
  autoFixQaIssue: (issue: TranscriptQaIssue) => void;
  editorSegments: EditableSegment[];
  displayedEditorSegments: EditableSegment[];
  editorDirty: boolean;
  editorUndoStack: HistoryEntry[];
  editorRedoStack: HistoryEntry[];
  activeSegmentIndex: number | null;
  setActiveSegmentIndex: (n: number | null) => void;
  updateEditorSegmentBoundary: (index: number, edge: "start" | "end", value: number) => void;
  updateEditorSegmentText: (index: number, text: string) => void;
  focusSegment: (index: number) => void;
  hasMoreEditorSegments: boolean;
  setEditorVisibleCount: Dispatch<SetStateAction<number>>;
  isAutosavingDraft: boolean;
  editorDraftUpdatedAtMs: number | null;
  editorDraftPath: string;
  editorAutosaveMessage: string;
  editorAutosaveError: string;
  editorStatus: string;
  editorError: string;
  editorLastOutputPath: string;
  openLocalPath: (path: string) => void;
  previewOutput: (path: string) => void;
};

export function TranscriptEditorPanel(props: TranscriptEditorPanelProps) {
  const {
    editorSourcePath,
    editorLanguage,
    updateEditorLanguage,
    isEditorSaving,
    isEditorLoading,
    canUndoEditor,
    canRedoEditor,
    undoEditorChange,
    redoEditorChange,
    editorHistoryLimitInput,
    setEditorHistoryLimitInput,
    editorHistoryLimit,
    draftAutosaveSecInput,
    setDraftAutosaveSecInput,
    draftAutosaveSec,
    purgeTranscriptDraft,
    saveEditedJson,
    exportEditedTranscript,
    exportRules,
    setExportRules,
    lastExportReport,
    qaGapThresholdSecInput,
    setQaGapThresholdSecInput,
    qaGapThresholdSec,
    qaMinWpsInput,
    setQaMinWpsInput,
    qaMinWps,
    qaMaxWpsInput,
    setQaMaxWpsInput,
    qaMaxWps,
    runTranscriptQaScan,
    qaScannedAtMs,
    qaIssues,
    qaStatus,
    jumpToQaIssue,
    autoFixQaIssue,
    editorSegments,
    displayedEditorSegments,
    editorDirty,
    editorUndoStack,
    editorRedoStack,
    activeSegmentIndex,
    setActiveSegmentIndex,
    updateEditorSegmentBoundary,
    updateEditorSegmentText,
    focusSegment,
    hasMoreEditorSegments,
    setEditorVisibleCount,
    isAutosavingDraft,
    editorDraftUpdatedAtMs,
    editorDraftPath,
    editorAutosaveMessage,
    editorAutosaveError,
    editorStatus,
    editorError,
    editorLastOutputPath,
    openLocalPath,
    previewOutput,
  } = props;

  const hasBlockingAlerts = Boolean(editorError || editorAutosaveError);

  return (
    <div className="editor-panel">
      <section className="transcript-editor-section" aria-labelledby="transcript-editor-file-title">
        <h3 id="transcript-editor-file-title" className="transcript-editor-section__title">
          Fichier source
        </h3>
        <p className="mono">{editorSourcePath}</p>
        <label>
          Langue
          <input
            value={editorLanguage}
            onChange={(e) => updateEditorLanguage(e.currentTarget.value)}
            placeholder="fr, en..."
          />
        </label>
      </section>

      <section className="transcript-editor-section" aria-labelledby="transcript-editor-actions-title">
        <h3 id="transcript-editor-actions-title" className="transcript-editor-section__title">
          Commandes
        </h3>
      <div className="editor-toolbar">
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading || !canUndoEditor}
          onClick={undoEditorChange}
        >
          Undo (Ctrl+Z)
        </button>
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading || !canRedoEditor}
          onClick={redoEditorChange}
        >
          Redo (Ctrl+Y)
        </button>
        <label className="editor-history-limit">
          Historique max
          <input
            type="number"
            min={MIN_EDITOR_HISTORY_LIMIT}
            max={MAX_EDITOR_HISTORY_LIMIT}
            step="10"
            value={editorHistoryLimitInput}
            onChange={(e) => setEditorHistoryLimitInput(e.currentTarget.value)}
            onBlur={() => setEditorHistoryLimitInput(String(editorHistoryLimit))}
          />
        </label>
        <label className="editor-history-limit">
          Autosave (s)
          <input
            type="number"
            min={MIN_DRAFT_AUTOSAVE_SEC}
            max={MAX_DRAFT_AUTOSAVE_SEC}
            step="1"
            value={draftAutosaveSecInput}
            onChange={(e) => setDraftAutosaveSecInput(e.currentTarget.value)}
            onBlur={() => setDraftAutosaveSecInput(String(draftAutosaveSec))}
          />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading || !editorSourcePath}
          onClick={() => purgeTranscriptDraft(true)}
        >
          Purger brouillon
        </button>
        <button
          type="button"
          disabled={isEditorSaving || isEditorLoading}
          onClick={() => saveEditedJson(false)}
        >
          Sauver JSON
        </button>
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading}
          onClick={() => saveEditedJson(true)}
        >
          Ecraser source
        </button>
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading}
          onClick={() => exportEditedTranscript("srt")}
        >
          Export SRT
        </button>
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading}
          onClick={() => exportEditedTranscript("vtt")}
        >
          Export VTT
        </button>
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading}
          onClick={() => exportEditedTranscript("txt")}
        >
          Export TXT
        </button>
        <button
          type="button"
          className="ghost"
          disabled={isEditorSaving || isEditorLoading}
          onClick={() => exportEditedTranscript("json")}
        >
          Export JSON
        </button>
      </div>
      </section>

      {hasBlockingAlerts ? (
        <section
          className="transcript-editor-section transcript-editor-section--alerts"
          role="region"
          aria-labelledby="transcript-editor-alerts-title"
        >
          <h3 id="transcript-editor-alerts-title" className="transcript-editor-section__title">
            Alertes
          </h3>
          {editorAutosaveError ? (
            <ErrorBanner>
              <p className="error-banner-text">{editorAutosaveError}</p>
            </ErrorBanner>
          ) : null}
          {editorError ? (
            <ErrorBanner>
              <p className="error-banner-text">{editorError}</p>
            </ErrorBanner>
          ) : null}
        </section>
      ) : null}

      <section className="transcript-editor-section" aria-labelledby="transcript-editor-export-title">
        <h3 id="transcript-editor-export-title" className="transcript-editor-section__title">
          Export
        </h3>
      <div className="export-rules-grid">
        <label>
          Min Duration (s)
          <input
            type="number"
            step="0.005"
            min="0.001"
            value={exportRules.minDurationSec}
            onChange={(e) => {
              const next = parseFiniteNumberInput(e.currentTarget.value);
              if (next !== null) {
                setExportRules((prev) => ({ ...prev, minDurationSec: next }));
              }
            }}
          />
        </label>
        <label>
          Min Gap (s)
          <input
            type="number"
            step="0.005"
            min="0"
            value={exportRules.minGapSec}
            onChange={(e) => {
              const next = parseFiniteNumberInput(e.currentTarget.value);
              if (next !== null) {
                setExportRules((prev) => ({ ...prev, minGapSec: next }));
              }
            }}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={exportRules.fixOverlaps}
            onChange={(e) =>
              runInTransition(() =>
                setExportRules((prev) => ({
                  ...prev,
                  fixOverlaps: e.currentTarget.checked,
                })),
              )
            }
          />
          Corriger overlaps
        </label>
      </div>

      {lastExportReport ? (
        <div className="export-report-box">
          <p className="small">
            Rapport export: adjustments={lastExportReport.totalAdjustments} | overlaps fixes=
            {lastExportReport.overlapsFixed} | min-gap={lastExportReport.minGapAdjustments} |
            min-duration=
            {lastExportReport.minDurationAdjustments}
          </p>
          <p className="small">
            Segments in/out: {lastExportReport.inputSegments} / {lastExportReport.outputSegments}
            {lastExportReport.reorderedSegments ? " | Reordonnancement applique" : ""}
          </p>
          <ul className="report-notes">
            {lastExportReport.notes.map((note, idx) => (
              <li key={`${note}-${idx}`}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
      </section>

      <section className="transcript-editor-section" aria-labelledby="transcript-editor-qa-title">
        <h3 id="transcript-editor-qa-title" className="transcript-editor-section__title">
          Contrôle qualité (QA)
        </h3>
      <div className="qa-panel">
        <div className="qa-toolbar">
          <label>
            Gap &gt; (s)
            <input
              type="number"
              step="0.05"
              min="0"
              value={qaGapThresholdSecInput}
              onChange={(e) => setQaGapThresholdSecInput(e.currentTarget.value)}
              onBlur={() => setQaGapThresholdSecInput(qaGapThresholdSec.toFixed(2))}
            />
          </label>
          <label>
            Debit min (mots/s)
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={qaMinWpsInput}
              onChange={(e) => setQaMinWpsInput(e.currentTarget.value)}
              onBlur={() => setQaMinWpsInput(qaMinWps.toFixed(2))}
            />
          </label>
          <label>
            Debit max (mots/s)
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={qaMaxWpsInput}
              onChange={(e) => setQaMaxWpsInput(e.currentTarget.value)}
              onBlur={() => setQaMaxWpsInput(qaMaxWps.toFixed(2))}
            />
          </label>
          <button type="button" className="ghost" onClick={runTranscriptQaScan}>
            Rescanner QA
          </button>
        </div>
        <p className="small">
          QA scan: {qaScannedAtMs ? new Date(qaScannedAtMs).toLocaleString() : "jamais"} |
          anomalies: {qaIssues.length}
        </p>
        {qaStatus ? <p className="small">{qaStatus}</p> : null}
        {qaIssues.length === 0 ? (
          <p className="small">Aucune anomalie QA pour les regles courantes.</p>
        ) : (
          <ul className="qa-issue-list">
            {qaIssues.map((issue) => (
              <li className={`qa-issue ${issue.severity}`} key={issue.id}>
                <div className="qa-issue-main">
                  <span className={`qa-severity ${issue.severity}`}>{issue.severity}</span>
                  <strong>{qaIssueLabel(issue.type)}</strong>
                  <span className="small">
                    Segment #{issue.segmentIndex + 1}
                    {issue.relatedSegmentIndex !== undefined
                      ? ` / #${issue.relatedSegmentIndex + 1}`
                      : ""}
                  </span>
                  <span>{issue.message}</span>
                </div>
                <div className="qa-issue-actions">
                  <button type="button" className="ghost" onClick={() => jumpToQaIssue(issue)}>
                    Aller
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => autoFixQaIssue(issue)}
                    disabled={!issue.canAutoFix}
                  >
                    Auto-fix
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      </section>

      <details className="transcript-editor-details">
        <summary>État technique (autosave, chargement, statistiques)</summary>
        <div className="transcript-editor-details__body">
          <p className="small">
            Segments: {editorSegments.length} | Affiches: {displayedEditorSegments.length}
            {editorDirty ? " | Modifications non sauvegardees" : ""} | Undo/Redo:{" "}
            {editorUndoStack.length}/{editorRedoStack.length} (max {editorHistoryLimit})
          </p>
          <p className="small">
            Autosave brouillon: toutes les {draftAutosaveSec}s |{" "}
            {isAutosavingDraft
              ? "en cours..."
              : editorDraftUpdatedAtMs
                ? `dernier ${new Date(editorDraftUpdatedAtMs).toLocaleString()}`
                : "aucun brouillon"}
          </p>
          {editorDraftPath ? <p className="small mono">{editorDraftPath}</p> : null}
          {editorAutosaveMessage ? <p className="small">{editorAutosaveMessage}</p> : null}
          {isEditorLoading ? <p className="small">Chargement de l&apos;éditeur…</p> : null}
          {editorStatus ? <p className="small">{editorStatus}</p> : null}
        </div>
      </details>

      {editorLastOutputPath ? (
        <div className="editor-last-output">
          <p className="mono">{editorLastOutputPath}</p>
          <div className="file-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => openLocalPath(editorLastOutputPath)}
            >
              Ouvrir
            </button>
            {isPreviewableFile(editorLastOutputPath) ? (
              <button
                type="button"
                className="ghost"
                onClick={() => previewOutput(editorLastOutputPath)}
              >
                Prévisualiser
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="transcript-editor-section" aria-labelledby="transcript-editor-segments-title">
        <h3 id="transcript-editor-segments-title" className="transcript-editor-section__title">
          Segments
        </h3>
      <div className="editor-segments">
        {displayedEditorSegments.map((segment, index) => (
          <div
            className={`editor-segment ${activeSegmentIndex === index ? "selected" : ""}`}
            key={`${segment.start}-${segment.end}-${index}`}
            onClick={() => setActiveSegmentIndex(index)}
          >
            <p className="small">
              #{index + 1} | {segment.start.toFixed(3)}s - {segment.end.toFixed(3)}s
              {segment.speaker ? ` | ${segment.speaker}` : ""}
            </p>
            <div className="segment-controls">
              <label>
                Start (s)
                <input
                  type="number"
                  step="0.001"
                  value={segment.start}
                  onChange={(e) => {
                    const value = parseFiniteNumberInput(e.currentTarget.value);
                    if (value !== null) {
                      updateEditorSegmentBoundary(index, "start", value);
                    }
                  }}
                />
              </label>
              <label>
                End (s)
                <input
                  type="number"
                  step="0.001"
                  value={segment.end}
                  onChange={(e) => {
                    const value = parseFiniteNumberInput(e.currentTarget.value);
                    if (value !== null) {
                      updateEditorSegmentBoundary(index, "end", value);
                    }
                  }}
                />
              </label>
              <button type="button" className="ghost" onClick={() => focusSegment(index)}>
                Focus waveform
              </button>
            </div>
            <textarea
              value={segment.text}
              onChange={(e) => updateEditorSegmentText(index, e.currentTarget.value)}
              rows={2}
            />
          </div>
        ))}
      </div>
      </section>

      {hasMoreEditorSegments ? (
        <button
          type="button"
          className="ghost"
          onClick={() => setEditorVisibleCount((count) => count + 120)}
        >
          Charger 120 segments de plus
        </button>
      ) : null}
    </div>
  );
}
