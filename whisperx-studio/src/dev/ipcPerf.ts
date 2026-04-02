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
      console.debug(
        `[ipc] ${cmd} ${ms.toFixed(1)}ms`,
        label,
        sanitizeMetaForDevLog(ipcMeta(cmd, result)),
      );
    }
    return result;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.debug(
        `[ipc] ${cmd} FAIL ${(performance.now() - t0).toFixed(1)}ms`,
        label,
        redactHomeLikeInString(ipcErrorToString(err)),
      );
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

function ipcErrorToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Réduit les chaînes dans les métadonnées IPC (succès) pour éviter les chemins absolus dans la console dev. */
function sanitizeMetaForDevLog(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string") {
      out[k] = redactHomeLikeInString(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => {
        if (typeof item === "string") return redactHomeLikeInString(item);
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          return sanitizeMetaForDevLog(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeMetaForDevLog(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Paires (valeur env, placeholder), triées par longueur décroissante, sans doublon de valeur.
 * Volontairement sans HOME/USERPROFILE (contrairement à Rust/Python) : périmètre dev léger ;
 * `redactHomeLikeInString` complète avec des regex courantes.
 */
function envRedactionPairs(): { value: string; ph: string }[] {
  const raw: { value: string; ph: string }[] = [];
  const p = typeof process !== "undefined" ? process.env : undefined;
  if (!p) return [];
  const push = (v: string | undefined, ph: string) => {
    if (v && v.length > 0) raw.push({ value: v, ph });
  };
  push(p.LOCALAPPDATA, "~LOCALAPPDATA");
  push(p.APPDATA, "~APPDATA");
  for (const [key, ph] of [
    ["XDG_CONFIG_HOME", "~XDG_CONFIG_HOME"],
    ["XDG_DATA_HOME", "~XDG_DATA_HOME"],
    ["XDG_STATE_HOME", "~XDG_STATE_HOME"],
    ["XDG_CACHE_HOME", "~XDG_CACHE_HOME"],
  ] as const) {
    push(p[key], ph);
  }
  raw.sort((a, b) => b.value.length - a.value.length);
  const seen = new Set<string>();
  return raw.filter((x) => {
    if (seen.has(x.value)) return false;
    seen.add(x.value);
    return true;
  });
}

/** Réduit les préfixes home-like dans les logs dev (erreurs IPC peuvent contenir des chemins absolus). */
function redactHomeLikeInString(s: string): string {
  let out = s;
  for (const { value, ph } of envRedactionPairs()) {
    if (value.length > 0 && out.includes(value)) {
      out = out.split(value).join(ph);
    }
  }
  out = out.replace(/\/Users\/[^/\s]+/g, "~");
  out = out.replace(/\/home\/[^/\s]+/g, "~");
  out = out.replace(/C:\\Users\\[^\\\s]+/gi, "~");
  return out;
}
