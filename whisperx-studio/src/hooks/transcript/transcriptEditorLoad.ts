import { areEditorSnapshotsEqual, buildEditorSnapshot } from "../../appUtils";
import type { EditorSnapshot } from "../../types";
import { tauriLoadTranscriptDocument, tauriLoadTranscriptDraft } from "./transcriptEditorTauri";

export type LoadedTranscriptPayload = {
  docPath: string;
  sourceSnapshot: EditorSnapshot;
  loadedSnapshot: EditorSnapshot;
  recoveredFromDraft: boolean;
  /** Présent si un fichier brouillon existe — le caller appelle `markDraftLoadedFromDisk` avec ces champs. */
  draftOnDisk: {
    draftPath: string;
    updatedAtMs: number;
    draftSnapshot: EditorSnapshot;
  } | null;
};

/**
 * Charge le document + brouillon éventuel, gère la confirmation de recovery.
 * Ne touche pas à l’état React — à utiliser depuis `useTranscriptEditor`.
 */
export async function loadTranscriptFromPath(path: string): Promise<LoadedTranscriptPayload> {
  const doc = await tauriLoadTranscriptDocument(path);
  const sourceSnapshot = buildEditorSnapshot(doc.language ?? "", doc.segments);
  let loadedSnapshot = sourceSnapshot;
  let recoveredFromDraft = false;

  const maybeDraft = await tauriLoadTranscriptDraft(doc.path);
  let draftOnDisk: LoadedTranscriptPayload["draftOnDisk"] = null;

  if (maybeDraft) {
    const draftSnapshot = buildEditorSnapshot(maybeDraft.language ?? "", maybeDraft.segments);
    draftOnDisk = {
      draftPath: maybeDraft.draftPath,
      updatedAtMs: maybeDraft.updatedAtMs,
      draftSnapshot,
    };

    if (!areEditorSnapshotsEqual(sourceSnapshot, draftSnapshot)) {
      const shouldRecover = window.confirm(
        `Un brouillon autosauve existe (${new Date(maybeDraft.updatedAtMs).toLocaleString()}). Restaurer ce brouillon ?`,
      );
      if (shouldRecover) {
        loadedSnapshot = draftSnapshot;
        recoveredFromDraft = true;
      }
    }
  }

  return {
    docPath: doc.path,
    sourceSnapshot,
    loadedSnapshot,
    recoveredFromDraft,
    draftOnDisk,
  };
}
