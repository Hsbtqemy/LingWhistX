import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QueryWindowResult } from "../types";
import { QUERY_WINDOW_DEFAULT_MAX } from "../types";

/** Fenêtre temporelle totale centrée sur la tête de lecture (spec WX-624 : buffer ~±10s–±30s ; ici 60s pour Lanes/Chat). */
export const PLAYER_WINDOW_TOTAL_MS = 60_000;

/** Fenêtre 30s pour charger les mots (spec : words si fenêtre ≤ 30s). */
export const PLAYER_WINDOW_WORDS_MS = 30_000;

/**
 * Grille temporelle pour déclencher `query_run_events_window` : ~4 requêtes/s max pendant la lecture
 * (pas d’IPC à 60 Hz — spec WX-624).
 */
export const PLAYER_WINDOW_COARSE_SEC = 0.25;

export type PlayerRunWindowQueryPreset = "standard" | "words_detail";

export type UsePlayerRunWindowOptions = {
  runDir: string | null;
  /** Temps courant en secondes (lecture ou pause). */
  centerTimeSec: number;
  /** Ex. manifest chargé et pas d’erreur bloquante. */
  enabled: boolean;
  /**
   * `standard` : 60s, sans words (Lanes/Chat).
   * `words_detail` : 30s + words avec plafond (aperçu mots).
   */
  queryPreset?: PlayerRunWindowQueryPreset;
  /** Filtre SQLite : un ou plusieurs `speaker` exacts ; `null` = tous. */
  speakersFilter?: string[] | null;
};

export type UsePlayerRunWindowResult = {
  loading: boolean;
  error: string | null;
  slice: QueryWindowResult | null;
  /** Bornes de la dernière requête réussie (ms). */
  lastT0Ms: number | null;
  lastT1Ms: number | null;
  queryPreset: PlayerRunWindowQueryPreset;
};

/**
 * Slices SQLite pour le Player : `query_run_events_window` avec couches adaptées (sans words sur fenêtre large).
 */
export function usePlayerRunWindow({
  runDir,
  centerTimeSec,
  enabled,
  queryPreset = "standard",
  speakersFilter = null,
}: UsePlayerRunWindowOptions): UsePlayerRunWindowResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slice, setSlice] = useState<QueryWindowResult | null>(null);
  const [lastT0Ms, setLastT0Ms] = useState<number | null>(null);
  const [lastT1Ms, setLastT1Ms] = useState<number | null>(null);

  const centerRef = useRef(centerTimeSec);
  centerRef.current = centerTimeSec;

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
        const centerMs = Math.round(centerRef.current * 1000);
        const totalMs =
          queryPreset === "words_detail" ? PLAYER_WINDOW_WORDS_MS : PLAYER_WINDOW_TOTAL_MS;
        const half = Math.floor(totalMs / 2);
        const t0 = Math.max(0, centerMs - half);
        const t1 = centerMs + half;
        const includeWords = queryPreset === "words_detail";
        try {
          const speakers = speakersFilter && speakersFilter.length > 0 ? speakersFilter : [];
          const r = await invoke<QueryWindowResult>("query_run_events_window", {
            request: {
              runDir,
              t0Ms: t0,
              t1Ms: t1,
              layers: {
                words: includeWords,
                turns: true,
                pauses: true,
                ipus: true,
              },
              speakers,
              limits: includeWords
                ? {
                    maxWords: Math.min(2000, QUERY_WINDOW_DEFAULT_MAX.words),
                    maxTurns: 2000,
                    maxPauses: 2000,
                    maxIpus: 2000,
                  }
                : undefined,
            },
          });
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
    }, 75);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setLoading(false);
    };
  }, [runDir, enabled, coarseKey, queryPreset, speakersKey]);

  return { loading, error, slice, lastT0Ms, lastT1Ms, queryPreset };
}
