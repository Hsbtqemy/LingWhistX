/** Émis après changement de préférences stockées (même onglet) pour synchroniser formulaire job / ondeforme. */
export const STUDIO_PREFS_CHANGED_EVENT = "lx-studio-prefs-changed";

const WEB_AUDIO_DEFAULT_KEY = "lx-studio-pref-web-audio-default";

export function notifyStudioPreferencesChanged(): void {
  try {
    window.dispatchEvent(new Event(STUDIO_PREFS_CHANGED_EVENT));
  } catch {
    /* SSR / tests */
  }
}

/**
 * Preview alignement : Web Audio activé par défaut (extrait WAV / effets).
 * Absence de clé = true (nouveaux profils).
 */
export function readWebAudioDefault(): boolean {
  try {
    const v = localStorage.getItem(WEB_AUDIO_DEFAULT_KEY);
    if (v === null) {
      return true;
    }
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export function writeWebAudioDefault(enabled: boolean): void {
  try {
    localStorage.setItem(WEB_AUDIO_DEFAULT_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
  notifyStudioPreferencesChanged();
}
