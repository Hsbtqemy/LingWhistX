import { memo } from "react";
import type { LocalRuntimePanelProps } from "../model/localRuntimePanel";

export type { LocalRuntimePanelProps } from "../model/localRuntimePanel";

function LocalRuntimePanelComponent({
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
  ffmpegInstallRunning,
  ffmpegInstallLogs,
  ffmpegInstallMessage,
  ffmpegInstallSuccess,
  onRefreshRuntime,
  onRunSmokeTest,
  onCopyDiagnostic,
  onStartRuntimeSetup,
  onRefreshSetupStatus,
  onClearSetupLogs,
  onStartFfmpegInstall,
  onClearFfmpegInstallLogs,
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
            disabled={
              isRuntimeLoading || runtimeSetupRunning || isRuntimeTesting || ffmpegInstallRunning
            }
          >
            {isRuntimeLoading ? "Vérification…" : "Vérifier le runtime"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onRunSmokeTest}
            disabled={
              isRuntimeLoading || runtimeSetupRunning || isRuntimeTesting || ffmpegInstallRunning
            }
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
          {!runtimeStatus.ffmpegOk ? (
            <div className="runtime-ffmpeg-hint">
              <p className="small">
                <strong>ffmpeg</strong> sert à décoder les médias et aux jobs WhisperX. Il n’est{" "}
                <strong>pas</strong> installé par « Installer runtime local » (seulement Python +
                WhisperX dans un venv).
              </p>
              <div className="runtime-ffmpeg-install">
                <button
                  type="button"
                  onClick={onStartFfmpegInstall}
                  disabled={
                    ffmpegInstallRunning ||
                    runtimeSetupRunning ||
                    isRuntimeLoading ||
                    isRuntimeTesting
                  }
                >
                  {ffmpegInstallRunning ? "Installation ffmpeg…" : "Installer ffmpeg (automatique)"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={onClearFfmpegInstallLogs}
                  disabled={ffmpegInstallRunning || ffmpegInstallLogs.length === 0}
                >
                  Effacer logs ffmpeg
                </button>
              </div>
              <p className="small">
                macOS / Linux : utilise <strong>Homebrew</strong> (
                <code className="mono">brew install ffmpeg</code>) si{" "}
                <code className="mono">brew</code> est disponible. Windows : <strong>winget</strong>{" "}
                (Gyan.FFmpeg) ou <strong>Chocolatey</strong>. Sinon installe ffmpeg à la main et
                définis <code className="mono">FFMPEG_BINARY</code> /{" "}
                <code className="mono">FFPROBE_BINARY</code>.
              </p>
              {ffmpegInstallMessage ? (
                <p
                  className={`small runtime-setup-feedback ${ffmpegInstallSuccess === false ? "error" : "ok"}`}
                >
                  {ffmpegInstallMessage}
                </p>
              ) : null}
              {ffmpegInstallLogs.length > 0 ? (
                <ul className="runtime-setup-log-list">
                  {ffmpegInstallLogs.map((entry, idx) => (
                    <li key={`ff-${entry.tsMs}-${idx}`}>
                      <span className="mono">[{new Date(entry.tsMs).toLocaleTimeString()}]</span>{" "}
                      <strong>{entry.stream}</strong> {entry.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
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

export const LocalRuntimePanel = memo(LocalRuntimePanelComponent);
