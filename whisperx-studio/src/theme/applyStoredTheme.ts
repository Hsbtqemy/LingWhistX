/**
 * Clé localStorage — préférence thème (`light` | `dark` | `system`) ; absent ou invalide = système.
 * Aligné avec le script inline dans `index.html` (anti-flash avant chargement du bundle).
 */
export const LX_THEME_STORAGE_KEY = "lx-theme";

/** Émis après changement de thème (même onglet ou synchronisation depuis un autre onglet). */
export const LX_THEME_CHANGED_EVENT = "lx-theme-changed";

export type LxThemePreference = "light" | "dark" | "system";

export function notifyThemePreferenceChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LX_THEME_CHANGED_EVENT));
}

const THEME_COLOR_META_ID = "lx-theme-color";

/**
 * Aligne la meta `theme-color` sur `--lx-surface-0` (tokens) pour la barre système / PWA.
 * À appeler après chargement des feuilles + à chaque changement de thème effectif.
 */
export function syncThemeColorMeta(): void {
  if (typeof document === "undefined") return;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--lx-surface-0").trim();
  if (!raw) return;
  let meta = document.getElementById(THEME_COLOR_META_ID);
  if (!(meta instanceof HTMLMetaElement)) {
    meta = document.createElement("meta");
    meta.id = THEME_COLOR_META_ID;
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", raw);
}

function syncDomFromPreference(pref: LxThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") {
    root.setAttribute("data-lx-theme", "system");
  } else {
    root.setAttribute("data-lx-theme", pref);
  }
}

/** Lit la préférence persistée ; `system` si absent ou invalide. */
export function readStoredThemePreference(): LxThemePreference {
  try {
    const raw = localStorage.getItem(LX_THEME_STORAGE_KEY)?.trim().toLowerCase();
    if (raw === "dark" || raw === "light" || raw === "system") return raw;
    return "system";
  } catch {
    return "system";
  }
}

/**
 * Enregistre le thème et met à jour `data-lx-theme` sur `<html>`.
 * - `system` : `data-lx-theme="system"` + le CSS suit `prefers-color-scheme` dans ce mode
 * - `light` | `dark` : forcé
 */
export function setThemePreference(pref: LxThemePreference): void {
  try {
    localStorage.setItem(LX_THEME_STORAGE_KEY, pref);
  } catch {
    /* lecture seule ou quota : on applique quand même au DOM */
  }
  syncDomFromPreference(pref);
  notifyThemePreferenceChanged();
}

/** Applique `data-lx-theme` sur `<html>` selon {@link readStoredThemePreference}. */
export function applyStoredTheme(): void {
  syncDomFromPreference(readStoredThemePreference());
  syncThemeColorMeta();
}

/**
 * Rendu effectif (clair / sombre) après application des tokens CSS.
 * Utile pour l’UI (libellé « actuellement ») et les tests.
 */
export function getEffectiveColorScheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-lx-theme");
  if (attr === "light") return "light";
  if (attr === "dark") return "dark";
  if (attr === "system" || attr == null) {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
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

let themeColorMetaListeners = false;

/** Écoute thème effectif (événement app + bascule OS en mode system) pour rafraîchir `theme-color`. */
export function initThemeColorMetaSync(): void {
  if (typeof window === "undefined" || themeColorMetaListeners) return;
  themeColorMetaListeners = true;
  const bump = () => syncThemeColorMeta();
  window.addEventListener(LX_THEME_CHANGED_EVENT, bump);
  if (typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", bump);
  }
}
