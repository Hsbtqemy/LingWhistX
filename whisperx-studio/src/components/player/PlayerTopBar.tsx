import { fileBasename } from "../../appUtils";

export type PlayerTopBarProps = {
  onBack: () => void;
  runLabel: string;
  runDir: string | null;
  mediaPath: string | null;
  shortcutsHelpOpen: boolean;
  onToggleShortcutsHelp: () => void;
  onToggleFullscreen?: () => void;
  fullscreenMode?: boolean;
};

/**
 * Barre supérieure minimale : navigation + contexte run + aide.
 * Boucle A-B → minimap/waveform ; QC/export → panneau droit.
 */
export function PlayerTopBar({
  onBack,
  runLabel,
  runDir,
  mediaPath,
  shortcutsHelpOpen,
  onToggleShortcutsHelp,
  onToggleFullscreen,
  fullscreenMode,
}: PlayerTopBarProps) {
  return (
    <header className="player-topbar">
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
      <div className="player-topbar-actions">
        {onToggleFullscreen ? (
          <button
            type="button"
            className="ghost small"
            onClick={onToggleFullscreen}
            title="Plein écran (F11 / ⌘⇧F)"
          >
            {fullscreenMode ? "⊡ Quitter" : "⊞ Plein écran"}
          </button>
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
    </header>
  );
}
