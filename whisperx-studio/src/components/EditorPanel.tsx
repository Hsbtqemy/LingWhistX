import type { StudioView } from "../types";
import { EditorWorkspaceSection } from "./editor/EditorWorkspaceSection";

export type ActiveRun = {
  runDir: string;
  label: string;
};

export type EditorPanelProps = {
  activeRun: ActiveRun | null;
  onOpenPlayer: () => void;
  onNavigate: (view: StudioView) => void;
};

export function EditorPanel({ activeRun, onOpenPlayer, onNavigate }: EditorPanelProps) {
  if (!activeRun) {
    return (
      <div className="editor-panel-shell">
        <div className="editor-panel-empty">
          <p className="small">Aucun run sélectionné.</p>
          <button type="button" className="ghost small" onClick={() => onNavigate("import")}>
            Aller à Import →
          </button>
        </div>
      </div>
    );
  }

  return <EditorWorkspaceSection activeRun={activeRun} onOpenPlayer={onOpenPlayer} />;
}
