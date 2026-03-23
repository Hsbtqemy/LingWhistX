import type { JobLogEvent } from "../../types";

export type JobTimelineLogsProps = {
  logs: JobLogEvent[];
};

export function JobTimelineLogs({ logs }: JobTimelineLogsProps) {
  return (
    <div className="details-column">
      <h3>Timeline logs</h3>
      <ul className="timeline-list">
        {logs.length === 0 ? (
          <li className="small">Aucun log recu pour ce job.</li>
        ) : (
          logs.map((log, idx) => (
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
