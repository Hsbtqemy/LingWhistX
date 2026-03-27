import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { HomeCreatePanel } from "./components/HomeCreatePanel";
import { StudioAboutView } from "./components/StudioAboutView";
import { StudioHero } from "./components/StudioHero";
import { STUDIO_PANEL_IDS, STUDIO_TAB_IDS, StudioNav } from "./components/StudioNav";
import { PlayerWorkspaceSection } from "./components/player/PlayerWorkspaceSection";
import { StudioWorkspaceSection } from "./components/StudioWorkspaceSection";
import { useAppErrorStack } from "./hooks/useAppErrorStack";
import { useRuntimeDiagnostics } from "./hooks/useRuntimeDiagnostics";
import { useStudioWorkspace } from "./hooks/useStudioWorkspace";
import type { StudioView, UiWhisperxOptions } from "./types";

const VIEW_STORAGE_KEY = "lx-studio-view";

function readStoredView(): StudioView {
  try {
    const v = sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (v === "create" || v === "workspace" || v === "player" || v === "about") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "create";
}

function App() {
  const runDetailsRef = useRef<HTMLElement | null>(null);
  const injectAudioPipelineSegmentsJsonRef = useRef<(json: string) => void>(() => {});
  const whisperxSetterRef = useRef<Dispatch<SetStateAction<UiWhisperxOptions>> | null>(null);
  /** Erreurs shell (max 5) — rendu `ErrorBanner` / tokens `--lx-danger` (WX-634). */
  const { errors: appErrors, setError } = useAppErrorStack();
  const [activeView, setActiveView] = useState<StudioView>(readStoredView);
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
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, activeView);
    } catch {
      /* ignore */
    }
  }, [activeView]);

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
    explorer,
    sessionRestore,
  } = useStudioWorkspace({
    runDetailsRef,
    setError,
    editorFocusMode,
    onToggleEditorFocusMode,
    runtimeStatus,
    injectAudioPipelineSegmentsJson,
  });

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
        workspaceHasActiveJobs={runningJobs > 0}
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
                <HomeCreatePanel
                  setError={setError}
                  setActiveView={setActiveView}
                  setSelectedJobId={setSelectedJobId}
                  onOpenPlayer={handleOpenPlayer}
                  refreshJobs={refreshJobs}
                  runtimeReady={runtimeReady}
                  runtimeCoreReady={runtimeCoreReady}
                  runtimeStatus={runtimeStatus}
                  runningJobs={runningJobs}
                  errors={appErrors}
                  runtime={localRuntimePanelProps}
                  whisperxSetterRef={whisperxSetterRef}
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
              sessionRestore={sessionRestore}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default App;
