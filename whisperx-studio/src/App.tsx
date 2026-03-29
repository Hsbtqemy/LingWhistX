import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { HomeHub } from "./components/HomeHub";
import { StudioAboutView } from "./components/StudioAboutView";
import { STUDIO_PANEL_IDS, STUDIO_TAB_IDS, StudioNav } from "./components/StudioNav";
import { PlayerWorkspaceSection } from "./components/player/PlayerWorkspaceSection";
import { StudioJobsSection } from "./components/StudioJobsSection";
import { StudioWorkspaceSection } from "./components/StudioWorkspaceSection";
import { useAppErrorStack } from "./hooks/useAppErrorStack";
import { useRuntimeDiagnostics } from "./hooks/useRuntimeDiagnostics";
import { useStudioWorkspace } from "./hooks/useStudioWorkspace";
import type { StudioView, UiWhisperxOptions } from "./types";

const VIEW_STORAGE_KEY = "lx-studio-view";

function readStoredView(): StudioView {
  try {
    const v = sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (v === "create" || v === "workspace" || v === "jobs" || v === "player" || v === "about") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "workspace";
}

function App() {
  const runDetailsRef = useRef<HTMLElement | null>(null);
  const injectAudioPipelineSegmentsJsonRef = useRef<(json: string) => void>(() => {});
  const whisperxSetterRef = useRef<Dispatch<SetStateAction<UiWhisperxOptions>> | null>(null);
  /** Erreurs shell (max 5) — rendu `ErrorBanner` / tokens `--lx-danger` (WX-634). */
  const { errors: appErrors, setError } = useAppErrorStack();
  const [activeView, setActiveView] = useState<StudioView>(readStoredView);
  const [playerRunDir, setPlayerRunDir] = useState<string | null>(null);
  const [playerRunLabel, setPlayerRunLabel] = useState<string | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, activeView);
    } catch {
      /* ignore */
    }
  }, [activeView]);

  const handleOpenPlayer = useCallback((runDir: string, label?: string | null) => {
    setPlayerRunDir(runDir);
    setPlayerRunLabel(label ?? runDir);
    setActiveView("player");
  }, []);

  const handlePlayerBack = useCallback((view: StudioView) => {
    setActiveView(view);
  }, []);

  const { runtimeReady, runtimeCoreReady, localRuntimePanelProps, runtimeStatus } =
    useRuntimeDiagnostics({
      setError,
    });

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
    onJobCreated: () => setActiveView("workspace"),
    injectAudioPipelineSegmentsJson,
    onOpenPlayerRun: handleOpenPlayer,
    onNavigateToWorkspace: () => setActiveView("workspace"),
  });

  const handlePlayerImportPick = useCallback(async () => {
    setError("");
    const path = await jobForm.pickInputPath();
    if (path) {
      setActiveView("workspace");
    }
  }, [jobForm, setError]);

  const handlePlayerImportDroppedPath = useCallback(
    (path: string) => {
      setError("");
      jobForm.setInputPath(path);
      jobForm.setJobFormStep("configure");
      setActiveView("workspace");
    },
    [jobForm, setError],
  );

  useEffect(() => {
    whisperxSetterRef.current = jobForm.setWhisperxOptions;
    return () => {
      whisperxSetterRef.current = null;
    };
  }, [jobForm.setWhisperxOptions]);

  const showCreatePanel = activeView === "create";
  const showAboutPanel = activeView === "about";
  const showJobsPanel = activeView === "jobs";
  const showPlayerPanel = activeView === "player";
  const showWorkspacePanel = activeView === "workspace";
  /** Barre d’onglets masquée sur l’accueil (cartes = navigation), affichée ailleurs. */
  const showStudioNav = activeView !== "create";

  return (
    <main className="studio-shell">
      {showStudioNav ? (
        <StudioNav
          activeView={activeView}
          onViewChange={setActiveView}
          workspaceHasActiveJobs={runningJobs > 0}
        />
      ) : null}

      <div className="studio-shell__main">
        <div
          id={STUDIO_PANEL_IDS.create}
          role="tabpanel"
          aria-labelledby={
            showCreatePanel ? "hero-title" : STUDIO_TAB_IDS.create
          }
          hidden={!showCreatePanel}
        >
          {showCreatePanel ? (
            <div className="home-page home-page--minimal">
              <HomeHub
                setActiveView={setActiveView}
                runtimeReady={runtimeReady}
                runtimeStatus={runtimeStatus}
              />
            </div>
          ) : null}
        </div>

        <div
          id={STUDIO_PANEL_IDS.about}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.about}
          hidden={!showAboutPanel}
        >
          {showAboutPanel ? <StudioAboutView runtime={localRuntimePanelProps} /> : null}
        </div>

        <div
          id={STUDIO_PANEL_IDS.jobs}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.jobs}
          hidden={!showJobsPanel}
        >
          {showJobsPanel ? <StudioJobsSection jobsHistory={jobsHistory} /> : null}
        </div>

        <div
          id={STUDIO_PANEL_IDS.player}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.player}
          hidden={!showPlayerPanel}
        >
          {showPlayerPanel ? (
            <PlayerWorkspaceSection
              runDir={playerRunDir}
              runLabel={playerRunLabel}
              onBack={handlePlayerBack}
              importMedia={{
                inputPath: jobForm.inputPath,
                isSubmitting: jobForm.isSubmitting,
                onPickFile: handlePlayerImportPick,
                onDroppedPath: handlePlayerImportDroppedPath,
                onImportError: setError,
              }}
            />
          ) : null}
        </div>

        <div
          id={STUDIO_PANEL_IDS.workspace}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.workspace}
          hidden={!showWorkspacePanel}
        >
          {showWorkspacePanel ? (
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
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default App;
