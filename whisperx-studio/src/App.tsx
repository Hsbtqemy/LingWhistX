import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { StudioAboutView } from "./components/StudioAboutView";
import { StudioHero } from "./components/StudioHero";
import { StudioNav } from "./components/StudioNav";
import { StudioNewJobSection } from "./components/StudioNewJobSection";
import { StudioOpenRunSection } from "./components/StudioOpenRunSection";
import { StudioWorkspaceSection } from "./components/StudioWorkspaceSection";
import { useNewJobForm } from "./hooks/useNewJobForm";
import { useRuntimeDiagnostics } from "./hooks/useRuntimeDiagnostics";
import { useStudioWorkspace } from "./hooks/useStudioWorkspace";
import type { StudioView } from "./types";

function App() {
  const runDetailsRef = useRef<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<StudioView>("create");
  const [editorFocusMode, setEditorFocusMode] = useState(false);

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

  const { runtimeReady, runtimeCoreReady, localRuntimePanelProps, runtimeStatus } =
    useRuntimeDiagnostics({
      setError,
    });

  const { jobsHistory, runDetails, runningJobs, refreshJobs, setSelectedJobId, explorer } =
    useStudioWorkspace({
      runDetailsRef,
      setError,
      editorFocusMode,
      onToggleEditorFocusMode,
      runtimeStatus,
    });

  const jobForm = useNewJobForm({
    setError,
    setSelectedJobId,
    refreshJobs,
    runtimeReady,
    runtimeCoreReady,
  });

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
          />
          <StudioNewJobSection
            runningJobs={runningJobs}
            error={error}
            refreshJobs={refreshJobs}
            jobForm={jobForm}
            runtime={localRuntimePanelProps}
          />
        </div>
      ) : null}

      {!editorFocusMode && activeView === "about" ? (
        <StudioAboutView runtime={localRuntimePanelProps} />
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
