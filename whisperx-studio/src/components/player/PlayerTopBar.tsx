import { fileBasename } from "../../appUtils";

export type PlayerTopBarProps = {
  onBack: () => void;
  runLabel: string;
  runDir: string | null;
  mediaPath: string | null;
  shortcutsHelpOpen: boolean;
  onToggleShortcutsHelp: () => void;
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
    </header>
  );
}
