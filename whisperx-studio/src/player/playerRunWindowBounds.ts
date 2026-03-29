/**
 * Bornes de requête `query_run_events_window` pour le Player (WX-654).
 *
 * Budget cible côté Rust/SQLite : typiquement &lt; 30 ms pour une fenêtre indexée ;
 * le front évite les rafales (&gt; 10/s) via debounce + grille temporelle.
 */

/** Fenêtre « standard » (Lanes / Chat) — 60 s. */
export const PLAYER_WINDOW_TOTAL_MS = 60_000;

/** Fenêtre mots (détail) — 30 s. */
export const PLAYER_WINDOW_WORDS_MS = 30_000;

/**
 * Marge ±10 s sur chaque bord de la fenêtre logique pour limiter les re-fetch IPC
 * quand la tête bouge peu (buffer de requête, pas la grille d’affichage).
 */
export const PLAYER_WINDOW_QUERY_BUFFER_MS = 10_000;

/** Debounce avant `invoke` après changement de centre (50–100 ms, spec WX-654). */
export const PLAYER_RUN_WINDOW_DEBOUNCE_MS = 100;

/**
 * Intervalle minimal entre deux appels `query_run_events_window` (évite rafales &gt; 10/s).
 */
export const PLAYER_RUN_WINDOW_MIN_INTERVAL_MS = 100;

export type PlayerRunWindowBoundsPreset = "standard" | "words_detail" | "full_run";

/** Borne supérieure pour le preset "full_run" (24 h en ms). */
export const PLAYER_WINDOW_FULL_RUN_MAX_MS = 24 * 3600 * 1000;

/**
 * Calcule `[t0Ms, t1Ms)` pour la requête SQLite : fenêtre logique centrée + marge buffer.
 * `"full_run"` retourne toujours `[0, PLAYER_WINDOW_FULL_RUN_MAX_MS]`.
 */
export function computePlayerWindowQueryBounds(
  centerMs: number,
  preset: PlayerRunWindowBoundsPreset,
): { t0Ms: number; t1Ms: number } {
  if (preset === "full_run") {
    return { t0Ms: 0, t1Ms: PLAYER_WINDOW_FULL_RUN_MAX_MS };
  }
  const totalMs = preset === "words_detail" ? PLAYER_WINDOW_WORDS_MS : PLAYER_WINDOW_TOTAL_MS;
  const half = Math.floor(totalMs / 2);
  const b = PLAYER_WINDOW_QUERY_BUFFER_MS;
  const t0 = Math.max(0, centerMs - half - b);
  const t1 = centerMs + half + b;
  return { t0Ms: t0, t1Ms: t1 };
}
