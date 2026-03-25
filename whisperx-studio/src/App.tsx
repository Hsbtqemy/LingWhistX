import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { StudioAboutView } from "./components/StudioAboutView";
import { StudioHero } from "./components/StudioHero";
import { STUDIO_PANEL_IDS, STUDIO_TAB_IDS, StudioNav } from "./components/StudioNav";
import { StudioNewJobSection } from "./components/StudioNewJobSection";
import { StudioOpenRunSection } from "./components/StudioOpenRunSection";
import { PlayerWorkspaceSection } from "./components/player/PlayerWorkspaceSection";
import { StudioWorkspaceSection } from "./components/StudioWorkspaceSection";
import { useAppErrorStack } from "./hooks/useAppErrorStack";
import { useNewJobForm } from "./hooks/useNewJobForm";
import { useRuntimeDiagnostics } from "./hooks/useRuntimeDiagnostics";
import { useStudioWorkspace } from "./hooks/useStudioWorkspace";
import type { StudioView } from "./types";

function App() {
  const runDetailsRef = useRef<HTMLElement | null>(null);
  const injectAudioPipelineSegmentsJsonRef = useRef<(json: string) => void>(() => {});
  /** Erreurs shell (max 5) — rendu `ErrorBanner` / tokens `--lx-danger` (WX-634). */
  const { errors: appErrors, setError } = useAppErrorStack();
  const [activeView, setActiveView] = useState<StudioView>("create");
  const [editorFocusMode, setEditorFocusMode] = useState(false);
  const [playerRunDir, setPlayerRunDir] = useState<string | null>(null);
  const [playerRunLabel, setPlayerRunLabel] = useState<string | null>(null);

  const onToggleEditorFocusMode = useCallback(() => {
    setEditorFocusMode((prev) => {
      const next = !prev;
      if (next) {
        setActiveView("workspace");
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeView !== "workspace") {
      setEditorFocusMode(false);
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

  const { jobsHistory, runDetails, runningJobs, refreshJobs, setSelectedJobId, explorer } =
    useStudioWorkspace({
      runDetailsRef,
      setError,
      editorFocusMode,
      onToggleEditorFocusMode,
      runtimeStatus,
      injectAudioPipelineSegmentsJson,
    });

  const jobForm = useNewJobForm({
    setError,
    setSelectedJobId,
    refreshJobs,
    runtimeReady,
    runtimeCoreReady,
  });

  useEffect(() => {
    injectAudioPipelineSegmentsJsonRef.current = (json: string) => {
      jobForm.setWhisperxOptions((prev) => ({ ...prev, audioPipelineSegmentsJson: json }));
    };
  }, [jobForm.setWhisperxOptions]);

  const onExitEditorFocus = useCallback(() => {
    setEditorFocusMode(false);
  }, []);

  const showCreatePanel = !editorFocusMode && activeView === "create";
  const showAboutPanel = !editorFocusMode && activeView === "about";
  const showPlayerPanel = !editorFocusMode && activeView === "player";
  const showWorkspacePanel = editorFocusMode || activeView === "workspace";

  return (
    <main className={`studio-shell ${editorFocusMode ? "studio-shell--editor-focus" : ""}`.trim()}>
      <StudioNav
        activeView={activeView}
        onViewChange={setActiveView}
        editorFocusMode={editorFocusMode}
        onExitEditorFocus={onExitEditorFocus}
      />

      <div className="studio-shell__main">
        <div
          id={STUDIO_PANEL_IDS.create}
          role="tabpanel"
          aria-labelledby={STUDIO_TAB_IDS.create}
          hidden={!showCreatePanel}
        >
          {showCreatePanel ? (
            <div className="home-page">
              <StudioHero />
              <div
                className="home-page__content"
                role="region"
                aria-label="Fichiers et traitements"
              >
                <StudioOpenRunSection
                  setError={setError}
                  setActiveView={setActiveView}
                  setSelectedJobId={setSelectedJobId}
                  onOpenPlayer={handleOpenPlayer}
                />
                <StudioNewJobSection
                  runningJobs={runningJobs}
                  errors={appErrors}
                  refreshJobs={refreshJobs}
                  jobForm={jobForm}
                  runtime={localRuntimePanelProps}
                />
              </div>
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
            />
          ) : null}
        </div>

        <div
          id={STUDIO_PANEL_IDS.workspace}
          role={editorFocusMode ? "region" : "tabpanel"}
          aria-labelledby={editorFocusMode ? undefined : STUDIO_TAB_IDS.workspace}
          aria-label={editorFocusMode ? "Workspace — mode focus éditeur" : undefined}
          hidden={!showWorkspacePanel}
        >
          {showWorkspacePanel ? (
            <StudioWorkspaceSection
              jobsHistory={jobsHistory}
              runDetailsRef={runDetailsRef}
              runDetails={runDetails}
              explorer={explorer}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default App;
