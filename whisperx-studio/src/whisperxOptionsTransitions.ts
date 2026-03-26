import { startTransition } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { UiWhisperxOptions } from "./types";

/**
 * Mise à jour partielle des options WhisperX en transition (non bloquante pour l’UI).
 * À utiliser pour &lt;select&gt; et cases à cocher ; pas pour la saisie texte en direct.
 */
export function setWhisperxOptionsDeferred(
  set: Dispatch<SetStateAction<UiWhisperxOptions>>,
  partial: Partial<UiWhisperxOptions>,
): void {
  startTransition(() => {
    set((prev) => ({ ...prev, ...partial }));
  });
}

/** Toute mise à jour d’état locale lourde (sélecteurs, cases) hors options WhisperX. */
export function runInTransition(fn: () => void): void {
  startTransition(fn);
}
