import { useMemo, useState } from "react";
import type { Job, JobLogEvent } from "../../types";
import { formatJobLogMessageForDisplay } from "../../utils/liveTranscript";
import { groupJobLogsIntoSections } from "../../utils/jobLogSections";
import { buildPipelineSteps } from "../../utils/jobPipelineStages";

export type JobTimelineLogsProps = {
  job: Job | null;
  logs: JobLogEvent[];
};

function LogLine({ log }: { log: JobLogEvent }) {
  return (
    <>
      <span className="timeline-ts">{new Date(log.tsMs).toLocaleTimeString()}</span>
      <span className={`timeline-level ${log.level}`}>{log.level}</span>
      <span className="timeline-stage">{log.stage ? log.stage : "—"}</span>
      <span className="timeline-msg">{formatJobLogMessageForDisplay(log)}</span>
    </>
  );
}

/**
 * Journal du worker : par défaut les entrées les plus récentes en haut (flux continu).
 * Vue « par étapes » : sections ordonnées de la plus récente à la plus ancienne, lignes idem dans chaque bloc.
 */
export function JobTimelineLogs({ job, logs }: JobTimelineLogsProps) {
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("flat");

  const sectionsNewestFirst = useMemo(() => {
    if (!job || logs.length === 0) {
      return [];
    }
    const base = groupJobLogsIntoSections(logs, job);
    return [...base]
      .reverse()
      .map((sec) => ({ ...sec, logs: [...sec.logs].reverse() }));
  }, [job, logs]);

  const flatNewestFirst = useMemo(() => [...logs].reverse(), [logs]);

  const pipelineSummary = useMemo(() => {
    if (!job) {
      return null;
    }
    return buildPipelineSteps(job)
      .map((s) => s.label)
      .join(" → ");
  }, [job]);

  return (
    <div className="details-column" id="job-timeline-logs">
      <div className="job-timeline-logs__head">
        <h3>Journal d&apos;exécution</h3>
        {logs.length > 0 ? (
          <div
            className="job-timeline-logs__toolbar"
            role="group"
            aria-label="Mode d'affichage du journal"
          >
            <button
              type="button"
              className={`ghost small job-timeline-logs__mode-btn${viewMode === "flat" ? " job-timeline-logs__mode-btn--on" : ""}`}
              onClick={() => setViewMode("flat")}
            >
              Flux continu
            </button>
            <button
              type="button"
              className={`ghost small job-timeline-logs__mode-btn${viewMode === "grouped" ? " job-timeline-logs__mode-btn--on" : ""}`}
              onClick={() => setViewMode("grouped")}
            >
              Par étapes
            </button>
          </div>
        ) : null}
      </div>

      {pipelineSummary ? (
        <p className="job-timeline-logs__pipeline-hint small">
          Pipeline prévu pour ce job : <strong>{pipelineSummary}</strong>
        </p>
      ) : null}

      {logs.length === 0 ? (
        <p className="small">Aucun log reçu pour ce job.</p>
      ) : viewMode === "grouped" && job && sectionsNewestFirst.length > 0 ? (
        <div className="job-timeline-sections">
          {sectionsNewestFirst.map((sec, idx) => (
            <section
              key={`${sec.id}-${idx}`}
              className="timeline-section"
              aria-labelledby={`timeline-section-title-${idx}`}
            >
              <h4 className="timeline-section__title" id={`timeline-section-title-${idx}`}>
                <span className="timeline-section__label">{sec.label}</span>
                {sec.hint ? (
                  <span className="timeline-section__hint" title={sec.hint}>
                    {sec.hint}
                  </span>
                ) : null}
                <span className="timeline-section__count">{sec.logs.length}</span>
              </h4>
              <ul className="timeline-list timeline-list--section">
                {sec.logs.map((log, li) => (
                  <li key={`${log.tsMs}-${li}-${log.message.slice(0, 24)}`}>
                    <LogLine log={log} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="timeline-list">
          {flatNewestFirst.map((log, idx) => (
            <li key={`${log.tsMs}-${idx}`}>
              <LogLine log={log} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
