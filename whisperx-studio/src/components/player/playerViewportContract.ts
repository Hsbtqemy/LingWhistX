import type { ReactNode } from "react";
import type { QueryWindowResult } from "../../types";
import {
  PLAYER_WINDOW_TOTAL_MS,
  PLAYER_WINDOW_WORDS_MS,
} from "../../player/playerRunWindowBounds";

/**
 * Modes de vue du workspace Player (WX-624).
 * L’implémentation concrète vit dans {@link import("./PlayerRunWindowViews").PlayerRunWindowViews}.
 */
export type PlayerViewportMode = "lanes" | "chat" | "words" | "columns" | "rythmo" | "karaoke" | "stats";

/** Contexte commun aux vues (fenêtre SQLite + transport). */
export type PlayerViewportContext = {
  slice: QueryWindowResult | null;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
};

/**
 * Contrat documenté pour une future abstraction « ViewportRenderer » (spec backlog WX-624).
 * Aujourd’hui, un seul composant route par `mode` ; le rendu vit dans `PlayerRunWindowViews`.
 */
export type PlayerViewportRendererContract = {
  readonly mode: PlayerViewportMode;
  /** Rendu React pour le contexte courant (slice déjà chargé côté parent quand requis). */
  render: (ctx: PlayerViewportContext) => ReactNode;
};

// ─── WX-660 : contrats de requête par vue ────────────────────────────────────

/**
 * Contrat de requête SQLite pour une vue Player.
 * Définit les tables nécessaires et la fenêtre temporelle adaptée à chaque mode.
 * `usePlayerRunWindow` n’interroge que les tables déclarées — pas de sur-fetch.
 */
export type ViewportQueryContract = {
  /** Preset de fenêtre temporelle (détermine t0/t1 dans `computePlayerWindowQueryBounds`). */
  queryPreset: "standard" | "words_detail" | "full_run";
  /** Tables SQLite à inclure dans `query_run_events_window`. */
  layers: {
    words: boolean;
    turns: boolean;
    pauses: boolean;
    ipus: boolean;
  };
};

/**
 * Contrats par vue — issus de l’audit des consommations réelles dans `PlayerRunWindowViews.tsx`.
 *
 * | Vue      | words | turns | pauses | ipus  | fenêtre  |
 * |----------|-------|-------|--------|-------|----------|
 * | lanes    | —     | ✓     | ✓      | ✓     | 60s      |
 * | chat     | —     | —     | —      | ✓     | 60s      |
 * | words    | ✓     | —     | —      | —     | 30s      |
 * | columns  | —     | ✓     | —      | —     | 60s      |
 * | rythmo   | —     | —     | —      | ✓     | 60s      |
 * | karaoke  | ✓     | —     | —      | —     | 30s      |
 * | stats    | —     | ✓     | ✓      | ✓     | full run |
 */
export const VIEWPORT_QUERY_CONTRACTS: Record<PlayerViewportMode, ViewportQueryContract> = {
  lanes: {
    queryPreset: "standard",
    layers: { words: false, turns: true, pauses: true, ipus: true },
  },
  chat: {
    queryPreset: "standard",
    layers: { words: false, turns: false, pauses: false, ipus: true },
  },
  words: {
    queryPreset: "words_detail",
    layers: { words: true, turns: false, pauses: false, ipus: false },
  },
  columns: {
    queryPreset: "standard",
    layers: { words: false, turns: true, pauses: false, ipus: false },
  },
  rythmo: {
    queryPreset: "standard",
    layers: { words: false, turns: false, pauses: false, ipus: true },
  },
  karaoke: {
    queryPreset: "words_detail",
    layers: { words: true, turns: false, pauses: false, ipus: false },
  },
  /** WX-667 — stats prosodiques par locuteur (full run). */
  stats: {
    queryPreset: "full_run",
    layers: { words: false, turns: true, pauses: true, ipus: true },
  },
} as const;

/** Fenêtre en ms correspondant à un preset (utile pour affichage et limites). */
export function windowMsFromPreset(preset: "standard" | "words_detail"): number {
  return preset === "words_detail" ? PLAYER_WINDOW_WORDS_MS : PLAYER_WINDOW_TOTAL_MS;
}
