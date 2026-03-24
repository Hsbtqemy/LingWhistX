import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LocalRuntimePanelProps } from "../model/localRuntimePanel";
import { isRuntimeReady, runtimeFfmpegInstallHint, runtimeMissingComponents } from "../appUtils";
import type {
  RuntimeSetupFinishedEvent,
  RuntimeSetupLogEvent,
  RuntimeStatus,
  RuntimeSetupStatus,
} from "../types";

export type UseRuntimeDiagnosticsOptions = {
  setError: (message: string) => void;
};

export function useRuntimeDiagnostics({ setError }: UseRuntimeDiagnosticsOptions) {
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [runtimeSetupRunning, setRuntimeSetupRunning] = useState(false);
  const [runtimeSetupLogs, setRuntimeSetupLogs] = useState<RuntimeSetupLogEvent[]>([]);
  const [runtimeSetupMessage, setRuntimeSetupMessage] = useState("");
  const [runtimeSetupSuccess, setRuntimeSetupSuccess] = useState<boolean | null>(null);
  const [runtimeLastCheckedAtMs, setRuntimeLastCheckedAtMs] = useState<number | null>(null);
  const [isRuntimeTesting, setIsRuntimeTesting] = useState(false);
  const [runtimeActionMessage, setRuntimeActionMessage] = useState("");
  const [runtimeActionSuccess, setRuntimeActionSuccess] = useState<boolean | null>(null);
  const [ffmpegInstallRunning, setFfmpegInstallRunning] = useState(false);
  const [ffmpegInstallLogs, setFfmpegInstallLogs] = useState<RuntimeSetupLogEvent[]>([]);
  const [ffmpegInstallMessage, setFfmpegInstallMessage] = useState("");
  const [ffmpegInstallSuccess, setFfmpegInstallSuccess] = useState<boolean | null>(null);

  const runtimeReady = useMemo(() => isRuntimeReady(runtimeStatus), [runtimeStatus]);
  const runtimeCoreReady = useMemo(
    () => Boolean(runtimeStatus?.pythonOk && runtimeStatus?.whisperxOk),
    [runtimeStatus],
  );
  const runtimeMissing = useMemo(() => runtimeMissingComponents(runtimeStatus), [runtimeStatus]);

  const refreshRuntimeStatus = useCallback(async (): Promise<RuntimeStatus | null> => {
    setIsRuntimeLoading(true);
    try {
      const status = await invoke<RuntimeStatus>("get_runtime_status");
      setRuntimeStatus(status);
      setRuntimeLastCheckedAtMs(Date.now());
      return status;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setIsRuntimeLoading(false);
    }
  }, [setError]);

  const refreshRuntimeStatusWithRetry = useCallback(
    async (attempts = 1, delayMs = 1200): Promise<RuntimeStatus | null> => {
      let latest: RuntimeStatus | null = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        latest = await refreshRuntimeStatus();
        if (isRuntimeReady(latest)) {
          return latest;
        }
        if (attempt < attempts) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
      return latest;
    },
    [refreshRuntimeStatus],
  );

  const refreshRuntimeSetupStatus = useCallback(async () => {
    try {
      const status = await invoke<RuntimeSetupStatus>("get_runtime_setup_status");
      setRuntimeSetupRunning(status.running);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const refreshFfmpegInstallStatus = useCallback(async () => {
    try {
      const status = await invoke<RuntimeSetupStatus>("get_ffmpeg_install_status");
      setFfmpegInstallRunning(status.running);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const startRuntimeSetup = useCallback(async () => {
    setError("");
    setRuntimeSetupMessage("");
    setRuntimeSetupSuccess(null);
    setRuntimeSetupLogs([]);
    setRuntimeActionMessage("");
    setRuntimeActionSuccess(null);
    try {
      await invoke("start_runtime_setup");
      setRuntimeSetupRunning(true);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const startFfmpegInstall = useCallback(async () => {
    setError("");
    setFfmpegInstallMessage("");
    setFfmpegInstallSuccess(null);
    setFfmpegInstallLogs([]);
    setRuntimeActionMessage("");
    setRuntimeActionSuccess(null);
    try {
      await invoke("start_ffmpeg_install");
      setFfmpegInstallRunning(true);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const runRuntimeSmokeTest = useCallback(async () => {
    setRuntimeActionMessage("");
    setRuntimeActionSuccess(null);
    setIsRuntimeTesting(true);
    try {
      const status = await refreshRuntimeStatusWithRetry(1);
      if (isRuntimeReady(status)) {
        setRuntimeActionSuccess(true);
        setRuntimeActionMessage("Test runtime OK: Python + WhisperX + ffmpeg operationnels.");
        return;
      }
      const missing = runtimeMissingComponents(status);
      setRuntimeActionSuccess(false);
      let msg = `Test runtime KO: composant(s) manquant(s): ${missing.join(", ")}.`;
      if (missing.includes("ffmpeg")) {
        msg += ` ${runtimeFfmpegInstallHint()}`;
      }
      setRuntimeActionMessage(msg);
    } finally {
      setIsRuntimeTesting(false);
    }
  }, [refreshRuntimeStatusWithRetry]);

  const buildRuntimeDiagnosticText = useCallback(
    (status: RuntimeStatus | null): string => {
      const lines: string[] = [];
      lines.push("LingWhistX - Diagnostic runtime");
      lines.push(`Generated at: ${new Date().toISOString()}`);
      lines.push(`Runtime ready: ${isRuntimeReady(status) ? "yes" : "no"}`);
      const missing = runtimeMissingComponents(status);
      if (missing.length > 0) {
        lines.push(`Missing: ${missing.join(", ")}`);
      }
      if (status) {
        lines.push(`Python command: ${status.pythonCommand}`);
        if (status.whisperxVersion) {
          lines.push(`WhisperX version: ${status.whisperxVersion}`);
        }
        lines.push("Details:");
        for (const detail of status.details) {
          lines.push(`- ${detail}`);
        }
        if (!status.ffmpegOk) {
          lines.push("");
          lines.push(`Note ffmpeg: ${runtimeFfmpegInstallHint()}`);
        }
      } else {
        lines.push("No runtime status available.");
      }
      if (runtimeSetupMessage) {
        lines.push(`Setup message: ${runtimeSetupMessage}`);
        lines.push(
          `Setup success: ${runtimeSetupSuccess === true ? "yes" : runtimeSetupSuccess === false ? "no" : "unknown"}`,
        );
      }
      return lines.join("\n");
    },
    [runtimeSetupMessage, runtimeSetupSuccess],
  );

  const copyRuntimeDiagnostic = useCallback(async () => {
    const text = buildRuntimeDiagnosticText(runtimeStatus);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setRuntimeActionSuccess(true);
      setRuntimeActionMessage("Diagnostic runtime copie dans le presse-papiers.");
    } catch {
      setRuntimeActionSuccess(false);
      setRuntimeActionMessage("Impossible de copier le diagnostic runtime.");
    }
  }, [buildRuntimeDiagnosticText, runtimeStatus]);

  useEffect(() => {
    void refreshRuntimeStatus();
    void refreshRuntimeSetupStatus();
    void refreshFfmpegInstallStatus();
  }, [refreshRuntimeStatus, refreshRuntimeSetupStatus, refreshFfmpegInstallStatus]);

  useEffect(() => {
    const unlistenRuntimeSetupLogPromise = listen<RuntimeSetupLogEvent>(
      "runtime-setup-log",
      (event) => {
        setRuntimeSetupLogs((current) => [...current, event.payload].slice(-1200));
      },
    );

    const unlistenRuntimeSetupFinishedPromise = listen<RuntimeSetupFinishedEvent>(
      "runtime-setup-finished",
      (event) => {
        setRuntimeSetupRunning(false);
        setRuntimeSetupMessage(event.payload.message);
        setRuntimeSetupSuccess(event.payload.success);
        setRuntimeActionMessage("");
        setRuntimeActionSuccess(null);
        if (event.payload.success) {
          void (async () => {
            const status = await refreshRuntimeStatusWithRetry(6, 1500);
            if (isRuntimeReady(status)) {
              setRuntimeSetupSuccess(true);
              setRuntimeSetupMessage("Installation terminee. Runtime local pret.");
            } else {
              setRuntimeSetupSuccess(false);
              const missing = runtimeMissingComponents(status);
              let setupMsg = `Installation terminee, mais runtime incomplet (${missing.join(", ")} manquant${missing.length > 1 ? "s" : ""}). Clique sur « Vérifier le runtime ».`;
              if (missing.includes("ffmpeg")) {
                setupMsg += ` ${runtimeFfmpegInstallHint()}`;
              }
              setRuntimeSetupMessage(setupMsg);
            }
          })();
        } else {
          void refreshRuntimeStatus();
        }
        void refreshRuntimeSetupStatus();
      },
    );

    const unlistenFfmpegLogPromise = listen<RuntimeSetupLogEvent>("ffmpeg-install-log", (event) => {
      setFfmpegInstallLogs((current) => [...current, event.payload].slice(-1200));
    });

    const unlistenFfmpegFinishedPromise = listen<RuntimeSetupFinishedEvent>(
      "ffmpeg-install-finished",
      (event) => {
        setFfmpegInstallRunning(false);
        setFfmpegInstallMessage(event.payload.message);
        setFfmpegInstallSuccess(event.payload.success);
        setRuntimeActionMessage("");
        setRuntimeActionSuccess(null);
        if (event.payload.success) {
          void (async () => {
            await refreshRuntimeStatusWithRetry(4, 1200);
          })();
        } else {
          void refreshRuntimeStatus();
        }
        void refreshFfmpegInstallStatus();
      },
    );

    return () => {
      void unlistenRuntimeSetupLogPromise.then((unlisten) => unlisten());
      void unlistenRuntimeSetupFinishedPromise.then((unlisten) => unlisten());
      void unlistenFfmpegLogPromise.then((unlisten) => unlisten());
      void unlistenFfmpegFinishedPromise.then((unlisten) => unlisten());
    };
  }, [
    refreshRuntimeStatus,
    refreshRuntimeStatusWithRetry,
    refreshRuntimeSetupStatus,
    refreshFfmpegInstallStatus,
  ]);

  const localRuntimePanelProps = useMemo<LocalRuntimePanelProps>(
    () => ({
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
      onRefreshRuntime: () => void refreshRuntimeStatus(),
      onRunSmokeTest: () => void runRuntimeSmokeTest(),
      onCopyDiagnostic: () => void copyRuntimeDiagnostic(),
      onStartRuntimeSetup: startRuntimeSetup,
      onRefreshSetupStatus: refreshRuntimeSetupStatus,
      onClearSetupLogs: () => {
        setRuntimeSetupLogs([]);
        setRuntimeSetupMessage("");
        setRuntimeSetupSuccess(null);
      },
      onStartFfmpegInstall: startFfmpegInstall,
      onClearFfmpegInstallLogs: () => {
        setFfmpegInstallLogs([]);
        setFfmpegInstallMessage("");
        setFfmpegInstallSuccess(null);
      },
    }),
    [
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
      refreshRuntimeStatus,
      runRuntimeSmokeTest,
      copyRuntimeDiagnostic,
      startRuntimeSetup,
      refreshRuntimeSetupStatus,
      startFfmpegInstall,
    ],
  );

  return {
    runtimeStatus,
    isRuntimeLoading,
    runtimeSetupRunning,
    runtimeSetupLogs,
    runtimeSetupMessage,
    runtimeSetupSuccess,
    runtimeLastCheckedAtMs,
    isRuntimeTesting,
    runtimeActionMessage,
    runtimeActionSuccess,
    runtimeReady,
    runtimeCoreReady,
    runtimeMissing,
    refreshRuntimeStatus,
    refreshRuntimeSetupStatus,
    startRuntimeSetup,
    runRuntimeSmokeTest,
    copyRuntimeDiagnostic,
    setRuntimeSetupLogs,
    setRuntimeSetupMessage,
    setRuntimeSetupSuccess,
    localRuntimePanelProps,
  };
}
