import { invoke } from "@tauri-apps/api/core";

/**
 * WX-620 — instrumentation dev : durée IPC + métadonnées légères (pas de sérialisation complète du payload).
 * Désactivé en build production (`import.meta.env.DEV`).
 */
export async function ipcInvokeDev<T>(
  label: string,
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const t0 = performance.now();
  try {
    const result = args === undefined ? await invoke<T>(cmd) : await invoke<T>(cmd, args);
    if (import.meta.env.DEV) {
      const ms = performance.now() - t0;
      console.debug(`[ipc] ${cmd} ${ms.toFixed(1)}ms`, label, ipcMeta(cmd, result));
    }
    return result;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.debug(`[ipc] ${cmd} FAIL ${(performance.now() - t0).toFixed(1)}ms`, label, err);
    }
    throw err;
  }
}

function ipcMeta(cmd: string, result: unknown): Record<string, unknown> {
  if (cmd === "list_jobs" && Array.isArray(result)) {
    return { nJobs: result.length };
  }
  if (cmd === "list_run_speakers" && Array.isArray(result)) {
    return { nSpeakers: result.length };
  }
  if (result == null || typeof result !== "object") {
    return {};
  }
  const r = result as Record<string, unknown>;
  if (cmd === "query_run_events_window") {
    return {
      nWords: Array.isArray(r.words) ? r.words.length : 0,
      nTurns: Array.isArray(r.turns) ? r.turns.length : 0,
      nPauses: Array.isArray(r.pauses) ? r.pauses.length : 0,
      nIpus: Array.isArray(r.ipus) ? r.ipus.length : 0,
      truncated: r.truncated,
    };
  }
  if (cmd === "import_run_events") {
    return {
      nWords: r.nWords,
      nTurns: r.nTurns,
      nPauses: r.nPauses,
      nIpus: r.nIpus,
    };
  }
  if (cmd === "recalc_pauses_ipu" && r.stats && typeof r.stats === "object") {
    const s = r.stats as Record<string, unknown>;
    return {
      nPauses: s.nPauses,
      nIpus: s.nIpus,
      persisted: r.persisted,
    };
  }
  if (cmd === "read_run_manifest_summary") {
    return { runId: r.runId, durationSec: r.durationSec };
  }
  return {};
}
