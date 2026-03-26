import { useMemo } from "react";
import type { JobLogEvent } from "../../types";

export type JobTimelineLogsProps = {
  logs: JobLogEvent[];
};

export function JobTimelineLogs({ logs }: JobTimelineLogsProps) {
  /** Plus récent en haut (ordre chronologique inverse). */
  const logsNewestFirst = useMemo(() => [...logs].reverse(), [logs]);

  return (
    <div className="details-column" id="job-timeline-logs">
      <h3>Journal d&apos;exécution</h3>
      <ul className="timeline-list">
        {logs.length === 0 ? (
          <li className="small">Aucun log recu pour ce job.</li>
        ) : (
          logsNewestFirst.map((log, idx) => (
            <li key={`${log.tsMs}-${idx}`}>
              <span className="timeline-ts">{new Date(log.tsMs).toLocaleTimeString()}</span>
              <span className={`timeline-level ${log.level}`}>{log.level}</span>
              <span className="timeline-stage">{log.stage ? log.stage : "-"}</span>
              <span className="timeline-msg">{log.message}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
