import { useMemo } from "react";
import type { Job, JobLogEvent } from "../../types";
import {
  buildPipelineSteps,
  jobModeLabel,
  resolveActivePipelineStepId,
  resolveActiveStepIndex,
} from "../../utils/jobPipelineStages";

export type JobRunPipelineStripProps = {
  job: Job;
  logs: JobLogEvent[];
};

const RECENT_LOGS = 6;

/**
 * Pipeline : étapes à gauche (surlignage actif / en attente) ; dernier message du worker à droite.
 */
export function JobRunPipelineStrip({ job, logs }: JobRunPipelineStripProps) {
  const steps = useMemo(() => buildPipelineSteps(job), [job]);
  const activeId = useMemo(() => resolveActivePipelineStepId(job, logs), [job, logs]);
  const { activeIndex, allComplete, isQueued } = useMemo(
    () => resolveActiveStepIndex(job, steps, activeId),
    [job, steps, activeId],
  );

  const isError = job.status === "error";
  const isCancelled = job.status === "cancelled";
  const isRunning = job.status === "running";

  const latestLog = useMemo(
    () => (logs.length > 0 ? logs[logs.length - 1] : null),
    [logs],
  );

  const feedKey = latestLog ? `${latestLog.tsMs}-${latestLog.message.slice(0, 80)}` : "empty";

  /** Derniers messages, plus récent en tête (comme le journal complet). */
  const recent = useMemo(() => [...logs].slice(-RECENT_LOGS).reverse(), [logs]);

  return (
    <div
      className="job-pipeline-strip"
      data-job-status={job.status}
      role="region"
      aria-label="Pipeline du job"
    >
      <div className="job-pipeline-strip__head">
        <div className="job-pipeline-strip__meta">
          <span className="job-pipeline-strip__mode">{jobModeLabel(job.mode)}</span>
          {job.message ? (
            <span className="job-pipeline-strip__message" title={job.message}>
              {job.message}
            </span>
          ) : null}
        </div>
        {isQueued ? (
          <p className="job-pipeline-strip__banner">
            En file d&apos;attente — le worker démarrera sous peu.
          </p>
        ) : null}
      </div>

      <div className="job-pipeline-strip__layout">
        <ol className="job-pipeline-strip__rail" aria-label="Étapes du traitement">
          {steps.map((step, i) => {
            const done =
              job.status === "done" || allComplete || (activeIndex >= 0 && i < activeIndex);
            const pending = isQueued && activeIndex >= 0 && i === activeIndex;
            const current =
              !isQueued &&
              !isError &&
              activeIndex >= 0 &&
              i === activeIndex &&
              isRunning;
            const errStep = isError && !allComplete && activeIndex >= 0 && i === activeIndex;
            const cancelledLast = isCancelled && i === steps.length - 1;

            return (
              <li
                key={step.id}
                className={`job-pipeline-strip__step ${done ? "job-pipeline-strip__step--done" : ""} ${pending ? "job-pipeline-strip__step--pending" : ""} ${current ? "job-pipeline-strip__step--current" : ""} ${errStep ? "job-pipeline-strip__step--error" : ""} ${cancelledLast ? "job-pipeline-strip__step--cancelled" : ""}`}
              >
                <span className="job-pipeline-strip__dot" aria-hidden />
                <span className="job-pipeline-strip__step-body">
                  <span className="job-pipeline-strip__label">{step.label}</span>
                  {step.hint ? (
                    <span className="job-pipeline-strip__hint-inline">{step.hint}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="job-pipeline-strip__journal" aria-live="polite" aria-relevant="text">
          <div className="job-pipeline-strip__journal-head">
            <span className="job-pipeline-strip__journal-title">Journal du worker</span>
            {logs.length > 0 ? (
              <span className="job-pipeline-strip__journal-count">{logs.length}</span>
            ) : null}
          </div>
          <div className="job-pipeline-strip__journal-body" key={feedKey}>
            {latestLog ? (
              <>
                <div className="job-pipeline-strip__journal-meta">
                  <time dateTime={new Date(latestLog.tsMs).toISOString()}>
                    {new Date(latestLog.tsMs).toLocaleTimeString()}
                  </time>
                  {latestLog.stage ? (
                    <span className="job-pipeline-strip__journal-stage">{latestLog.stage}</span>
                  ) : null}
                </div>
                <p className="job-pipeline-strip__journal-msg">{latestLog.message}</p>
              </>
            ) : (
              <p className="job-pipeline-strip__journal-placeholder">
                {isQueued
                  ? "En attente du worker…"
                  : "Aucun message du worker pour l’instant — les lignes s’affichent ici au fil de l’exécution."}
              </p>
            )}
          </div>
          {logs.length > 0 ? (
            <details className="job-pipeline-strip__activity">
              <summary>
                Derniers messages du worker
                <span className="job-pipeline-strip__activity-count">{logs.length}</span>
              </summary>
              <ul className="job-pipeline-strip__activity-list">
                {recent.map((log, idx) => (
                  <li key={`${log.tsMs}-${idx}`}>
                    <span className="job-pipeline-strip__activity-ts">
                      {new Date(log.tsMs).toLocaleTimeString()}
                    </span>
                    {log.stage ? (
                      <span className="job-pipeline-strip__activity-stage">{log.stage}</span>
                    ) : null}
                    <span className="job-pipeline-strip__activity-msg">{log.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>

      {isRunning ? (
        <div className="job-pipeline-strip__progress-wrap">
          <div className="progress-track progress-track--active job-pipeline-strip__track">
            <div
              className="progress-value progress-value--active"
              style={{ width: `${Math.max(4, job.progress)}%` }}
            />
          </div>
          <div className="job-pipeline-strip__pct-row">
            <span
              className="lx-spinner"
              role="status"
              aria-label="Traitement en cours"
              title="Traitement en cours — le pourcentage peut stagner pendant une étape longue (ex. diarisation)."
            />
            <span className="job-pipeline-strip__pct mono">{job.progress}%</span>
          </div>
        </div>
      ) : null}

      {isError && job.error ? (
        <p className="job-pipeline-strip__hint small">
          Échec : voir le détail dans l&apos;onglet Méta ou les messages du worker ci-dessus.
        </p>
      ) : null}
      {isCancelled ? <p className="job-pipeline-strip__hint small">Job annulé.</p> : null}
    </div>
  );
}
