import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QueryWindowResult } from "../types";
import { QUERY_WINDOW_DEFAULT_MAX } from "../types";
import {
  computePlayerWindowQueryBounds,
  PLAYER_RUN_WINDOW_DEBOUNCE_MS,
  PLAYER_RUN_WINDOW_MIN_INTERVAL_MS,
} from "../player/playerRunWindowBounds";
import type { ViewportQueryContract } from "../components/player/playerViewportContract";

/** Réexport — compat imports existants. */
export { PLAYER_WINDOW_TOTAL_MS, PLAYER_WINDOW_WORDS_MS } from "../player/playerRunWindowBounds";

/**
 * Grille temporelle pour déclencher `query_run_events_window` : ~4 requêtes/s max pendant la lecture
 * (pas d’IPC à 60 Hz — spec WX-624).
 */
export const PLAYER_WINDOW_COARSE_SEC = 0.25;

export type PlayerRunWindowQueryPreset = "standard" | "words_detail" | "full_run";

export type UsePlayerRunWindowOptions = {
  runDir: string | null;
  /** Temps courant en secondes (lecture ou pause). */
  centerTimeSec: number;
  /** Ex. manifest chargé et pas d’erreur bloquante. */
  enabled: boolean;
  /**
   * `standard` : 60s, sans words (Lanes/Chat).
   * `words_detail` : 30s + words avec plafond (aperçu mots).
   * Ignoré si `queryContract` est fourni.
   */
  queryPreset?: PlayerRunWindowQueryPreset;
  /**
   * WX-660 — contrat de vue : définit les tables requises et la fenêtre temporelle.
   * Prioritaire sur `queryPreset` quand fourni.
   */
  queryContract?: ViewportQueryContract;
  /** Filtre SQLite : un ou plusieurs `speaker` exacts ; `null` = tous. */
  speakersFilter?: string[] | null;
  /**
   * WX-696 — Incrémenter pour forcer un rechargement immédiat de la fenêtre
   * (ex. après écriture de turns annotation dans events.sqlite).
   */
  refreshEpoch?: number;
};

export type UsePlayerRunWindowResult = {
  loading: boolean;
  error: string | null;
  slice: QueryWindowResult | null;
  /** Bornes de la dernière requête réussie (ms). */
  lastT0Ms: number | null;
  lastT1Ms: number | null;
  /** Preset résolu (depuis le contrat ou le paramètre explicite). */
  queryPreset: PlayerRunWindowQueryPreset;
};

/**
 * Slices SQLite pour le Player : `query_run_events_window` avec couches adaptées par vue (WX-660).
 *
 * WX-654 : debounce 50–100 ms, marge buffer ±10 s sur la fenêtre logique, intervalle min entre IPC
 * pour rester sous ~10 requêtes/s en conditions normales.
 *
 * WX-660 : `queryContract` détermine les tables interrogées et la taille de fenêtre selon la vue
 * active — remplace le booléen `includeWords` hard-codé.
 */
