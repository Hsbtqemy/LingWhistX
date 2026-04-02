import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { StudioView } from "../types";

type ShortcutEntry = { keys: string; description: string };

const GLOBAL_SHORTCUTS: ShortcutEntry[] = [
  { keys: "?", description: "Ouvrir / fermer cette aide" },
];

const PLAYER_SHORTCUTS: ShortcutEntry[] = [
  { keys: "Espace / K", description: "Lecture / pause" },
  { keys: "Home", description: "Stop — retour au début" },
  { keys: "Fin", description: "Aller à la fin du média" },
  { keys: "← / →", description: "±1 s" },
  { keys: "Shift + ← / →", description: "±5 s" },
  { keys: "Alt + ← / →", description: "±0,1 s" },
  { keys: "J", description: "Reculer de 10 s" },
  { keys: "+ / −", description: "Ajuster la vitesse (±0,25×)" },
  { keys: "F", description: "Activer / désactiver le suivi du playhead" },
  { keys: "W", description: "Activer / désactiver la fenêtre mots" },
  { keys: "L", description: "Boucle A → B → effacer" },
  { keys: "M", description: "Couper / rétablir le son" },
  { keys: "[ / ]", description: "Segment précédent / suivant" },
  { keys: "N / P", description: "Alerte suivante / précédente" },
  { keys: "0", description: "Annuler le solo locuteur" },
  { keys: "1–9", description: "Solo locuteur N" },
  {
    keys: "⌃/⌘ + 1–7",
    description: "Changer de vue (Lanes, Chat, Mots, Colonnes, Rythmo, Karaoké, Stats)",
  },
  { keys: "F11 / ⌘⇧F", description: "Plein écran immersif" },
  { keys: "Alt + Entrée", description: "Plein écran vidéo" },
  { keys: "⌃/⌘ + ⇧ + C", description: "Copier le timecode" },
  { keys: "⌃/⌘ + ⇧ + O", description: "Ouvrir le dossier du run" },
  { keys: "⌃/⌘ + ⇧ + E", description: "Exporter le timing pack" },
];

const FULLSCREEN_SHORTCUTS: ShortcutEntry[] = [
  { keys: "Échap / F11", description: "Quitter le plein écran" },
  { keys: "⌘⇧F", description: "Quitter le plein écran" },
  { keys: "Espace / K", description: "Lecture / pause" },
  { keys: "J", description: "Reculer de 10 s" },
  { keys: "← / →", description: "±1 s (Shift ±5 s, Alt ±0,1 s)" },
  { keys: "+ / −", description: "Ajuster la vitesse" },
  { keys: "F", description: "Suivi du playhead" },
  { keys: "M", description: "Couper / rétablir le son" },
  { keys: "⌃/⌘ + 1–7", description: "Changer de vue" },
  { keys: "0–9", description: "Solo locuteur" },
];

const EDITOR_SHORTCUTS: ShortcutEntry[] = [
  { keys: "Alt + Z", description: "Annuler (undo)" },
  { keys: "Alt + ⇧ + Z", description: "Rétablir (redo)" },
  { keys: "Alt + S", description: "Sauvegarder le transcript" },
  { keys: "Alt + ⇧ + J", description: "Segment précédent (focus)" },
  { keys: "Alt + ⇧ + L", description: "Segment suivant (focus)" },
  { keys: "Alt + J", description: "Seek média −1 s" },
  { keys: "Alt + L", description: "Seek média +1 s" },
  { keys: "Alt + K", description: "Lecture / pause média" },
];

const WORKSPACE_TIPS: string[] = [
  "Glissez-déposez un fichier audio ou vidéo pour créer un nouveau job.",
  "Les runs terminés s'ouvrent automatiquement dans le Player.",
  "Utilisez l'explorateur de runs pour naviguer dans vos transcriptions passées.",
];

const PLAYER_TIPS: string[] = [
  "Le champ « Aller au temps » (panneau gauche) accepte les formats mm:ss, hh:mm:ss et les secondes.",
  "Double-cliquez sur le timecode pour le copier dans le presse-papiers.",
  "En plein écran, les contrôles se masquent après 3 secondes d'inactivité — bougez la souris pour les réafficher.",
];

function ShortcutTable({ title, entries }: { title: string; entries: ShortcutEntry[] }) {
  return (
    <section className="help-section">
      <h3 className="help-section-title">{title}</h3>
      <div className="help-shortcut-grid">
        {entries.map((e, i) => (
          <div key={i} className="help-shortcut-row">
            <kbd className="help-kbd">{e.keys}</kbd>
            <span className="help-desc">{e.description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TipsList({ title, tips }: { title: string; tips: string[] }) {
  return (
    <section className="help-section">
      <h3 className="help-section-title">{title}</h3>
      <ul className="help-tips-list">
        {tips.map((tip, i) => (
          <li key={i}>{tip}</li>
        ))}
      </ul>
    </section>
  );
}

export type HelpDialogProps = {
  open: boolean;
  onClose: () => void;
  activeView: StudioView;
};

export function HelpDialog({ open, onClose, activeView }: HelpDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const btn = panelRef.current?.querySelector("button");
    btn?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  const viewLabel =
    activeView === "player"
      ? "Player"
      : activeView === "editor"
        ? "Éditeur"
        : activeView === "settings"
          ? "Paramètres"
          : "Import";

  return createPortal(
    <div className="help-overlay" onClick={onClose} onKeyDown={onKeyDown} role="presentation">
      <div
        ref={panelRef}
        className="help-panel"
        data-testid="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Aide et raccourcis"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="help-header">
          <h2 className="help-title">Aide — {viewLabel}</h2>
          <button type="button" className="help-close-btn" onClick={onClose} title="Fermer (Échap)">
            ✕
          </button>
        </header>

        <div className="help-body">
          <ShortcutTable title="Raccourcis globaux" entries={GLOBAL_SHORTCUTS} />

          {activeView === "player" && (
            <>
              <ShortcutTable title="Raccourcis Player" entries={PLAYER_SHORTCUTS} />
              <ShortcutTable title="Raccourcis Plein écran" entries={FULLSCREEN_SHORTCUTS} />
              <ShortcutTable
                title="Raccourcis Éditeur (mode correction)"
                entries={EDITOR_SHORTCUTS}
              />
              <TipsList title="Astuces Player" tips={PLAYER_TIPS} />
            </>
          )}

          {activeView === "import" && (
            <>
              <ShortcutTable
                title="Raccourcis Éditeur (panneau transcript)"
                entries={EDITOR_SHORTCUTS}
              />
              <TipsList title="Astuces Import" tips={WORKSPACE_TIPS} />
              <TipsList
                title="Historique jobs"
                tips={[
                  "Les jobs terminés apparaissent avec leur durée de traitement.",
                  "Cliquez sur un job pour voir ses détails et ouvrir le résultat dans le Player.",
                ]}
              />
            </>
          )}

          {activeView === "editor" && (
            <TipsList title="Éditeur" tips={["L'éditeur inline sera disponible dans WX-729."]} />
          )}

          {activeView === "settings" && (
            <TipsList
              title="Paramètres"
              tips={[
                "Configurez les chemins vers FFmpeg et le modèle WhisperX.",
                "Les diagnostics système s'affichent ici.",
              ]}
            />
          )}
        </div>

        <footer className="help-footer">
          <span className="help-footer-hint small">
            <kbd>?</kbd> ouvre / ferme cette aide · <kbd>Échap</kbd> ferme
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
