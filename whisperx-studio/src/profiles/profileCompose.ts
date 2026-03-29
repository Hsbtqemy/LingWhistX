/**
 * WX-656 — composition de profils partiels.
 *
 * Un `ProfilePreset` stocke uniquement les champs qui diffèrent des défauts (`Partial<UiWhisperxOptions>`).
 * `applyProfileOverrides` fusionne ces surcharges avec `defaultWhisperxOptions` pour produire les options
 * complètes utilisées par le formulaire.
 *
 * `computeDirtyFields` calcule les champs que l'utilisateur a modifiés depuis l'application du preset,
 * en comparant les options courantes aux options de base (défaut + surcharges du preset actif).
 */

import { defaultWhisperxOptions } from "../constants";
import type { ProfilePreset, UiWhisperxOptions } from "../types";

/**
 * Retourne les options complètes : `defaultWhisperxOptions` + surcharges du profil.
 * `hfToken` est toujours fourni par l'appelant (il n'est jamais stocké dans un preset).
 */
export function applyProfileOverrides(
  overrides: Partial<UiWhisperxOptions>,
  hfToken: string = defaultWhisperxOptions.hfToken,
): UiWhisperxOptions {
  return { ...defaultWhisperxOptions, ...overrides, hfToken };
}

/**
 * Retourne l'ensemble des clés de `UiWhisperxOptions` dont la valeur courante diffère
 * des options de base (défaut + surcharges du preset actif).
 * `hfToken` est toujours exclu (géré séparément).
 */
export function computeDirtyFields(
  current: UiWhisperxOptions,
  activePreset: ProfilePreset | null | undefined,
): ReadonlySet<keyof UiWhisperxOptions> {
  const base: UiWhisperxOptions = applyProfileOverrides(activePreset?.overrides ?? {});
  const dirty = new Set<keyof UiWhisperxOptions>();
  for (const key of Object.keys(current) as (keyof UiWhisperxOptions)[]) {
    if (key === "hfToken") continue;
    if (current[key] !== base[key]) {
      dirty.add(key);
    }
  }
  return dirty;
}

/**
 * Calcule les surcharges partielles représentant les champs qui diffèrent de `defaultWhisperxOptions`.
 * Utilisé pour sauvegarder la configuration courante comme nouveau profil (ne stocke que le delta).
 */
export function extractProfileOverrides(
  current: UiWhisperxOptions,
): Partial<UiWhisperxOptions> {
  const overrides: Partial<UiWhisperxOptions> = {};
  for (const key of Object.keys(current) as (keyof UiWhisperxOptions)[]) {
    if (key === "hfToken") continue;
    if (current[key] !== defaultWhisperxOptions[key]) {
      // TypeScript can't infer this index assignment directly — use type assertion.
      (overrides as Record<string, unknown>)[key] = current[key];
    }
  }
  return overrides;
}
