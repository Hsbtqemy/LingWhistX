import { useCallback, useMemo, useRef, useState } from "react";
import { formatTimestamp } from "../appUtils";
import type { Job } from "../types";
import { WorkerErrorMessage } from "../WorkerErrorMessage";
import { ErrorBanner } from "./ErrorBanner";

const PRIORITY_LABELS: Record<number, string> = { 0: "P0", 1: "P1", 2: "P2", 3: "P3" };
const PRIORITY_TITLES: Record<number, string> = {
  0: "P0 — Critique (passe en premier)",
  1: "P1 — Haute",
  2: "P2 — Normale (défaut)",
  3: "P3 — Basse",
};

export type JobsHistoryPanelProps = {
  jobs: Job[];
  selectedJobId: string;
  onFocusJobDetails: (jobId: string) => void;
  onOpenLocalPath: (path: string) => void;
  onCancelJob: (jobId: string) => void;
  /** Supprime l'entrée SQLite + mémoire (fichiers sur disque inchangés). */
  onDeleteJob: (jobId: string) => void | Promise<void>;
  /** Si défini et `hasMore`, affiche le bouton « Charger plus » (pagination SQLite). */
  jobsPagination?: { hasMore: boolean; totalInDb: number } | null;
  onLoadMoreJobs?: () => void | Promise<void>;
  /** Pendant l'appel IPC « Charger plus ». */
  loadMoreJobsLoading?: boolean;
  /** WX-672 — Modifie la priorité d'un job (P0-P3). */
  onSetJobPriority?: (jobId: string, priority: 0 | 1 | 2 | 3) => void | Promise<void>;
  /** WX-672 — Réordonne la file (liste complète des IDs dans le nouvel ordre). */
  onReorderJobs?: (orderedIds: string[]) => void | Promise<void>;
};

/** WX-672 — Panneau de monitoring : stats en temps réel calculées depuis la liste. */
function BatchMonitorPanel({ jobs }: { jobs: Job[] }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const todayStart = now - 24 * 3600 * 1000;
    const queued = jobs.filter((j) => j.status === "queued").length;
    const running = jobs.filter((j) => j.status === "running").length;
    const doneToday = jobs.filter((j) => j.status === "done" && j.updatedAtMs >= todayStart).length;
    const errorsToday = jobs.filter(
      (j) => j.status === "error" && j.updatedAtMs >= todayStart,
    ).length;
    const finishedToday = doneToday + errorsToday;
    const errorRate = finishedToday > 0 ? Math.round((errorsToday / finishedToday) * 100) : 0;
    return { queued, running, doneToday, errorsToday, errorRate };
  }, [jobs]);

  if (jobs.length === 0) return null;

  return (
    <div className="batch-monitor" aria-label="Monitoring de la file">
      <span className="batch-monitor__stat">
        <span className="batch-monitor__val">{stats.queued}</span> en attente
      </span>
      <span className="batch-monitor__sep" aria-hidden>
        ·
      </span>
      <span className="batch-monitor__stat">
        <span className="batch-monitor__val">{stats.running}</span> en cours
      </span>
      <span className="batch-monitor__sep" aria-hidden>
        ·
      </span>
      <span className="batch-monitor__stat">
        <span className="batch-monitor__val">{stats.doneToday}</span> terminé(s) (24h)
      </span>
      {stats.errorsToday > 0 ? (
        <>
          <span className="batch-monitor__sep" aria-hidden>
            ·
          </span>
          <span className="batch-monitor__stat batch-monitor__stat--error">
            <span className="batch-monitor__val">{stats.errorRate}%</span> taux d&apos;erreur
          </span>
        </>
      ) : null}
    </div>
  );
}

