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

export type StudioNavProps = {
  activeView: StudioView;
  onViewChange: (view: StudioView) => void;
  editorFocusMode: boolean;
  onExitEditorFocus: () => void;
};

export function StudioNav({
  activeView,
  onViewChange,
  editorFocusMode,
  onExitEditorFocus,
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
        Accueil
      </Button>
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
        Studio
      </Button>
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
        Player
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
        À propos & diagnostic
      </Button>
    </nav>
  );
}
