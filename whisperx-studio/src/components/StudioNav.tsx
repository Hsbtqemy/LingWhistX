import type { StudioView } from "../types";
import { Badge, Button } from "./ui";

/** Préfixe ids DOM — panneaux dans App.tsx (`studio-panel-*`). Vue « create » : libellé « Accueil » (UI shell colonne gauche). Workspace : « Studio » (WX-637, `docs/workspace-tab-label.md`). */
export const STUDIO_TAB_IDS: Record<StudioView, string> = {
  create: "studio-tab-create",
  workspace: "studio-tab-workspace",
  player: "studio-tab-player",
  about: "studio-tab-about",
};

export const STUDIO_PANEL_IDS: Record<StudioView, string> = {
  create: "studio-panel-create",
  workspace: "studio-panel-workspace",
  player: "studio-panel-player",
  about: "studio-panel-about",
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

function NavIconHome() {
  return (
    <svg {...navIconProps}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function NavIconStudio() {
  return (
    <svg {...navIconProps}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function NavIconPlayer() {
  return (
    <svg {...navIconProps}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function NavIconAbout() {
  return (
    <svg {...navIconProps}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export type StudioNavProps = {
  activeView: StudioView;
  onViewChange: (view: StudioView) => void;
  editorFocusMode: boolean;
  onExitEditorFocus: () => void;
  /** Au moins un job `queued` ou `running` — pastille sur l’onglet Studio. */
  workspaceHasActiveJobs?: boolean;
};

export function StudioNav({
  activeView,
  onViewChange,
  editorFocusMode,
  onExitEditorFocus,
  workspaceHasActiveJobs = false,
}: StudioNavProps) {
  if (editorFocusMode) {
    return (
      <nav className="studio-nav studio-nav--focus" aria-label="Navigation mode focus">
        <span className="studio-nav-focus-row">
          <Badge tone="neutral">Focus</Badge>
          <span className="studio-nav-focus-hint">
            Mode focus éditeur — davantage d&apos;espace pour le transcript et la waveform
          </span>
        </span>
        <Button variant="ghost" type="button" onClick={onExitEditorFocus}>
          Quitter le mode focus
        </Button>
      </nav>
    );
  }

  return (
    <nav className="studio-nav studio-nav--sidebar" role="tablist" aria-label="Sections du studio">
      <Button
        id={STUDIO_TAB_IDS.create}
        variant="navTab"
        type="button"
        role="tab"
        aria-selected={activeView === "create"}
        aria-controls={STUDIO_PANEL_IDS.create}
        active={activeView === "create"}
        onClick={() => onViewChange("create")}
      >
        <span className="studio-nav-tab-inner">
          <NavIconHome />
          <span>Accueil</span>
        </span>
      </Button>
      <div
        className={`studio-nav-tab-slot${workspaceHasActiveJobs ? " studio-nav-tab-slot--live" : ""}`}
      >
        <Button
          id={STUDIO_TAB_IDS.workspace}
          variant="navTab"
          type="button"
          role="tab"
          aria-selected={activeView === "workspace"}
          aria-controls={STUDIO_PANEL_IDS.workspace}
          active={activeView === "workspace"}
          onClick={() => onViewChange("workspace")}
        >
          <span className="studio-nav-tab-inner">
            <NavIconStudio />
            <span>Studio</span>
          </span>
        </Button>
        {workspaceHasActiveJobs ? (
          <span className="studio-nav-activity-dot" title="Traitement en cours" />
        ) : null}
      </div>
      <Button
        id={STUDIO_TAB_IDS.player}
        variant="navTab"
        type="button"
        role="tab"
        aria-selected={activeView === "player"}
        aria-controls={STUDIO_PANEL_IDS.player}
        active={activeView === "player"}
        onClick={() => onViewChange("player")}
      >
        <span className="studio-nav-tab-inner">
          <NavIconPlayer />
          <span>Player</span>
        </span>
      </Button>
      <Button
        id={STUDIO_TAB_IDS.about}
        variant="navTab"
        type="button"
        role="tab"
        aria-selected={activeView === "about"}
        aria-controls={STUDIO_PANEL_IDS.about}
        active={activeView === "about"}
        onClick={() => onViewChange("about")}
      >
        <span className="studio-nav-tab-inner">
          <NavIconAbout />
          <span>À propos & diagnostic</span>
        </span>
      </Button>
    </nav>
  );
}