export function JobsHistoryPanel({
  jobs,
  selectedJobId,
  onFocusJobDetails,
  onOpenLocalPath,
  onCancelJob,
  onDeleteJob,
  jobsPagination,
  onLoadMoreJobs,
  loadMoreJobsLoading = false,
  onSetJobPriority,
  onReorderJobs,
}: JobsHistoryPanelProps) {
  const totalLabel =
    jobsPagination && jobsPagination.totalInDb > jobs.length
      ? `${jobs.length} affiché(s) / ${jobsPagination.totalInDb} en base`
      : jobsPagination && jobsPagination.totalInDb > 0
        ? `${jobs.length} job${jobs.length > 1 ? "s" : ""} (${jobsPagination.totalInDb} en base)`
        : null;

  // WX-672 — Drag-and-drop state
  const dragJobId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((jobId: string) => {
    dragJobId.current = jobId;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, jobId: string) => {
    e.preventDefault();
    setDragOverId(jobId);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      setDragOverId(null);
      const sourceId = dragJobId.current;
      dragJobId.current = null;
      if (!sourceId || sourceId === targetId || !onReorderJobs) return;

      const ids = jobs.map((j) => j.id);
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;

      const reordered = [...ids];
      reordered.splice(from, 1);
      reordered.splice(to, 0, sourceId);
      void onReorderJobs(reordered);
    },
    [jobs, onReorderJobs],
  );

  const handleDragEnd = useCallback(() => {
    dragJobId.current = null;
    setDragOverId(null);
  }, []);

  return (
    <section className="panel jobs-history-panel">
      <header className="panel-header">
        <h2>Historique des jobs</h2>
        <span
          className={`job-count-pill ${jobs.length > 0 ? "job-count-pill--active" : ""}`}
          aria-live="polite"
        >
          {jobs.length === 0 ? "0 job" : `${jobs.length} job${jobs.length > 1 ? "s" : ""}`}
        </span>
      </header>

      <BatchMonitorPanel jobs={jobs} />

      {totalLabel ? <p className="field-help panel-subtle">{totalLabel}</p> : null}
      {jobsPagination?.hasMore && onLoadMoreJobs ? (
        <div className="jobs-load-more">
          <button
            type="button"
            className="ghost"
            disabled={loadMoreJobsLoading}
            aria-busy={loadMoreJobsLoading}
            onClick={() => void onLoadMoreJobs()}
          >
            {loadMoreJobsLoading ? "Chargement…" : "Charger les jobs plus anciens (par paquets)"}
          </button>
        </div>
      ) : null}

      <div className="jobs-history-panel__scroll">
        <div className="jobs-grid">
          {jobs.length === 0 ? (
            <div className="empty-state-card" role="status">
              <div className="empty-state-card-icon" aria-hidden />
              <h3 className="empty-state-card-title">Aucun job pour le moment</h3>
              <p className="empty-state-card-text">
                Va sur l&apos;onglet <strong>Studio</strong>, importe un média dans{" "}
                <strong>Nouveau job</strong> puis configure WhisperX. Les runs apparaîtront ici ; tu
                peux suivre la progression dans le même onglet.
              </p>
            </div>
          ) : (
            jobs.map((job) => {
              const canCancel = job.status === "queued" || job.status === "running";
              const canDeleteFromHistory = !canCancel;
              const isSelected = selectedJobId === job.id;
              const isDragOver = dragOverId === job.id;
              const priority = (job.priority ?? 2) as 0 | 1 | 2 | 3;

              return (
                <article
                  className={`job-card ${job.status} ${isSelected ? "selected" : ""} ${isDragOver ? "is-drag-over" : ""}`}
                  key={job.id}
                  draggable={Boolean(onReorderJobs && canCancel)}
                  onDragStart={() => handleDragStart(job.id)}
                  onDragOver={(e) => handleDragOver(e, job.id)}
                  onDrop={(e) => handleDrop(e, job.id)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="job-top-row">
                    <strong>{job.id}</strong>
                    <div className="job-top-row__badges">
                      {/* WX-672 — Priority badge */}
                      {onSetJobPriority ? (
                        <span
                          className={`job-priority-badge job-priority-badge--p${priority}`}
                          title={PRIORITY_TITLES[priority]}
                        >
                          {PRIORITY_LABELS[priority]}
                          <span className="job-priority-badge__arrows">
                            {([0, 1, 2, 3] as const).map((p) => (
                              <button
                                key={p}
                                type="button"
                                className={`job-priority-btn ${p === priority ? "is-active" : ""}`}
                                title={PRIORITY_TITLES[p]}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onSetJobPriority(job.id, p);
                                }}
                              >
                                {PRIORITY_LABELS[p]}
                              </button>
                            ))}
                          </span>
                        </span>
                      ) : null}
                      <span className={`status-pill ${job.status}`}>{job.status}</span>
                    </div>
                  </div>

                  <p className="job-message">{job.message}</p>
                  <p className="mono">{job.inputPath}</p>
                  <p className="mono">Sortie: {job.outputDir}</p>
                  <p>Mode: {job.mode}</p>
                  {job.whisperxOptions?.model ? (
                    <p className="small">Modele: {job.whisperxOptions.model}</p>
                  ) : null}

                  <div
                    className={`progress-track ${job.status === "running" ? "progress-track--active" : ""}`}
                  >
                    <div
                      className={`progress-value ${job.status === "running" ? "progress-value--active" : ""}`}
                      style={{ width: `${Math.max(4, job.progress)}%` }}
                    />
                  </div>
                  <p
                    className={`small ${job.status === "running" ? "job-card__progress-line" : ""}`}
                  >
                    {job.status === "running" ? (
                      <span
                        className="lx-spinner lx-spinner--sm"
                        role="status"
                        aria-label="Traitement en cours"
                      />
                    ) : null}
                    <span>{job.progress}%</span>
                  </p>

                  <div className="job-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onFocusJobDetails(job.id)}
                    >
                      Voir détails
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onOpenLocalPath(job.outputDir)}
                    >
                      Ouvrir dossier
                    </button>
                    {canCancel ? (
                      <button type="button" className="danger" onClick={() => onCancelJob(job.id)}>
                        Annuler
                      </button>
                    ) : null}
                    {canDeleteFromHistory ? (
                      <button
                        type="button"
                        className="ghost danger"
                        onClick={() => void onDeleteJob(job.id)}
                      >
                        Retirer de l&apos;historique
                      </button>
                    ) : null}
                  </div>

                  {job.error ? (
                    <ErrorBanner multiline>
                      <WorkerErrorMessage text={job.error} />
                    </ErrorBanner>
                  ) : null}
                  <p className="small">Maj: {formatTimestamp(job.updatedAtMs)}</p>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
