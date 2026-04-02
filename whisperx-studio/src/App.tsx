import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { EditorPanel, type ActiveRun } from "./components/EditorPanel";
import { HelpDialog } from "./components/HelpDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { STUDIO_PANEL_IDS, STUDIO_TAB_IDS, StudioNav } from "./components/StudioNav";
import { PlayerWorkspaceSection } from "./components/player/PlayerWorkspaceSection";
import { StudioJobsSection } from "./components/StudioJobsSection";
import { StudioWorkspaceSection } from "./components/StudioWorkspaceSection";
import { useAppErrorStack } from "./hooks/useAppErrorStack";
import { useRuntimeDiagnostics } from "./hooks/useRuntimeDiagnostics";
import { useStudioWorkspace } from "./hooks/useStudioWorkspace";
import { fileBasename } from "./appUtils";
import type { StudioView, UiWhisperxOptions } from "./types";

const VIEW_STORAGE_KEY = "lx-studio-view";
const RUN_DIR_STORAGE_KEY = "lx-active-run-dir";
const RUN_LABEL_STORAGE_KEY = "lx-active-run-label";

function readStoredView(): StudioView {
  try {
    const v = sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (v === "import" || v === "editor" || v === "player" || v === "settings") return v;
  } catch {
    /* ignore */
  }
  return "import";
}

function readStoredRun(): ActiveRun | null {
  try {
    const dir = sessionStorage.getItem(RUN_DIR_STORAGE_KEY);
    const label = sessionStorage.getItem(RUN_LABEL_STORAGE_KEY);
    if (dir) return { runDir: dir, label: label ?? dir };
  } catch {
    /* ignore */
  }
  return null;
}

