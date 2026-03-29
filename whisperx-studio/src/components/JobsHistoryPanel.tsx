import { formatTimestamp } from "../appUtils";
import type { Job } from "../types";
import { WorkerErrorMessage } from "../WorkerErrorMessage";
import { ErrorBanner } from "./ErrorBanner";

export type JobsHistoryPanelProps = {
  jobs: Job[];
  selectedJobId: string;
  onFocusJobDetails: (jobId: string) => void;
  onOpenLocalPath: (path: string) => void;
  onCancelJob: (jobId: string) => void;
  /** Supprime l’entrée SQLite + mémoire (fichiers sur disque inchangés). */
  onDeleteJob: (jobId: string) => void | Promise<void>;
  /** Si défini et `hasMore`, affiche le bouton « Charger plus » (pagination SQLite). */
  jobsPagination?: { hasMore: boolean; totalInDb: number } | null;
  onLoadMoreJobs?: () => void | Promise<void>;
  /** Pendant l’appel IPC « Charger plus ». */
  loadMoreJobsLoading?: boolean;
};

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
}: JobsHistoryPanelProps) {
  const totalLabel =
    jobsPagination && jobsPagination.totalInDb > jobs.length
      ? `${jobs.length} affiché(s) / ${jobsPagination.totalInDb} en base`
      : jobsPagination && jobsPagination.totalInDb > 0
        ? `${jobs.length} job${jobs.length > 1 ? "s" : ""} (${jobsPagination.totalInDb} en base)`
        : null;

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
              return (
                <article
                  className={`job-card ${job.status} ${isSelected ? "selected" : ""}`}
                  key={job.id}
                >
                  <div className="job-top-row">
                    <strong>{job.id}</strong>
                    <span className={`status-pill ${job.status}`}>{job.status}</span>
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
                  <p className={`small ${job.status === "running" ? "job-card__progress-line" : ""}`}>
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
