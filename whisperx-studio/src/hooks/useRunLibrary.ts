import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { fileBasename } from "../appUtils";
import type { RecentRunEntry, RunManifestSummary } from "../types";

export type LibraryEntry = RecentRunEntry & {
  manifest: RunManifestSummary | null;
  label: string;
};

export function useRunLibrary(open: boolean) {
  const [allEntries, setAllEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const runs = await invoke<RecentRunEntry[]>("list_recent_runs");
      const sorted = [...runs].sort((a, b) => b.lastOpenedAtMs - a.lastOpenedAtMs);

      const enriched = await Promise.all(
        sorted.map(async (run) => {
          let manifest: RunManifestSummary | null = null;
          try {
            manifest = await invoke<RunManifestSummary>("read_run_manifest_summary", {
              runDir: run.runDir,
            });
          } catch {
            // best-effort
          }
          const label = manifest?.inputMediaPath
            ? fileBasename(manifest.inputMediaPath) || run.runId
            : run.runId;
          return { ...run, manifest, label };
        }),
      );

      setAllEntries(enriched);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchEntries();
  }, [open, fetchEntries]);

  const q = query.trim().toLowerCase();
  const entries = q
    ? allEntries.filter(
        (e) => e.label.toLowerCase().includes(q) || e.runId.toLowerCase().includes(q),
      )
    : allEntries;

  return { entries, loading, error, query, setQuery, refresh: fetchEntries };
}
