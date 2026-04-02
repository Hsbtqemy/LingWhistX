import { memo, type Dispatch, type SetStateAction } from "react";
import { fileBasename } from "../../appUtils";
import type { ExportCorrectionReport, ExportTimingRules } from "../../types";

const EXPORT_FORMATS = [
  { value: "json", label: "JSON" },
  { value: "srt", label: "SRT" },
  { value: "vtt", label: "VTT" },
  { value: "txt", label: "TXT" },
  { value: "csv", label: "CSV" },
  { value: "textgrid", label: "TextGrid" },
  { value: "eaf", label: "EAF (ELAN)" },
] as const;

type ExportFormat = (typeof EXPORT_FORMATS)[number]["value"];

export type EditorToolbarProps = {
  editorSourcePath: string;
  editorLanguage: string;
  editorDirty: boolean;
  isEditorSaving: boolean;
  isEditorLoading: boolean;
  editorError: string;
  editorStatus: string;
  canUndoEditor: boolean;
  canRedoEditor: boolean;
  canSplitActiveSegment: boolean;
  canMergePrev: boolean;
  canMergeNext: boolean;
  undoEditorChange: () => void;
  redoEditorChange: () => void;
  splitActiveSegmentAtCursor: () => void;
  mergeActiveSegment: (direction: "prev" | "next") => void;
  updateEditorLanguage: (lang: string) => void;
  saveEditedJson: (overwrite: boolean) => void;
  exportEditedTranscript: (format: ExportFormat) => void;
  exportTimingPack: () => void;
  exportRules: ExportTimingRules;
  setExportRules: Dispatch<SetStateAction<ExportTimingRules>>;
  lastExportReport: ExportCorrectionReport | null;
  onOpenPlayer: () => void;
};

export const EditorToolbar = memo(function EditorToolbar({
  editorSourcePath,
  editorLanguage,
  editorDirty,
  isEditorSaving,
  isEditorLoading,
  editorError,
  editorStatus,
  canUndoEditor,
  canRedoEditor,
  canSplitActiveSegment,
  canMergePrev,
  canMergeNext,
  undoEditorChange,
  redoEditorChange,
  splitActiveSegmentAtCursor,
  mergeActiveSegment,
  updateEditorLanguage,
  saveEditedJson,
  exportEditedTranscript,
  exportTimingPack,
  exportRules,
  setExportRules,
  lastExportReport,
  onOpenPlayer,
}: EditorToolbarProps) {
  const busy = isEditorLoading || isEditorSaving;

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar__row">
        {/* Navigation */}
        <button
          type="button"
          className="ghost small"
          onClick={onOpenPlayer}
          title="Ouvrir dans le Player"
        >
          ▶ Player
        </button>

        <span className="editor-toolbar__sep" aria-hidden />

        {/* Langue */}
        <label className="editor-toolbar__lang-label small" htmlFor="editor-toolbar-lang">
          Langue
        </label>
        <input
          id="editor-toolbar-lang"
          type="text"
          className="editor-toolbar__lang-input"
          value={editorLanguage}
          onChange={(e) => updateEditorLanguage(e.target.value)}
          placeholder="fr"
          maxLength={10}
          aria-label="Code langue"
        />

        <span className="editor-toolbar__sep" aria-hidden />

        {/* Historique */}
        <button
          type="button"
          className="ghost small"
          disabled={!canUndoEditor || busy}
          onClick={undoEditorChange}
          title="Annuler (Alt+Z)"
          aria-label="Annuler"
        >
          ↩ Undo
        </button>
        <button
          type="button"
          className="ghost small"
          disabled={!canRedoEditor || busy}
          onClick={redoEditorChange}
          title="Rétablir (Alt+⇧+Z)"
          aria-label="Rétablir"
        >
          ↪ Redo
        </button>

        <span className="editor-toolbar__sep" aria-hidden />

        {/* Edition segments */}
        <button
          type="button"
          className="ghost small"
          disabled={!canSplitActiveSegment || busy}
          onClick={splitActiveSegmentAtCursor}
          title="Couper le segment au curseur"
          aria-label="Split"
        >
          ✂ Split
        </button>
        <button
          type="button"
          className="ghost small"
          disabled={!canMergePrev || busy}
          onClick={() => mergeActiveSegment("prev")}
          title="Fusionner avec le segment précédent"
          aria-label="Fusionner précédent"
        >
          ↑ Merge
        </button>
        <button
          type="button"
          className="ghost small"
          disabled={!canMergeNext || busy}
          onClick={() => mergeActiveSegment("next")}
          title="Fusionner avec le segment suivant"
          aria-label="Fusionner suivant"
        >
          ↓ Merge
        </button>

        <span className="editor-toolbar__sep" aria-hidden />

        {/* Sauvegarde */}
        <button
          type="button"
          className="primary small"
          disabled={busy || !editorSourcePath}
          onClick={() => saveEditedJson(false)}
          title="Sauvegarder JSON (Alt+S)"
          aria-label="Sauvegarder"
        >
          {isEditorSaving ? "…" : "💾 Sauv."}
          {editorDirty && !isEditorSaving ? "*" : ""}
        </button>
        <button
          type="button"
          className="ghost small"
          disabled={busy || !editorSourcePath}
          onClick={() => saveEditedJson(true)}
          title="Écraser le fichier source"
          aria-label="Écraser source"
        >
          Écraser
        </button>

        <span className="editor-toolbar__sep" aria-hidden />

        {/* Export */}
        <select
          className="editor-toolbar__export-select"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            if (v === "timing_pack") {
              exportTimingPack();
            } else {
              exportEditedTranscript(v as ExportFormat);
            }
            e.target.value = "";
          }}
          disabled={busy || !editorSourcePath}
          aria-label="Exporter"
        >
          <option value="" disabled>
            Exporter…
          </option>
          {EXPORT_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
          <option value="timing_pack">Timing Pack (JSON+SRT+CSV)</option>
        </select>

        {/* Options export (fix overlaps) */}
        <label
          className="editor-toolbar__fix-label small"
          title="Corriger les chevauchements à l'export"
        >
          <input
            type="checkbox"
            checked={exportRules.fixOverlaps}
            onChange={(e) => setExportRules((r) => ({ ...r, fixOverlaps: e.target.checked }))}
          />
          Fix overlaps
        </label>

        {/* Placeholder WX-719 */}
        <span
          className="editor-toolbar__annotation-placeholder small"
          title="Import/export annotations (WX-719)"
          aria-label="Zone réservée annotations (WX-719)"
        >
          📎 Annot.
        </span>
      </div>

      {/* Barre de statut */}
      <div className="editor-toolbar__status-row">
        {editorSourcePath && (
          <span className="editor-toolbar__source-path mono small" title={editorSourcePath}>
            {fileBasename(editorSourcePath)}
          </span>
        )}
        {editorError && <span className="editor-toolbar__error small">{editorError}</span>}
        {editorStatus && !editorError && (
          <span className="editor-toolbar__status small">{editorStatus}</span>
        )}
        {lastExportReport && lastExportReport.totalAdjustments > 0 && (
          <span className="editor-toolbar__export-report small">
            Export : {lastExportReport.totalAdjustments} correction(s)
          </span>
        )}
        {isEditorLoading && <span className="editor-toolbar__status small">Chargement…</span>}
      </div>
    </div>
  );
});
