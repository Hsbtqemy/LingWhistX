import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { HelpDialog } from "./components/HelpDialog";
import { HomeHub } from "./components/HomeHub";
import { StudioAboutView } from "./components/StudioAboutView";
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
  const [playerInitialEditMode, setPlayerInitialEditMode] = useState(false);
  /** WX-696 — Incrémenté après écriture de tiers annotation dans events.sqlite. */
  const [playerEventsEpoch, setPlayerEventsEpoch] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
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

  const handleOpenPlayer = useCallback(
    (runDir: string, label?: string | null, editMode?: boolean) => {
      setPlayerRunDir(runDir);
      setPlayerRunLabel(label ?? runDir);
      setPlayerInitialEditMode(editMode ?? false);
      setActiveView("player");
    },
    [],
  );

  const handleAnnotationWrittenToPlayer = useCallback(() => {
    setPlayerEventsEpoch((e) => e + 1);
  }, []);

  const handlePlayerBack = useCallback((view: StudioView) => {
    setActiveView(view);
  }, []);

  // WX-708 — auto-open Player quand un job passe running → done
  const handleJobBecameDone = useCallback(
    (job: import("./types").Job) => {
      handleOpenPlayer(job.outputDir, fileBasename(job.inputPath) || job.id);
    },
    [handleOpenPlayer],
  );

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
    onJobBecameDone: handleJobBecameDone,
    onNavigateToWorkspace: () => setActiveView("workspace"),
    onAnnotationWrittenToPlayer: handleAnnotationWrittenToPlayer,
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
    <main className="studio-shell" data-testid="studio-app-root">
      {showStudioNav ? (
        <StudioNav
          activeView={activeView}
          onViewChange={setActiveView}
          workspaceHasActiveJobs={runningJobs > 0}
          onToggleHelp={() => setHelpOpen((v) => !v)}
        />
      ) : null}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} activeView={activeView} />

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
              eventsRefreshEpoch={playerEventsEpoch}
              initialEditMode={playerInitialEditMode}
              onToggleHelp={() => setHelpOpen((v) => !v)}
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
