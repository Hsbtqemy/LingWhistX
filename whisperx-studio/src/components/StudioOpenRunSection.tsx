import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { formatTimestamp, pathsEqualNormalized } from "../appUtils";
import type {
  Job,
  QueryWindowResult,
  RecentRunEntry,
  RunEventsImportResult,
  RunManifestSummary,
  StudioView,
} from "../types";

export type StudioOpenRunSectionProps = {
  setError: (message: string) => void;
  setActiveView: (view: StudioView) => void;
  setSelectedJobId: (id: string) => void;
};

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) {
    return "—";
  }
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StudioOpenRunSection({
  setError,
  setActiveView,
  setSelectedJobId,
}: StudioOpenRunSectionProps) {
  const [recent, setRecent] = useState<RecentRunEntry[]>([]);
  const [summary, setSummary] = useState<RunManifestSummary | null>(null);
  const [matchingJobId, setMatchingJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [eventsImport, setEventsImport] = useState<RunEventsImportResult | null>(null);
  const [eventsImportError, setEventsImportError] = useState("");
  const [queryWindowPreview, setQueryWindowPreview] = useState<QueryWindowResult | null>(null);
  const [queryWindowError, setQueryWindowError] = useState("");

  const refreshRecent = useCallback(async () => {
    try {
      const entries = await invoke<RecentRunEntry[]>("list_recent_runs");
      setRecent(entries);
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  const findMatchingJob = useCallback(async (runDir: string) => {
    try {
      const jobs = await invoke<Job[]>("list_jobs");
      const hit = jobs.find((j) => pathsEqualNormalized(j.outputDir, runDir));
      setMatchingJobId(hit?.id ?? null);
    } catch {
      setMatchingJobId(null);
    }
  }, []);

  const loadSummary = useCallback(
    async (path: string) => {
      setError("");
      setBusy(true);
      setSummary(null);
      setMatchingJobId(null);
      setEventsImport(null);
      setEventsImportError("");
      setQueryWindowPreview(null);
      setQueryWindowError("");
      try {
        const s = await invoke<RunManifestSummary>("read_run_manifest_summary", {
          inputPath: path,
        });
        setSummary(s);
        await findMatchingJob(s.runDir);
        await refreshRecent();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [setError, findMatchingJob, refreshRecent],
  );

  const pickRunDirectory = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Dossier de run (contient run_manifest.json)",
    });
    if (typeof selected === "string") {
      await loadSummary(selected);
    }
  }, [loadSummary]);

  const pickRunManifestFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Fichier run_manifest.json",
      filters: [{ name: "Manifest", extensions: ["json"] }],
    });
    if (typeof selected === "string") {
      await loadSummary(selected);
    }
  }, [loadSummary]);

  const testQueryWindow = useCallback(async () => {
    if (!summary?.runDir) {
      return;
    }
    setQueryWindowError("");
    setBusy(true);
    try {
      const r = await invoke<QueryWindowResult>("query_run_events_window", {
        request: {
          runDir: summary.runDir,
          t0Ms: 0,
          t1Ms: 30_000,
        },
      });
      setQueryWindowPreview(r);
    } catch (e) {
      setQueryWindowPreview(null);
      setQueryWindowError(String(e));
    } finally {
      setBusy(false);
    }
  }, [summary]);

  const importEventsSqlite = useCallback(async () => {
    if (!summary?.runDir) {
      return;
    }
    setEventsImportError("");
    setBusy(true);
    try {
      const r = await invoke<RunEventsImportResult>("import_run_events", {
        runDir: summary.runDir,
      });
      setEventsImport(r);
    } catch (e) {
      setEventsImport(null);
      setEventsImportError(String(e));
    } finally {
      setBusy(false);
    }
  }, [summary]);

  const openInWorkspace = useCallback(() => {
    if (!matchingJobId) {
      return;
    }
    setSelectedJobId(matchingJobId);
    setActiveView("workspace");
  }, [matchingJobId, setSelectedJobId, setActiveView]);

  const clearRecent = useCallback(async () => {
    setError("");
    try {
      await invoke("clear_recent_runs");
      await refreshRecent();
    } catch (e) {
      setError(String(e));
    }
  }, [setError, refreshRecent]);

  return (
    <section className="panel panel--open-run" aria-labelledby="open-run-title">
      <header className="panel-header">
        <h2 id="open-run-title">Ouvrir un run</h2>
        <span className="field-help">WX-611 — dossier avec run_manifest.json (schema v1)</span>
      </header>

      <div className="open-run-actions">
        <button
          type="button"
          className="ghost inline"
          disabled={busy}
          onClick={() => void pickRunDirectory()}
        >
          Dossier de run…
        </button>
        <button
          type="button"
          className="ghost inline"
          disabled={busy}
          onClick={() => void pickRunManifestFile()}
        >
          run_manifest.json…
        </button>
      </div>

      {recent.length > 0 ? (
        <div className="open-run-recent">
          <div className="open-run-recent-header">
            <span>Récents</span>
            <button type="button" className="ghost inline" onClick={() => void clearRecent()}>
              Effacer
            </button>
          </div>
          <ul className="open-run-recent-list">
            {recent.map((r) => (
              <li key={r.runDir}>
                <button
                  type="button"
                  className="open-run-recent-item"
                  disabled={busy}
                  onClick={() => void loadSummary(r.runDir)}
                >
                  <span className="open-run-recent-id">{r.runId}</span>
                  <span className="open-run-recent-path" title={r.runDir}>
                    {r.runDir}
                  </span>
                  <span className="open-run-recent-time">{formatTimestamp(r.lastOpenedAtMs)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary ? (
        <div className="open-run-summary">
          <h3>Résumé</h3>
          <dl className="open-run-dl">
            <dt>run_id</dt>
            <dd>{summary.runId}</dd>
            <dt>schema</dt>
            <dd>{summary.schemaVersion}</dd>
            <dt>Durée média</dt>
            <dd>{formatDuration(summary.durationSec ?? undefined)}</dd>
            <dt>Artifacts</dt>
            <dd>
              {summary.artifactCount}
              {summary.artifactKeys.length > 0 ? (
                <span className="open-run-artifacts" title={summary.artifactKeys.join(", ")}>
                  {" "}
                  ({summary.artifactKeys.slice(0, 4).join(", ")}
                  {summary.artifactKeys.length > 4 ? "…" : ""})
                </span>
              ) : null}
            </dd>
            <dt>Média</dt>
            <dd
              className="open-run-path"
              title={summary.inputMediaResolved ?? summary.inputMediaPath ?? ""}
            >
              {summary.inputMediaResolved ?? summary.inputMediaPath ?? "—"}
            </dd>
          </dl>
          {summary.warnings.length > 0 ? (
            <p className="open-run-warnings">Avertissements: {summary.warnings.join(" · ")}</p>
          ) : null}
          <div className="open-run-events-row">
            <button
              type="button"
              className="ghost inline"
              disabled={busy}
              onClick={() => void importEventsSqlite()}
            >
              Indexer events.sqlite (WX-612)
            </button>
            {eventsImport ? (
              <span className="open-run-events-stats">
                {eventsImport.nWords} mots · {eventsImport.nTurns} tours · {eventsImport.nPauses}{" "}
                pauses · {eventsImport.nIpus} IPU
              </span>
            ) : null}
            {eventsImportError ? (
              <span className="open-run-warnings">{eventsImportError}</span>
            ) : null}
            {eventsImport ? (
              <span className="field-help" title={eventsImport.dbPath}>
                {eventsImport.dbPath.split(/[/\\]/).pop()}
              </span>
            ) : null}
            {eventsImport ? (
              <button
                type="button"
                className="ghost inline"
                disabled={busy}
                onClick={() => void testQueryWindow()}
              >
                Tester fenêtre 0–30 s (WX-613)
              </button>
            ) : null}
            {queryWindowPreview ? (
              <span className="open-run-events-stats">
                Fenêtre: {queryWindowPreview.words.length} mots · {queryWindowPreview.turns.length}{" "}
                tours · {queryWindowPreview.pauses.length} pauses · {queryWindowPreview.ipus.length}{" "}
                IPU
              </span>
            ) : null}
            {queryWindowError ? (
              <span className="open-run-warnings">{queryWindowError}</span>
            ) : null}
          </div>
          <div className="open-run-workspace-row">
            {matchingJobId ? (
              <button type="button" className="primary inline" onClick={openInWorkspace}>
                Ouvrir dans l’espace de travail
              </button>
            ) : (
              <p className="field-help">
                Aucun job Studio ne pointe vers ce dossier de sortie. Lance un traitement avec ce
                dossier comme répertoire de sortie, ou ouvre les fichiers depuis le dossier
                manuellement.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
