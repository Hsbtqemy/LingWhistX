import type { LocalRuntimePanelProps } from "../model/localRuntimePanel";

export type { LocalRuntimePanelProps } from "../model/localRuntimePanel";

export function LocalRuntimePanel({
  runtimeReady,
  runtimeMissing,
  runtimeLastCheckedAtMs,
  runtimeStatus,
  isRuntimeLoading,
  isRuntimeTesting,
  runtimeSetupRunning,
  runtimeSetupMessage,
  runtimeSetupSuccess,
  runtimeActionMessage,
  runtimeActionSuccess,
  runtimeSetupLogs,
  onRefreshRuntime,
  onRunSmokeTest,
  onCopyDiagnostic,
  onStartRuntimeSetup,
  onRefreshSetupStatus,
  onClearSetupLogs,
}: LocalRuntimePanelProps) {
  return (
    <div className={`runtime-box ${runtimeReady ? "ok" : "warn"}`}>
      <div className="runtime-header-row">
        <h3>Runtime local</h3>
        <div className="runtime-header-actions">
          <button
            type="button"
            className="ghost"
            onClick={onRefreshRuntime}
            disabled={isRuntimeLoading || runtimeSetupRunning || isRuntimeTesting}
          >
            {isRuntimeLoading ? "Vérification…" : "Vérifier le runtime"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onRunSmokeTest}
            disabled={isRuntimeLoading || runtimeSetupRunning || isRuntimeTesting}
          >
            {isRuntimeTesting ? "Test en cours…" : "Tester le runtime"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onCopyDiagnostic}
            disabled={!runtimeStatus}
          >
            Copier diagnostic
          </button>
        </div>
      </div>
      {!runtimeStatus ? (
        <p className="small">Aucun diagnostic runtime disponible pour l'instant.</p>
      ) : (
        <>
          <div className={`runtime-readiness ${runtimeReady ? "ready" : "pending"}`}>
            {runtimeReady ? (
              <p className="runtime-readiness-title">
                Runtime local prêt : Python + WhisperX + ffmpeg détectés.
              </p>
            ) : (
              <p className="runtime-readiness-title">
                Runtime local incomplet
                {runtimeMissing.length > 0
                  ? ` (${runtimeMissing.join(", ")} manquant${runtimeMissing.length > 1 ? "s" : ""})`
                  : ""}
                .
              </p>
            )}
            {runtimeLastCheckedAtMs ? (
              <p className="small">
                Dernière vérification : {new Date(runtimeLastCheckedAtMs).toLocaleTimeString()}
              </p>
            ) : null}
          </div>
          <p className="small">
            Python: {runtimeStatus.pythonOk ? "ok" : "ko"} | WhisperX:{" "}
            {runtimeStatus.whisperxOk ? "ok" : "ko"} | ffmpeg:{" "}
            {runtimeStatus.ffmpegOk ? "ok" : "ko"}
          </p>
          {runtimeSetupMessage ? (
            <p
              className={`runtime-setup-feedback ${runtimeSetupSuccess === false ? "error" : "ok"}`}
            >
              {runtimeSetupMessage}
            </p>
          ) : null}
          {runtimeActionMessage ? (
            <p
              className={`runtime-setup-feedback ${runtimeActionSuccess === false ? "error" : "ok"}`}
            >
              {runtimeActionMessage}
            </p>
          ) : null}
          <p className="small mono">Commande Python: {runtimeStatus.pythonCommand}</p>
          {runtimeStatus.whisperxVersion ? (
            <p className="small">WhisperX version: {runtimeStatus.whisperxVersion}</p>
          ) : null}
          {!runtimeReady ? (
            <div className="runtime-setup-box">
              <p className="small">
                Assistant first-run: installe un runtime local Python + WhisperX sans Docker.
              </p>
              <div className="runtime-setup-actions">
                <button type="button" onClick={onStartRuntimeSetup} disabled={runtimeSetupRunning}>
                  {runtimeSetupRunning ? "Installation en cours..." : "Installer runtime local"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={onRefreshSetupStatus}
                  disabled={runtimeSetupRunning}
                >
                  Vérifier le setup
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={onClearSetupLogs}
                  disabled={runtimeSetupRunning || runtimeSetupLogs.length === 0}
                >
                  Effacer logs setup
                </button>
              </div>
              {runtimeSetupLogs.length > 0 ? (
                <ul className="runtime-setup-log-list">
                  {runtimeSetupLogs.map((entry, idx) => (
                    <li key={`${entry.tsMs}-${idx}`}>
                      <span className="mono">[{new Date(entry.tsMs).toLocaleTimeString()}]</span>{" "}
                      <strong>{entry.stream}</strong> {entry.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <ul className="runtime-details">
            {runtimeStatus.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
