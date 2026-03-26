import type { SessionRestorePrompt } from "../types";

export type SessionRestoreBannerProps = {
  prompt: SessionRestorePrompt | null;
  onRestore: () => void;
  onDismiss: () => void;
};

/**
 * Proposition au lancement : rouvrir le dernier job consulté (persisté dans localStorage).
 */
export function SessionRestoreBanner({ prompt, onRestore, onDismiss }: SessionRestoreBannerProps) {
  if (!prompt) {
    return null;
  }

  return (
    <div
      className="session-restore-banner"
      role="region"
      aria-label="Restauration de session"
    >
      <p className="session-restore-banner__text">
        Restaurer la session précédente ? Fichier : <strong>{prompt.label}</strong>
      </p>
      <div className="session-restore-banner__actions">
        <button className="ghost inline" type="button" onClick={onRestore}>
          Restaurer
        </button>
        <button className="ghost inline" type="button" onClick={onDismiss}>
          Ignorer
        </button>
      </div>
    </div>
  );
}
