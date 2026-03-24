import { parseOptionalFloat } from "./studioExplorerUi";
import type { RecalcPausesIpuConfig } from "../../types";

export type RecalcFormInputs = {
  minPauseInput: string;
  ignoreBelowInput: string;
  pauseMaxInput: string;
  ipuMinWordsInput: string;
  ipuMinDurInput: string;
};

/**
 * Construit la config Rust pour `recalc_pauses_ipu` depuis les champs UI (même logique que l’historique inline).
 */
export function buildRecalcPausesIpuConfig(input: RecalcFormInputs): RecalcPausesIpuConfig | null {
  const minPauseSec = Number(input.minPauseInput);
  const ignoreBelowSec = Number(input.ignoreBelowInput);
  if (!Number.isFinite(minPauseSec) || !Number.isFinite(ignoreBelowSec)) {
    return null;
  }
  const mw = parseInt(input.ipuMinWordsInput, 10);
  const ipuMinWords = Number.isFinite(mw) && mw > 0 ? mw : 1;
  const ipuMinDurationSec = Number(input.ipuMinDurInput);
  const pmax = parseOptionalFloat(input.pauseMaxInput);
  return {
    minPauseSec,
    ignoreBelowSec,
    pauseMaxSec: pmax ?? null,
    ipuMinWords,
    ipuMinDurationSec: Number.isFinite(ipuMinDurationSec) ? ipuMinDurationSec : 0,
  };
}
