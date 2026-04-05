import { memo } from "react";

export type EditorFileToolbarProps = {
  editorSourcePath: string;
  editorLanguage: string;
  editorDirty: boolean;
  isEditorSaving: boolean;
  isEditorLoading: boolean;
  updateEditorLanguage: (lang: string) => void;
  saveEditedJson: (overwrite: boolean) => void;
  onOpenPlayer: () => void;
};

/** Fichier, Player, langue, sauvegarde — au-dessus de la waveform (WX-729). */
export const EditorFileToolbar = memo(function EditorFileToolbar({
  editorSourcePath,
  editorLanguage,
  editorDirty,
  isEditorSaving,
  isEditorLoading,
  updateEditorLanguage,
  saveEditedJson,
  onOpenPlayer,
}: EditorFileToolbarProps) {
  const busy = isEditorLoading || isEditorSaving;

  return (
    <div
      className="editor-file-toolbar"
      role="region"
      aria-label="Fichier transcript et sauvegarde"
    >
      <div className="editor-toolbar__section editor-toolbar__section--file">
        <span className="editor-toolbar__section-label" id="editor-toolbar-sec-file">
          Fichier
        </span>
        <div
          className="editor-toolbar__row editor-toolbar__row--section editor-toolbar__row--file"
          aria-labelledby="editor-toolbar-sec-file"
        >
          <div className="editor-toolbar__file-cluster">
            <button
              type="button"
              className="ghost small"
              onClick={onOpenPlayer}
              title="Ouvrir dans le Player"
            >
              ▶ Player
            </button>
            <span className="editor-toolbar__sep" aria-hidden />
            <label className="editor-toolbar__lang-label small" htmlFor="editor-toolbar-lang">
              Langue
            </label>
            <input
              id="editor-toolbar-lang"
              type="text"
              className="editor-toolbar__lang-input"
              value={editorLanguage}
              onChange={(e) => updateEditorLanguage(e.target.value)}
              placeholder="fr"
              maxLength={10}
              aria-label="Code langue"
            />
          </div>
          <div className="editor-toolbar__file-cluster editor-toolbar__file-cluster--actions">
            <button
              type="button"
              className="primary small"
              disabled={busy || !editorSourcePath}
              onClick={() => saveEditedJson(false)}
              title="Sauvegarder JSON (Alt+S)"
              aria-label="Sauvegarder"
            >
              {isEditorSaving ? "…" : "💾 Sauv."}
              {editorDirty && !isEditorSaving ? "*" : ""}
            </button>
            <button
              type="button"
              className="ghost small"
              disabled={busy || !editorSourcePath}
              onClick={() => saveEditedJson(true)}
              title="Écraser le fichier source"
              aria-label="Écraser source"
            >
              Écraser
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
