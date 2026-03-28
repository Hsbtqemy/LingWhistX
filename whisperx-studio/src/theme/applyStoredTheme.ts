/**
 * Clé localStorage — préférence thème explicite (`light` | `dark`) ; absent = système.
 * À garder aligné avec le script inline dans `index.html` (anti-flash avant chargement du bundle).
 */
export const LX_THEME_STORAGE_KEY = "lx-theme";

/** Émis après changement de thème (même onglet ou synchronisation depuis un autre onglet). */
export const LX_THEME_CHANGED_EVENT = "lx-theme-changed";

export type LxThemePreference = "light" | "dark" | "system";

export function notifyThemePreferenceChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LX_THEME_CHANGED_EVENT));
}

function syncDomFromPreference(pref: LxThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-lx-theme");
  } else {
    root.setAttribute("data-lx-theme", pref);
  }
}

/** Lit la préférence persistée ; `system` si absent ou invalide. */
export function readStoredThemePreference(): LxThemePreference {
  try {
    const raw = localStorage.getItem(LX_THEME_STORAGE_KEY)?.trim().toLowerCase();
    if (raw === "dark" || raw === "light") return raw;
    return "system";
  } catch {
    return "system";
  }
}

/**
 * Enregistre le thème et met à jour `data-lx-theme` sur `<html>`.
 * - `system` : supprime l’attribut (le CSS suit `prefers-color-scheme`)
 * - `light` | `dark` : force le thème correspondant
 */
export function setThemePreference(pref: LxThemePreference): void {
  try {
    if (pref === "system") {
      localStorage.removeItem(LX_THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(LX_THEME_STORAGE_KEY, pref);
    }
  } catch {
    /* lecture seule ou quota : on applique quand même au DOM */
  }
  syncDomFromPreference(pref);
  notifyThemePreferenceChanged();
}

/**
 * Applique `data-lx-theme` sur `<html>` avant le premier paint React.
 * - `light` | `dark` : forcé
 * - absent ou `system` : suit `prefers-color-scheme` (CSS uniquement)
 */
export function applyStoredTheme(): void {
  syncDomFromPreference(readStoredThemePreference());
}

let themeStorageSyncRegistered = false;

/**
 * Réaction à un `StorageEvent` (autre onglet) : réapplique le thème depuis `localStorage` et notifie
 * l’UI. Exposé pour les tests ; en prod, préférer {@link initThemeStorageSync}.
 */
export function applyThemeFromStorageEvent(e: StorageEvent): void {
  if (e.key !== null && e.key !== LX_THEME_STORAGE_KEY) return;
  applyStoredTheme();
  notifyThemePreferenceChanged();
}

/**
 * Écoute les mises à jour de `localStorage` depuis d’autres onglets / fenêtres (événement `storage`
 * non déclenché dans l’onglet qui écrit). Réapplique le thème sur `<html>` et émet
 * {@link LX_THEME_CHANGED_EVENT}.
 */
export function initThemeStorageSync(): void {
  if (typeof window === "undefined" || themeStorageSyncRegistered) return;
  themeStorageSyncRegistered = true;

  window.addEventListener("storage", applyThemeFromStorageEvent);
}
