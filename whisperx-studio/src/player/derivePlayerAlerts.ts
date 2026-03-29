import type { QueryWindowResult } from "../types";

export type PlayerDerivedAlertKind = "overlap_turn" | "long_pause";

/** Alerte heuristique (WX-624 v1) — dérivée du slice SQLite, sans table `alerts` dédiée. */
export type PlayerDerivedAlert = {
  id: string;
  kind: PlayerDerivedAlertKind;
  startMs: number;
  message: string;
};

const DEFAULT_LONG_PAUSE_MS = 3000;

export type DerivePlayerAlertsOptions = {
  /** Seuil pause longue (ms). Défaut 3000 — aligné IPC `recompute_player_alerts`. */
  longPauseMs?: number;
};

/**
 * Détecte chevauchements entre tours consécutifs (fenêtre courante) et pauses longues.
 */
export function derivePlayerAlerts(
  slice: QueryWindowResult,
  options?: DerivePlayerAlertsOptions,
): PlayerDerivedAlert[] {
  const longPauseMs = options?.longPauseMs ?? DEFAULT_LONG_PAUSE_MS;
  const out: PlayerDerivedAlert[] = [];
  const turns = [...slice.turns].sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < turns.length - 1; i++) {
    const a = turns[i];
    const b = turns[i + 1];
    if (a.endMs > b.startMs) {
      const ov = a.endMs - b.startMs;
      out.push({
        id: `overlap-${a.id}-${b.id}`,
        kind: "overlap_turn",
        startMs: b.startMs,
        message: `Chevauchement tours ${a.speaker} / ${b.speaker} (~${ov} ms)`,
      });
    }
  }
  for (const p of slice.pauses) {
    if (p.durMs >= longPauseMs) {
      out.push({
        id: `pause-${p.id}`,
        kind: "long_pause",
        startMs: p.startMs,
        message: `Pause longue (${(p.durMs / 1000).toFixed(1)} s)`,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}
