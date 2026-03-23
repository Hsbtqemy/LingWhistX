import { DEFAULT_KEYBOARD_SEEK_SEC } from "../../constants";
import type { WaveformWorkspace } from "../useWaveformWorkspace";

export type AttachTranscriptEditorKeyboardArgs = {
  editorSourcePath: string;
  selectedJobId: string;
  wf: WaveformWorkspace;
  undoEditorChange: () => void;
  redoEditorChange: () => void;
  focusRelativeSegment: (delta: -1 | 1) => void;
};

/**
 * Abonne les raccourcis clavier (undo/redo dans le panneau editeur, Alt+J/L, media J/K/L).
 * `getArgs` est appele a chaque touche pour lire l’etat courant sans rebinder le listener.
 * Retourne une fonction de nettoyage.
 */
export function attachTranscriptEditorKeyboard(
  getArgs: () => AttachTranscriptEditorKeyboardArgs,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const args = getArgs();
    if (event.defaultPrevented) {
      return;
    }
    const key = event.key.toLowerCase();

    if (args.editorSourcePath && (event.ctrlKey || event.metaKey)) {
      const target = event.target instanceof Element ? event.target : null;
      const insideEditor = Boolean(target?.closest(".editor-panel"));
      if (insideEditor && key === "z" && !event.shiftKey) {
        event.preventDefault();
        args.undoEditorChange();
        return;
      }
      if (insideEditor && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        args.redoEditorChange();
        return;
      }
    }

    if (event.ctrlKey || event.metaKey || !event.altKey) {
      return;
    }

    if (event.shiftKey && key === "j") {
      event.preventDefault();
      args.focusRelativeSegment(-1);
      return;
    }
    if (event.shiftKey && key === "l") {
      event.preventDefault();
      args.focusRelativeSegment(1);
      return;
    }

    if (!args.selectedJobId) {
      return;
    }

    if (key === "j") {
      event.preventDefault();
      args.wf.seekMedia(args.wf.mediaCurrentSec - DEFAULT_KEYBOARD_SEEK_SEC);
      return;
    }
    if (key === "l") {
      event.preventDefault();
      args.wf.seekMedia(args.wf.mediaCurrentSec + DEFAULT_KEYBOARD_SEEK_SEC);
      return;
    }
    if (key === "k") {
      event.preventDefault();
      void args.wf.toggleMediaPlayback();
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
