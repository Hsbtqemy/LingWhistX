import { areEditorSnapshotsEqual } from "../../appUtils";
import type { EditorSnapshot } from "../../types";

/** Indique si l’éditeur est « sale » par rapport à une ligne de base (aucune sauvegarde encore = tout contenu non vide compte). */
export function computeEditorDirtyFromBaseline(
  snapshot: EditorSnapshot,
  baseline: EditorSnapshot | null,
): boolean {
  if (!baseline) {
    return snapshot.segments.length > 0 || snapshot.language.trim().length > 0;
  }
  return !areEditorSnapshotsEqual(snapshot, baseline);
}
