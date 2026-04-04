/** Garde-fous et enveloppe d’état « sauvegarde / export » communs à l’éditeur de transcript. */

export const TRANSCRIPT_EDITOR_NOT_LOADED_ERROR = "Aucun transcript chargé dans l'éditeur.";

/** Transcript ouvert (chemin connu), y compris 0 segment (run vide / audio seul). */
export function hasTranscriptSourcePath(sourcePath: string): boolean {
  return Boolean(sourcePath?.trim());
}

/** Prêt pour export SRT/VTT/etc. ou pack timing : il faut au moins un segment. */
export function isTranscriptEditorReadyForIo(sourcePath: string, segmentsLength: number): boolean {
  return hasTranscriptSourcePath(sourcePath) && segmentsLength > 0;
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
