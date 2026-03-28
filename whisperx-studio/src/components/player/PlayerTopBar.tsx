import { fileBasename } from "../../appUtils";

export type PlayerTopBarProps = {
  onBack: () => void;
  runLabel: string;
  runDir: string | null;
  mediaPath: string | null;
  shortcutsHelpOpen: boolean;
  onToggleShortcutsHelp: () => void;
  loopHint: string;
  onMarkLoopA: () => void;
  onMarkLoopB: () => void;
  onClearLoop: () => void;
  loopAsec: number | null;
  loopBsec: number | null;
  transportDisabled: boolean;
  qcSummary: string;
  exportFolderError: string;
  exportPackError: string;
  exportPackHint: string;
  exportPackBusy: boolean;
  onOpenRunFolder: () => void;
  onExportRunTimingPack: () => void;
};

/**
 * Barre supérieure : navigation, aide, boucle A–B, export (transport média → PlayerMediaTransport).
 */
export function PlayerTopBar({
  onBack,
  runLabel,
  runDir,
  mediaPath,
  shortcutsHelpOpen,
  onToggleShortcutsHelp,
  loopHint,
  onMarkLoopA,
  onMarkLoopB,
  onClearLoop,
  loopAsec,
  loopBsec,
  transportDisabled,
  qcSummary,
  exportFolderError,
  exportPackError,
  exportPackHint,
  exportPackBusy,
  onOpenRunFolder,
  onExportRunTimingPack,
}: PlayerTopBarProps) {
  return (
    <header className="player-topbar">
      <div className="player-topbar-left">
        <button type="button" className="ghost" onClick={onBack}>
          ← Retour
        </button>
        <span className="player-run-label mono" title={runDir ?? ""}>
          {runLabel}
        </span>
        {mediaPath ? (
          <span className="player-media-hint small mono" title={mediaPath}>
            {fileBasename(mediaPath)}
          </span>
        ) : null}
        <button
          type="button"
          className="ghost small"
          onClick={onToggleShortcutsHelp}
          title="Raccourcis clavier (?)"
          aria-expanded={shortcutsHelpOpen}
          aria-controls="player-shortcuts-help-dialog"
        >
          Aide (?)
        </button>
      </div>
      <div className="player-topbar-right">
        <span className="player-loop-hint small mono" title="Boucle A–B">
          {loopHint}
        </span>
        <button
          type="button"
          className="ghost small"
          onClick={onMarkLoopA}
          disabled={transportDisabled}
        >
          Marquer A
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={onMarkLoopB}
          disabled={transportDisabled}
        >
          Marquer B
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={onClearLoop}
          disabled={transportDisabled || (!loopAsec && !loopBsec)}
        >
          Effacer boucle
        </button>
        <span className="player-qc-badge small" title="Heuristiques fenêtre + manifest">
          QC : {qcSummary}
        </span>
        <button
          type="button"
          className="ghost"
          disabled={!runDir}
          title="Ouvre le dossier du run (⌃⇧O / ⌘⇧O)"
          onClick={() => void onOpenRunFolder()}
        >
          Dossier run
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!runDir || exportPackBusy}
          title="JSON + SRT + CSV (⌃⇧E / ⌘⇧E) — comme l’Explorer"
          onClick={() => void onExportRunTimingPack()}
        >
          {exportPackBusy ? "Export…" : "Export pack timing"}
        </button>
        {exportFolderError ? (
          <span className="player-export-error small" role="alert">
            {exportFolderError}
          </span>
        ) : null}
        {exportPackError ? (
          <span className="player-export-error small" role="alert">
            {exportPackError}
          </span>
        ) : null}
        {exportPackHint ? (
          <span className="player-export-hint small mono" title={exportPackHint}>
            {exportPackHint.length > 96 ? `${exportPackHint.slice(0, 96)}…` : exportPackHint}
          </span>
        ) : null}
      </div>
    </header>
  );
}
