import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { StudioAboutView } from "./components/StudioAboutView";
import { StudioHero } from "./components/StudioHero";
import { StudioNav } from "./components/StudioNav";
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

  return (
    <main className={`studio-shell ${editorFocusMode ? "studio-shell--editor-focus" : ""}`.trim()}>
      <StudioNav
        activeView={activeView}
        onViewChange={setActiveView}
        editorFocusMode={editorFocusMode}
        onExitEditorFocus={onExitEditorFocus}
      />

      {!editorFocusMode && activeView === "create" ? (
        <div className="home-page">
          <StudioHero />
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
      ) : null}

      {!editorFocusMode && activeView === "about" ? (
        <StudioAboutView runtime={localRuntimePanelProps} />
      ) : null}

      {!editorFocusMode && activeView === "player" ? (
        <PlayerWorkspaceSection
          runDir={playerRunDir}
          runLabel={playerRunLabel}
          onBack={handlePlayerBack}
        />
      ) : null}

      {(editorFocusMode || activeView === "workspace") && (
        <StudioWorkspaceSection
          jobsHistory={jobsHistory}
          runDetailsRef={runDetailsRef}
          runDetails={runDetails}
          explorer={explorer}
        />
      )}
    </main>
  );
}

export default App;
