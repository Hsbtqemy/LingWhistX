import type { RuntimeSetupLogEvent, RuntimeStatus } from "../types";

/** Props du panneau runtime local (UI + callbacks). Indépendant du composant React pour usage dans les hooks. */
export type LocalRuntimePanelProps = {
  runtimeReady: boolean;
  runtimeMissing: string[];
  runtimeLastCheckedAtMs: number | null;
  runtimeStatus: RuntimeStatus | null;
  isRuntimeLoading: boolean;
  isRuntimeTesting: boolean;
  runtimeSetupRunning: boolean;
  runtimeSetupMessage: string;
  runtimeSetupSuccess: boolean | null;
  runtimeActionMessage: string;
  runtimeActionSuccess: boolean | null;
  runtimeSetupLogs: RuntimeSetupLogEvent[];
  onRefreshRuntime: () => void;
  onRunSmokeTest: () => void;
  onCopyDiagnostic: () => void;
  onStartRuntimeSetup: () => void;
  onRefreshSetupStatus: () => void;
  onClearSetupLogs: () => void;
};
