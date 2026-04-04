import React from "react";
import type { StudioView } from "../types";
import { Button } from "./ui";

export const STUDIO_TAB_IDS: Record<StudioView, string> = {
  hub: "studio-tab-hub",
  import: "studio-tab-import",
  editor: "studio-tab-editor",
  player: "studio-tab-player",
  settings: "studio-tab-settings",
};

export const STUDIO_PANEL_IDS: Record<StudioView, string> = {
  hub: "studio-panel-hub",
  import: "studio-panel-import",
  editor: "studio-panel-editor",
  player: "studio-panel-player",
  settings: "studio-panel-settings",
};

const navIconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function IconImport() {
  return (
    <svg {...navIconProps}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconEditor() {
  return (
    <svg {...navIconProps}>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconPlayer() {
  return (
    <svg {...navIconProps}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg {...navIconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

export type StudioNavProps = {
  activeView: StudioView;
  onViewChange: (view: StudioView) => void;
  /** Au moins un job `queued` ou `running` — pastille sur l'onglet Import. */
  workspaceHasActiveJobs?: boolean;
  onToggleHelp?: () => void;
  onOpenLibrary?: () => void;
  libraryOpen?: boolean;
  /** Clic sur la marque « LingWhistX » — retour à la vue hub (cartes), depuis n’importe quel onglet. */
  onBrandClick?: () => void;
};

const TABS: { view: StudioView; label: string; Icon: () => React.ReactElement | null }[] = [
  { view: "import", label: "Import", Icon: IconImport },
  { view: "editor", label: "Éditeur", Icon: IconEditor },
  { view: "player", label: "Player", Icon: IconPlayer },
];

function IconLibrary() {
  return (
    <svg {...navIconProps}>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

export function StudioNav({
  activeView,
  onViewChange,
  workspaceHasActiveJobs = false,
  onToggleHelp,
  onOpenLibrary,
  libraryOpen = false,
  onBrandClick,
}: StudioNavProps) {
  return (
    <nav className="studio-nav studio-nav--topbar" aria-label="Studio LingWhistX">
      <div className="studio-nav-brand">
        <button
          type="button"
          className="studio-nav-brand__btn"
          onClick={onBrandClick}
          title="Hub d’accueil — Transcrire, Annoter, Analyser"
          aria-label="Accueil LingWhistX — afficher le hub"
        >
          <span className="studio-nav-brand__name">LingWhistX</span>
        </button>
      </div>
      <div className="studio-nav-tabs" role="tablist" aria-label="Sections du studio">
        {TABS.map(({ view, label, Icon }) => {
          const isImport = view === "import";
          const tab = (
            <Button
              id={STUDIO_TAB_IDS[view]}
              variant="navTab"
              type="button"
              role="tab"
              aria-selected={activeView === view}
              aria-controls={STUDIO_PANEL_IDS[view]}
              active={activeView === view}
              onClick={() => onViewChange(view)}
            >
              <span className="studio-nav-tab-inner">
                <Icon />
                <span className="studio-nav-tab__title">{label}</span>
              </span>
            </Button>
          );

          if (isImport) {
            return (
              <div
                key={view}
                className={`studio-nav-tab-slot${workspaceHasActiveJobs ? " studio-nav-tab-slot--live" : ""}`}
              >
                {tab}
                {workspaceHasActiveJobs ? (
                  <span className="studio-nav-activity-dot" title="Traitement en cours" />
                ) : null}
              </div>
            );
          }
          return (
            <div key={view} className="studio-nav-tab-slot">
              {tab}
            </div>
          );
        })}
      </div>
      <div className="studio-nav-actions">
        {onOpenLibrary ? (
          <button
            type="button"
            className="studio-nav-library-btn"
            onClick={onOpenLibrary}
            aria-pressed={libraryOpen}
            title="Bibliothèque de runs"
            aria-label="Bibliothèque de runs"
          >
            <IconLibrary />
          </button>
        ) : null}
        <button
          type="button"
          className="studio-nav-settings-btn"
          onClick={() => onViewChange(activeView === "settings" ? "import" : "settings")}
          aria-pressed={activeView === "settings"}
          title="Paramètres (⚙)"
          aria-label="Paramètres"
        >
          <IconSettings />
        </button>
        {onToggleHelp ? (
          <button
            type="button"
            className="studio-nav-help-btn"
            onClick={onToggleHelp}
            title="Aide et raccourcis (?)"
            aria-label="Aide"
          >
            ?
          </button>
        ) : null}
      </div>
    </nav>
  );
}
