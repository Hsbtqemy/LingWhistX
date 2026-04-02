/**
 * WX-659 — point d'entrée unique pour les données WXENV1 (overview + slice de détail).
 *
 * Gère de manière transparente les deux caches :
 *   - overview : chargé une seule fois par pyramide, conservé tant que la pyramide ne change pas.
 *   - detail slice : re-fetché avec debounce 80 ms à chaque changement de fenêtre.
 *
 * `useWaveformWorkspace` et `useWaveformCanvas` consomment ce service via `WaveformWorkspace` —
 * aucun composant n'a besoin d'appeler directement les fonctions IPC de `waveformWxenv.ts`.
 */

import { useEffect, useState } from "react";
import type {
  WaveformDetailEnvelope,
  WaveformOverviewEnvelope,
  WaveformPyramidBuilt,
} from "../types";
import {
  loadDetailEnvelopeForView,
  loadFullOverviewMinMax,
  resolveOverviewLevelPath,
} from "../waveformWxenv";

export type UseWaveformServiceArgs = {
  /** Pyramide WXENV1 construite par `useWaveformWorkspace`. Null = pas encore disponible. */
  pyramid: WaveformPyramidBuilt | null;
  /** Début de la fenêtre visible (secondes). */
  viewStartSec: number;
  /** Durée visible (secondes). */
  visibleDurationSec: number;
};

export function useWaveformService({
  pyramid,
  viewStartSec,
  visibleDurationSec,
}: UseWaveformServiceArgs) {
  const [overviewEnvelope, setOverviewEnvelope] = useState<WaveformOverviewEnvelope | null>(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(false);
  const [detailEnvelope, setDetailEnvelope] = useState<WaveformDetailEnvelope | null>(null);

  /** Charge l'overview une seule fois dès que la pyramide est disponible. */
  useEffect(() => {
    if (!pyramid) {
      setOverviewEnvelope(null);
      return;
    }
    let cancelled = false;
    setIsOverviewLoading(true);
    void (async () => {
      try {
        const { path, levelIndex } = await resolveOverviewLevelPath(pyramid);
        const { minMax, meta } = await loadFullOverviewMinMax(path);
        if (!cancelled) {
          setOverviewEnvelope({
            minMax,
            sampleRate: meta.sampleRate,
            blockSize: meta.blockSize,
            nBlocks: meta.nBlocks,
            levelIndex,
          });
        }
      } catch {
        if (!cancelled) {
          setOverviewEnvelope(null);
        }
      } finally {
        if (!cancelled) {
          setIsOverviewLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pyramid]);

  /** Re-fetche le slice de détail avec debounce 80 ms à chaque changement de fenêtre. */
  useEffect(() => {
    if (!pyramid || visibleDurationSec <= 0) {
      setDetailEnvelope(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const env = await loadDetailEnvelopeForView(pyramid, viewStartSec, visibleDurationSec);
          if (!cancelled) {
            setDetailEnvelope(env);
          }
        } catch {
          if (!cancelled) {
            setDetailEnvelope(null);
          }
        }
      })();
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pyramid, viewStartSec, visibleDurationSec]);

  return {
    overviewEnvelope,
    isOverviewLoading,
    detailEnvelope,
  };
}
