import type { StudioView } from "../types";

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
        <span className="studio-nav-focus-hint">
          Mode focus éditeur — davantage d&apos;espace pour le transcript et la waveform
        </span>
        <button type="button" className="ghost" onClick={onExitEditorFocus}>
          Quitter le mode focus
        </button>
      </nav>
    );
  }

  return (
    <nav className="studio-nav" role="tablist" aria-label="Sections du studio">
      <button
        type="button"
        role="tab"
        aria-selected={activeView === "create"}
        className={`studio-nav-tab ${activeView === "create" ? "is-active" : ""}`}
        onClick={() => onViewChange("create")}
      >
        Créer un job
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeView === "workspace"}
        className={`studio-nav-tab ${activeView === "workspace" ? "is-active" : ""}`}
        onClick={() => onViewChange("workspace")}
      >
        Historique & run
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeView === "about"}
        className={`studio-nav-tab ${activeView === "about" ? "is-active" : ""}`}
        onClick={() => onViewChange("about")}
      >
        À propos & diagnostic
      </button>
    </nav>
  );
}
