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

function scrollToFullLogs() {
  document.getElementById("job-timeline-logs")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Pipeline détaillé (préparation → transcription → …) + message job + extrait des logs.
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

  /** Derniers messages, plus récent en tête (comme le journal complet). */
  const recent = useMemo(
    () => [...logs].slice(-RECENT_LOGS).reverse(),
    [logs],
  );

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
          <p className="job-pipeline-strip__banner">En file d&apos;attente — le worker démarrera sous peu.</p>
        ) : null}
      </div>

      <ol className="job-pipeline-strip__rail" aria-label="Étapes du traitement">
        {steps.map((step, i) => {
          const done =
            job.status === "done" || allComplete || (activeIndex >= 0 && i < activeIndex);
          const current =
            !allComplete &&
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
              className={`job-pipeline-strip__step ${done ? "job-pipeline-strip__step--done" : ""} ${current ? "job-pipeline-strip__step--current" : ""} ${errStep ? "job-pipeline-strip__step--error" : ""} ${cancelledLast ? "job-pipeline-strip__step--cancelled" : ""}`}
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

      {isRunning ? (
        <div className="job-pipeline-strip__progress-wrap">
          <div className="progress-track job-pipeline-strip__track">
            <div
              className="progress-value"
              style={{ width: `${Math.max(4, job.progress)}%` }}
            />
          </div>
          <span className="job-pipeline-strip__pct mono">{job.progress}%</span>
        </div>
      ) : null}

      {isError && job.error ? (
        <p className="job-pipeline-strip__hint small">
          Échec : voir le détail dans Méta ou la ligne d&apos;erreur ci-dessous dans l&apos;historique.
        </p>
      ) : null}
      {isCancelled ? (
        <p className="job-pipeline-strip__hint small">Job annulé.</p>
      ) : null}

      {logs.length > 0 ? (
        <details className="job-pipeline-strip__activity">
          <summary>
            Texte du worker (derniers messages)
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
          <button type="button" className="ghost job-pipeline-strip__logs-link" onClick={scrollToFullLogs}>
            Voir le journal d&apos;exécution complet
          </button>
        </details>
      ) : (
        <p className="job-pipeline-strip__hint small">Aucun message du worker pour l&apos;instant.</p>
      )}
    </div>
  );
}
