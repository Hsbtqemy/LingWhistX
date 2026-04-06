import { memo, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fileBasename, formatClockSeconds } from "../../appUtils";
import { useEditorToolbarLayout } from "../../hooks/useEditorToolbarLayout";
import type { UsePlayerPlaybackResult } from "../../hooks/usePlayerPlayback";
import type { AnnotationConvention, ExportCorrectionReport, ExportTimingRules } from "../../types";

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
  playback: UsePlayerPlaybackResult;
  editorSourcePath: string;
  isEditorSaving: boolean;
  isEditorLoading: boolean;
  editorError: string;
  editorStatus: string;
  canUndoEditor: boolean;
  canRedoEditor: boolean;
  canSplitActiveSegment: boolean;
  canMergePrev: boolean;
  canMergeNext: boolean;
  canDeleteSegment: boolean;
  undoEditorChange: () => void;
  redoEditorChange: () => void;
  splitActiveSegmentAtCursor: () => void;
  mergeActiveSegment: (direction: "prev" | "next") => void;
  insertBlankSegment: () => void;
  deleteActiveSegment: () => void;
  exportEditedTranscript: (format: ExportFormat) => void;
  exportTimingPack: () => void;
  exportRules: ExportTimingRules;
  setExportRules: Dispatch<SetStateAction<ExportTimingRules>>;
  lastExportReport: ExportCorrectionReport | null;
  activeConvention: AnnotationConvention | null;
  availableConventions: AnnotationConvention[];
  activeConventionId: string;
  onChangeConvention: (id: string) => void;
  onInsertMark: (symbol: string) => void;
};