function App() {
  const runDetailsRef = useRef<HTMLElement | null>(null);
  const injectAudioPipelineSegmentsJsonRef = useRef<(json: string) => void>(() => {});
  const whisperxSetterRef = useRef<Dispatch<SetStateAction<UiWhisperxOptions>> | null>(null);

  const { errors: appErrors, setError } = useAppErrorStack();
  const [activeView, setActiveView] = useState<StudioView>(readStoredView);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(readStoredRun);
  const [playerEventsEpoch, setPlayerEventsEpoch] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable)
          return;
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, activeView);
    } catch {
      /* ignore */
    }
  }, [activeView]);

  useEffect(() => {
    try {
      if (activeRun) {
        sessionStorage.setItem(RUN_DIR_STORAGE_KEY, activeRun.runDir);
        sessionStorage.setItem(RUN_LABEL_STORAGE_KEY, activeRun.label);
      } else {
        sessionStorage.removeItem(RUN_DIR_STORAGE_KEY);
        sessionStorage.removeItem(RUN_LABEL_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [activeRun]);

  const handleOpenPlayer = useCallback((runDir: string, label?: string | null) => {
    setActiveRun({ runDir, label: label ?? runDir });
    setActiveView("player");
  }, []);

  const handleOpenEditor = useCallback((runDir: string, label?: string | null) => {
    setActiveRun({ runDir, label: label ?? runDir });
    setActiveView("editor");
  }, []);

  const handleAnnotationWrittenToPlayer = useCallback(() => {
    setPlayerEventsEpoch((e) => e + 1);
  }, []);

  const handlePlayerBack = useCallback(() => {
    setActiveView("import");
  }, []);

  const handleEditorOpenPlayer = useCallback(() => {
    if (activeRun) handleOpenPlayer(activeRun.runDir, activeRun.label);
    else setActiveView("import");
  }, [activeRun, handleOpenPlayer]);

  // WX-708 — auto-open Player quand un job passe running → done
  const handleJobBecameDone = useCallback(
    (job: import("./types").Job) => {
      handleOpenPlayer(job.outputDir, fileBasename(job.inputPath) || job.id);
    },
    [handleOpenPlayer],
  );

  const { runtimeReady, runtimeCoreReady, localRuntimePanelProps, runtimeStatus } =
    useRuntimeDiagnostics({ setError });

  const injectAudioPipelineSegmentsJson = useCallback((json: string) => {
    injectAudioPipelineSegmentsJsonRef.current(json);
  }, []);

  useEffect(() => {
    injectAudioPipelineSegmentsJsonRef.current = (json: string) => {
      whisperxSetterRef.current?.((prev) => ({ ...prev, audioPipelineSegmentsJson: json }));
    };
  }, []);

  const {
    jobsHistory,
    runDetails,
    runningJobs,
    refreshJobs,
    setSelectedJobId,
    jobForm,
    explorer,
    sessionRestore,
  } = useStudioWorkspace({
    runDetailsRef,
    setError,
    runtimeReady,
    runtimeCoreReady,
    runtimeStatus,
    onJobCreated: () => setActiveView("import"),
    injectAudioPipelineSegmentsJson,
    onOpenPlayerRun: handleOpenPlayer,
    onJobBecameDone: handleJobBecameDone,
    onNavigateToWorkspace: () => setActiveView("import"),
    onAnnotationWrittenToPlayer: handleAnnotationWrittenToPlayer,
  });

  const handlePlayerImportPick = useCallback(async () => {
    setError("");
    const path = await jobForm.pickInputPath();
    if (path) setActiveView("import");
  }, [jobForm, setError]);

  const handlePlayerImportDroppedPath = useCallback(
    (path: string) => {
      setError("");
      jobForm.setInputPath(path);
      jobForm.setJobFormStep("configure");
      setActiveView("import");
    },
    [jobForm, setError],
  );

  useEffect(() => {
    whisperxSetterRef.current = jobForm.setWhisperxOptions;
    return () => {
      whisperxSetterRef.current = null;
    };
  }, [jobForm.setWhisperxOptions]);

  return (
    <main className="studio-shell" data-testid="studio-app-root">
      <StudioNav
        activeView={activeView}
        onViewChange={setActiveView}
        workspaceHasActiveJobs={runningJobs > 0}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} activeView={activeView} />

      <div className="studio-shell__main">
        {/* ── Onglet Import (Studio + Jobs) ── */}
        <div
          id={STUDIO_PANEL_IDS.import}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.import}
          hidden={activeView !== "import"}
        >
          {activeView === "import" && (
            <>
              <StudioWorkspaceSection
                runDetailsRef={runDetailsRef}
                runDetails={runDetails}
                explorer={explorer}
                sessionRestore={sessionRestore}
                setError={setError}
                setActiveView={setActiveView}
                setSelectedJobId={setSelectedJobId}
                onOpenPlayer={handleOpenPlayer}
                runningJobs={runningJobs}
                errors={appErrors}
                refreshJobs={refreshJobs}
                jobForm={jobForm}
              />
              <StudioJobsSection jobsHistory={jobsHistory} />
            </>
          )}
        </div>

        {/* ── Onglet Éditeur ── */}
        <div
          id={STUDIO_PANEL_IDS.editor}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.editor}
          hidden={activeView !== "editor"}
        >
          {activeView === "editor" && (
            <EditorPanel
              activeRun={activeRun}
              onOpenPlayer={handleEditorOpenPlayer}
              onNavigate={setActiveView}
            />
          )}
        </div>

        {/* ── Onglet Player ── */}
        <div
          id={STUDIO_PANEL_IDS.player}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.player}
          hidden={activeView !== "player"}
        >
          {activeView === "player" && (
            <PlayerWorkspaceSection
              runDir={activeRun?.runDir ?? null}
              runLabel={activeRun?.label ?? null}
              onBack={handlePlayerBack}
              eventsRefreshEpoch={playerEventsEpoch}
              onToggleHelp={() => setHelpOpen((v) => !v)}
              onOpenEditor={handleOpenEditor}
              importMedia={{
                inputPath: jobForm.inputPath,
                isSubmitting: jobForm.isSubmitting,
                onPickFile: handlePlayerImportPick,
                onDroppedPath: handlePlayerImportDroppedPath,
                onImportError: setError,
              }}
            />
          )}
        </div>

        {/* ── Panneau Paramètres ── */}
        <div
          id={STUDIO_PANEL_IDS.settings}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.settings}
          hidden={activeView !== "settings"}
        >
          {activeView === "settings" && <SettingsPanel runtime={localRuntimePanelProps} />}
        </div>
      </div>
    </main>
  );
}

export default App;