export function usePlayerRunWindow({
  runDir,
  centerTimeSec,
  enabled,
  queryPreset = "standard",
  queryContract,
  speakersFilter = null,
  refreshEpoch = 0,
}: UsePlayerRunWindowOptions): UsePlayerRunWindowResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slice, setSlice] = useState<QueryWindowResult | null>(null);
  const [lastT0Ms, setLastT0Ms] = useState<number | null>(null);
  const [lastT1Ms, setLastT1Ms] = useState<number | null>(null);

  const centerRef = useRef(centerTimeSec);
  centerRef.current = centerTimeSec;

  const lastInvokeDoneAtRef = useRef(0);
  /**
   * Ref pour lire le contrat et le filtre au moment de l’IPC (après debounce) sans les
   * mettre dans les deps de l’effet. Les clés dérivées (`resolvedPreset`, `contractLayersKey`,
   * `speakersKey`) encodent le contenu effectif dans les deps.
   */
  const speakersFilterRef = useRef(speakersFilter);
  speakersFilterRef.current = speakersFilter;
  const queryContractRef = useRef(queryContract);
  queryContractRef.current = queryContract;

  // Preset résolu : le contrat est prioritaire sur le param explicite.
  const resolvedPreset: PlayerRunWindowQueryPreset = queryContract?.queryPreset ?? queryPreset;

  // Clé stable pour les layers du contrat (évite re-render si la référence change mais pas le contenu).
  const contractLayersKey = queryContract
    ? `${queryContract.layers.words ? 1 : 0}${queryContract.layers.turns ? 1 : 0}${queryContract.layers.pauses ? 1 : 0}${queryContract.layers.ipus ? 1 : 0}`
    : null;

  const coarseKey = Math.floor(centerTimeSec / PLAYER_WINDOW_COARSE_SEC) * PLAYER_WINDOW_COARSE_SEC;
  const speakersKey = speakersFilter && speakersFilter.length > 0 ? speakersFilter.join("|") : "";

  useEffect(() => {
    if (!runDir || !enabled) {
      setSlice(null);
      setError(null);
      setLastT0Ms(null);
      setLastT1Ms(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const t = window.setTimeout(() => {
      void (async () => {
        const now0 = Date.now();
        const waitMin = Math.max(
          0,
          PLAYER_RUN_WINDOW_MIN_INTERVAL_MS - (now0 - lastInvokeDoneAtRef.current),
        );
        await new Promise((r) => setTimeout(r, waitMin));
        if (cancelled) {
          return;
        }

        const contract = queryContractRef.current;
        const preset = contract?.queryPreset ?? queryPreset;
        // WX-660 : tables issues du contrat ; fallback sur le comportement historique.
        const layers = contract?.layers ?? {
          words: preset === "words_detail",
          turns: true,
          pauses: true,
          ipus: true,
        };

        const centerMs = Math.round(centerRef.current * 1000);
        const { t0Ms, t1Ms } = computePlayerWindowQueryBounds(centerMs, preset);

        try {
          const f = speakersFilterRef.current;
          const speakers = f && f.length > 0 ? f : [];
          const r = await invoke<QueryWindowResult>("query_run_events_window", {
            request: {
              runDir,
              t0Ms,
              t1Ms,
              layers,
              speakers,
              // Plafonds alignés sur `QueryWindowLimits` côté Rust (WX-613) — ne pas caper words à 2000 :
              // une fenêtre dense pouvait tronquer mots + IPU et laisser des tours sans texte (… partout).
              limits: layers.words
                ? {
                    maxWords: QUERY_WINDOW_DEFAULT_MAX.words,
                    maxTurns: QUERY_WINDOW_DEFAULT_MAX.turns,
                    maxPauses: QUERY_WINDOW_DEFAULT_MAX.pauses,
                    maxIpus: QUERY_WINDOW_DEFAULT_MAX.ipus,
                  }
                : undefined,
            },
          });
          lastInvokeDoneAtRef.current = Date.now();
          if (!cancelled) {
            setSlice(r);
            setLastT0Ms(r.t0Ms);
            setLastT1Ms(r.t1Ms);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) {
            setSlice(null);
            setLastT0Ms(null);
            setLastT1Ms(null);
            setError(String(e));
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, PLAYER_RUN_WINDOW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setLoading(false);
    };
    // contractLayersKey encode le contenu des layers ; resolvedPreset encode le preset résolu.
    // refreshEpoch force un rechargement immédiat quand il est incrémenté (WX-696).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryContract / centerTime via refs ; deps = clés dérivées + refreshEpoch
  }, [runDir, enabled, coarseKey, resolvedPreset, contractLayersKey, speakersKey, refreshEpoch]);

  return { loading, error, slice, lastT0Ms, lastT1Ms, queryPreset: resolvedPreset };
}