export const EditorToolbar = memo(function EditorToolbar({
  playback,
  editorSourcePath,
  isEditorSaving,
  isEditorLoading,
  editorError,
  editorStatus,
  canUndoEditor,
  canRedoEditor,
  canSplitActiveSegment,
  canMergePrev,
  canMergeNext,
  canDeleteSegment,
  undoEditorChange,
  redoEditorChange,
  splitActiveSegmentAtCursor,
  mergeActiveSegment,
  insertBlankSegment,
  deleteActiveSegment,
  exportEditedTranscript,
  exportTimingPack,
  exportRules,
  setExportRules,
  lastExportReport,
  activeConvention,
  availableConventions,
  activeConventionId,
  onChangeConvention,
  onInsertMark,
}: EditorToolbarProps) {
  const busy = isEditorLoading || isEditorSaving;
  const hasMarks = (activeConvention?.marks.length ?? 0) > 0;

  const { toolbarRef, narrowPlayback, narrowSegments, narrowExport } = useEditorToolbarLayout();
  const [playbackOverflowOpen, setPlaybackOverflowOpen] = useState(false);
  const [segmentsOverflowOpen, setSegmentsOverflowOpen] = useState(false);
  const [overlapHelpOpen, setOverlapHelpOpen] = useState(false);
  const playbackOverflowWrapRef = useRef<HTMLDivElement>(null);
  const segmentsOverflowWrapRef = useRef<HTMLDivElement>(null);
  const overlapHelpWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!narrowPlayback) setPlaybackOverflowOpen(false);
  }, [narrowPlayback]);

  useEffect(() => {
    if (!narrowSegments) setSegmentsOverflowOpen(false);
  }, [narrowSegments]);

  useEffect(() => {
    setOverlapHelpOpen(false);
  }, [narrowExport]);

  useEffect(() => {
    if (busy) {
      setPlaybackOverflowOpen(false);
      setSegmentsOverflowOpen(false);
      setOverlapHelpOpen(false);
    }
  }, [busy]);

  useEffect(() => {
    if (!segmentsOverflowOpen && !playbackOverflowOpen && !overlapHelpOpen) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (segmentsOverflowOpen && !segmentsOverflowWrapRef.current?.contains(t)) {
        setSegmentsOverflowOpen(false);
      }
      if (playbackOverflowOpen && !playbackOverflowWrapRef.current?.contains(t)) {
        setPlaybackOverflowOpen(false);
      }
      if (overlapHelpOpen && !overlapHelpWrapRef.current?.contains(t)) {
        setOverlapHelpOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [segmentsOverflowOpen, playbackOverflowOpen, overlapHelpOpen]);

  useEffect(() => {
    if (!segmentsOverflowOpen && !playbackOverflowOpen && !overlapHelpOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSegmentsOverflowOpen(false);
        setPlaybackOverflowOpen(false);
        setOverlapHelpOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [segmentsOverflowOpen, playbackOverflowOpen, overlapHelpOpen]);

  const closeSegmentsOverflow = () => setSegmentsOverflowOpen(false);

  return (
    <div
      ref={toolbarRef}
      className="editor-toolbar"
      role="region"
      aria-label="Panneau lecture et édition"
    >
      {/* ── Lecture (transport + boucle — déplacé depuis le mini-lecteur) ── */}
      <div className="editor-toolbar__section editor-toolbar__section--playback">
        <span className="editor-toolbar__section-label" id="editor-toolbar-sec-playback">
          Lecture
        </span>
        <div
          className={`editor-toolbar__row editor-toolbar__row--section editor-toolbar__row--playback${narrowPlayback ? " editor-toolbar__row--playback-bar" : ""}`}
          aria-labelledby="editor-toolbar-sec-playback"
        >
          <span className="editor-toolbar__time mono small" title="Position / durée">
            {formatClockSeconds(playback.currentTimeSec)} /{" "}
            {formatClockSeconds(playback.durationSec ?? 0)}
          </span>

          <button
            type="button"
            className="ghost small"
            onClick={() => playback.seek(0)}
            title="Aller au début"
            aria-label="Aller au début"
          >
            |◀
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={() => playback.seekRelative(-5)}
            title="Reculer 5 s"
            aria-label="Reculer 5 secondes"
          >
            ◀◀
          </button>
          <button
            type="button"
            className="ghost small editor-toolbar__play-btn"
            onClick={() => void playback.togglePlayPause()}
            title={playback.playing ? "Pause" : "Lecture"}
            aria-label={playback.playing ? "Pause" : "Lecture"}
          >
            {playback.playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={() => playback.seekRelative(5)}
            title="Avancer 5 s"
            aria-label="Avancer 5 secondes"
          >
            ▶▶
          </button>

          {!narrowPlayback ? (
            <>
              <span className="editor-toolbar__sep" aria-hidden />

              <button
                type="button"
                className="ghost small"
                onClick={() => playback.nudgePlaybackRate(-0.25)}
                title="Ralentir (−0,25×)"
                aria-label="Ralentir"
              >
                −
              </button>
              <span className="editor-toolbar__speed mono small" title="Vitesse de lecture">
                {playback.playbackRate.toFixed(2)}×
              </span>
              <button
                type="button"
                className="ghost small"
                onClick={() => playback.nudgePlaybackRate(0.25)}
                title="Accélérer (+0,25×)"
                aria-label="Accélérer"
              >
                +
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={playback.toggleMute}
                title={playback.muted ? "Rétablir le son" : "Couper le son"}
                aria-label={playback.muted ? "Rétablir le son" : "Couper le son"}
              >
                {playback.muted ? "🔇" : "🔊"}
              </button>

              <span className="editor-toolbar__sep" aria-hidden />

              <button
                type="button"
                className="ghost small"
                onClick={playback.markLoopA}
                title="Marquer le point A de la boucle"
                aria-label="Boucle point A"
              >
                A
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={playback.markLoopB}
                title="Marquer le point B de la boucle"
                aria-label="Boucle point B"
              >
                B
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={playback.clearLoop}
                disabled={playback.loopAsec == null && playback.loopBsec == null}
                title="Effacer la boucle A–B"
                aria-label="Effacer la boucle"
              >
                ⌧ Boucle
              </button>
            </>
          ) : (
            <>
              <span className="editor-toolbar__sep" aria-hidden />
              <div ref={playbackOverflowWrapRef} className="editor-toolbar__overflow-wrap">
                <button
                  type="button"
                  className="ghost small editor-toolbar__overflow-trigger"
                  onClick={() => setPlaybackOverflowOpen((o) => !o)}
                  aria-expanded={playbackOverflowOpen}
                  aria-haspopup="dialog"
                  aria-controls="editor-toolbar-playback-overflow"
                  id="editor-toolbar-playback-trigger"
                  title="Vitesse, son, boucle A–B…"
                >
                  Autres…
                </button>
                {playbackOverflowOpen && (
                  <div
                    id="editor-toolbar-playback-overflow"
                    role="region"
                    aria-label="Vitesse, son et boucle"
                    className="editor-toolbar__overflow-flyout editor-toolbar__playback-overflow-menu"
                  >
                    <div className="editor-toolbar__playback-overflow-rate" aria-label="Vitesse">
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => playback.nudgePlaybackRate(-0.25)}
                        title="Ralentir (−0,25×)"
                        aria-label="Ralentir"
                      >
                        −
                      </button>
                      <span
                        className="editor-toolbar__speed mono small"
                        title="Vitesse de lecture"
                        aria-live="polite"
                      >
                        {playback.playbackRate.toFixed(2)}×
                      </span>
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => playback.nudgePlaybackRate(0.25)}
                        title="Accélérer (+0,25×)"
                        aria-label="Accélérer"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="ghost small editor-toolbar__overflow-menu-item"
                      onClick={playback.toggleMute}
                    >
                      {playback.muted ? "🔇 Rétablir le son" : "🔊 Couper le son"}
                    </button>
                    <button
                      type="button"
                      className="ghost small editor-toolbar__overflow-menu-item"
                      onClick={playback.markLoopA}
                    >
                      Point A de boucle
                    </button>
                    <button
                      type="button"
                      className="ghost small editor-toolbar__overflow-menu-item"
                      onClick={playback.markLoopB}
                    >
                      Point B de boucle
                    </button>
                    <button
                      type="button"
                      className="ghost small editor-toolbar__overflow-menu-item"
                      disabled={playback.loopAsec == null && playback.loopBsec == null}
                      onClick={playback.clearLoop}
                    >
                      ⌧ Effacer la boucle
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Segments ── */}
      <div className="editor-toolbar__section editor-toolbar__section--segments">
        <span className="editor-toolbar__section-label" id="editor-toolbar-sec-segments">
          Segments
        </span>
        <div className="editor-toolbar__segments-convention-row">
          <div
            className={`editor-toolbar__row editor-toolbar__row--section${narrowSegments ? " editor-toolbar__row--segments-bar" : ""}`}
            aria-labelledby="editor-toolbar-sec-segments"
          >
            <button
              type="button"
              className="ghost small"
              disabled={!canUndoEditor || busy}
              onClick={undoEditorChange}
              title="Annuler (Alt+Z)"
              aria-label="Annuler"
            >
              ↩
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={!canRedoEditor || busy}
              onClick={redoEditorChange}
              title="Rétablir (Alt+⇧+Z)"
              aria-label="Rétablir"
            >
              ↪
            </button>
            <span className="editor-toolbar__sep" aria-hidden />
            <button
              type="button"
              className="ghost small"
              disabled={!canSplitActiveSegment || busy}
              onClick={splitActiveSegmentAtCursor}
              title="Couper le segment au curseur waveform"
              aria-label="Split"
            >
              ✂ Split
            </button>
            {!narrowSegments ? (
              <>
                <span className="editor-toolbar__sep" aria-hidden />
                <div
                  className="editor-toolbar__merge-cluster"
                  role="group"
                  aria-label="Fusion avec le segment voisin"
                >
                  <button
                    type="button"
                    className="ghost small editor-toolbar__merge-cluster-btn editor-toolbar__merge-cluster-btn--prev"
                    disabled={!canMergePrev || busy}
                    onClick={() => mergeActiveSegment("prev")}
                    title="Fusionner avec le segment précédent"
                    aria-label="Fusionner avec le précédent"
                  >
                    ↑
                  </button>
                  <span className="editor-toolbar__merge-cluster-label" aria-hidden>
                    Merge
                  </span>
                  <button
                    type="button"
                    className="ghost small editor-toolbar__merge-cluster-btn editor-toolbar__merge-cluster-btn--next"
                    disabled={!canMergeNext || busy}
                    onClick={() => mergeActiveSegment("next")}
                    title="Fusionner avec le segment suivant"
                    aria-label="Fusionner avec le suivant"
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy || !editorSourcePath.trim()}
                  onClick={insertBlankSegment}
                  title="Insérer un segment vide (position curseur waveform)"
                  aria-label="Insérer un segment vide"
                >
                  + Segment
                </button>
                <button
                  type="button"
                  className="ghost small editor-toolbar__delete-btn"
                  disabled={!canDeleteSegment || busy}
                  onClick={deleteActiveSegment}
                  title="Supprimer le segment actif"
                  aria-label="Supprimer segment"
                >
                  🗑
                </button>
              </>
            ) : (
              <>
                <span className="editor-toolbar__sep" aria-hidden />
                <div ref={segmentsOverflowWrapRef} className="editor-toolbar__overflow-wrap">
                  <button
                    type="button"
                    className="ghost small editor-toolbar__overflow-trigger"
                    disabled={busy}
                    onClick={() => setSegmentsOverflowOpen((o) => !o)}
                    aria-expanded={segmentsOverflowOpen}
                    aria-haspopup="menu"
                    aria-controls="editor-toolbar-segments-overflow"
                    id="editor-toolbar-segments-trigger"
                    title="Fusion, insertion, suppression…"
                  >
                    Autres…
                  </button>
                  {segmentsOverflowOpen && (
                    <div
                      id="editor-toolbar-segments-overflow"
                      role="menu"
                      className="editor-toolbar__overflow-flyout"
                      aria-labelledby="editor-toolbar-segments-trigger"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="ghost small editor-toolbar__overflow-menu-item"
                        disabled={!canMergePrev || busy}
                        onClick={() => {
                          mergeActiveSegment("prev");
                          closeSegmentsOverflow();
                        }}
                      >
                        ↑ Fusionner avec le précédent
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="ghost small editor-toolbar__overflow-menu-item"
                        disabled={!canMergeNext || busy}
                        onClick={() => {
                          mergeActiveSegment("next");
                          closeSegmentsOverflow();
                        }}
                      >
                        ↓ Fusionner avec le suivant
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="ghost small editor-toolbar__overflow-menu-item"
                        disabled={busy || !editorSourcePath.trim()}
                        onClick={() => {
                          insertBlankSegment();
                          closeSegmentsOverflow();
                        }}
                      >
                        + Segment vide
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="ghost small editor-toolbar__overflow-menu-item editor-toolbar__delete-btn"
                        disabled={!canDeleteSegment || busy}
                        onClick={() => {
                          deleteActiveSegment();
                          closeSegmentsOverflow();
                        }}
                      >
                        🗑 Supprimer le segment
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {availableConventions.length > 0 ? (
            <div className="editor-toolbar__convention-line editor-toolbar__convention-line--inline editor-toolbar__convention-line--segments-toolbar">
              <div className="editor-toolbar__convention-line-head">
                <span
                  className="editor-toolbar__export-inline-label"
                  id="editor-toolbar-conv-label"
                >
                  Convention
                </span>
                <select
                  className="editor-toolbar__convention-select small"
                  value={activeConventionId}
                  onChange={(e) => onChangeConvention(e.target.value)}
                  aria-labelledby="editor-toolbar-conv-label"
                  title="Convention d’annotation pour les raccourcis de marques"
                >
                  {availableConventions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              {hasMarks ? (
                <div
                  className="editor-toolbar__convention-marks"
                  role="group"
                  aria-label="Raccourcis de marques (convention active)"
                >
                  {activeConvention?.marks.map((mark) => (
                    <button
                      key={mark.id}
                      type="button"
                      className="ghost small editor-toolbar__mark-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onInsertMark(mark.symbol);
                      }}
                      title={mark.description ? `${mark.label} — ${mark.description}` : mark.label}
                      aria-label={`Insérer ${mark.label}`}
                    >
                      {mark.symbol}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Export ── */}
      <div className="editor-toolbar__section editor-toolbar__section--export">
        <span className="editor-toolbar__section-label" id="editor-toolbar-sec-export">
          Export
        </span>
        <div className="editor-toolbar__export-col" aria-labelledby="editor-toolbar-sec-export">
          {narrowExport ? (
            <div className="editor-toolbar__export-row editor-toolbar__export-row--format-narrow">
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
                aria-label="Format d'export du transcript — le fichier est créé dans le dossier du run"
                title="Choisissez un format : le fichier est créé dans le dossier du run."
              >
                <option value="" disabled>
                  Choisir un format…
                </option>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
                <option value="timing_pack">Timing Pack (JSON+SRT+CSV)</option>
              </select>
              <div className="editor-toolbar__fix-label-cluster editor-toolbar__fix-label-cluster--narrow">
                <label
                  className="editor-toolbar__fix-label editor-toolbar__fix-label--narrow-toolbar"
                  title="Ajuste les fins de segments pour éviter les chevauchements lors de l’export (SRT, VTT, etc.)."
                >
                  <input
                    type="checkbox"
                    checked={exportRules.fixOverlaps}
                    onChange={(e) =>
                      setExportRules((r) => ({ ...r, fixOverlaps: e.currentTarget.checked }))
                    }
                  />
                  <span className="editor-toolbar__fix-label-text">
                    Corriger les chevauchements à l&apos;export
                  </span>
                </label>
                <div ref={overlapHelpWrapRef} className="editor-toolbar__overlap-help-wrap">
                  <button
                    type="button"
                    className="ghost small editor-toolbar__overlap-help-btn"
                    aria-expanded={overlapHelpOpen}
                    aria-controls="editor-toolbar-export-overlap-help"
                    aria-label="Aide sur la correction des chevauchements à l’export"
                    onClick={() => setOverlapHelpOpen((o) => !o)}
                  >
                    ?
                  </button>
                  {overlapHelpOpen ? (
                    <div
                      id="editor-toolbar-export-overlap-help"
                      role="dialog"
                      aria-label="Aide chevauchements export"
                      className="editor-toolbar__overlap-help-flyout"
                    >
                      <p className="editor-toolbar__export-hint-detail">
                        La case « Corriger les chevauchements » ajuste les fins de segments pour
                        limiter les recouvrements (surtout utile pour SRT et VTT). Les règles de
                        timing sont prises en compte pour chaque format d&apos;export.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="editor-toolbar__export-row editor-toolbar__export-row--format-overlaps">
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
                  aria-label="Format d'export du transcript — le fichier est créé dans le dossier du run"
                  title="Choisissez un format : le fichier est créé dans le dossier du run."
                >
                  <option value="" disabled>
                    Choisir un format…
                  </option>
                  {EXPORT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                  <option value="timing_pack">Timing Pack (JSON+SRT+CSV)</option>
                </select>
                <div className="editor-toolbar__fix-label-cluster">
                  <label
                    className="editor-toolbar__fix-label"
                    title="Ajuste les fins de segments pour éviter les chevauchements lors de l’export (SRT, VTT, etc.)."
                  >
                    <input
                      type="checkbox"
                      checked={exportRules.fixOverlaps}
                      onChange={(e) =>
                        setExportRules((r) => ({ ...r, fixOverlaps: e.target.checked }))
                      }
                    />
                    <span className="editor-toolbar__fix-label-text">
                      Corriger les chevauchements à l&apos;export
                    </span>
                  </label>
                  <div ref={overlapHelpWrapRef} className="editor-toolbar__overlap-help-wrap">
                    <button
                      type="button"
                      className="ghost small editor-toolbar__overlap-help-btn"
                      aria-expanded={overlapHelpOpen}
                      aria-controls="editor-toolbar-export-overlap-help"
                      aria-label="Aide sur la correction des chevauchements à l’export"
                      onClick={() => setOverlapHelpOpen((o) => !o)}
                    >
                      ?
                    </button>
                    {overlapHelpOpen ? (
                      <div
                        id="editor-toolbar-export-overlap-help"
                        role="dialog"
                        aria-label="Aide chevauchements export"
                        className="editor-toolbar__overlap-help-flyout"
                      >
                        <p className="editor-toolbar__export-hint-detail">
                          La case « Corriger les chevauchements » ajuste les fins de segments pour
                          limiter les recouvrements (surtout utile pour SRT et VTT). Les règles de
                          timing sont prises en compte pour chaque format d&apos;export.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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
