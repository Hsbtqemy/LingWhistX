/** Garde-fous et enveloppe d’état « sauvegarde / export » communs à l’éditeur de transcript. */

export const TRANSCRIPT_EDITOR_NOT_LOADED_ERROR =
  "Aucun transcript charge dans l'editeur.";

export function isTranscriptEditorReadyForIo(
  sourcePath: string,
  segmentsLength: number,
): boolean {
  return Boolean(sourcePath && segmentsLength > 0);
}

export async function runWithEditorSavingFlag<T>(
  setIsEditorSaving: (loading: boolean) => void,
  fn: () => Promise<T>,
): Promise<T> {
  setIsEditorSaving(true);
  try {
    return await fn();
  } finally {
    setIsEditorSaving(false);
  }
}
