import { useState } from "react";
import type { RefObject } from "react";
import type { StudioExplorerModel } from "../hooks/useStudioExplorer";
import { JobsHistoryPanel, type JobsHistoryPanelProps } from "./JobsHistoryPanel";
import { RunDetailsPanel, type RunDetailsPanelProps } from "./runDetails/RunDetailsPanel";
import { SessionRestoreBanner } from "./SessionRestoreBanner";
import type { SessionRestoreBannerProps } from "./SessionRestoreBanner";
import { StudioExplorerSidePanels, StudioExplorerTopBar } from "./StudioExplorerChrome";

export type StudioWorkspaceSectionProps = {
  jobsHistory: JobsHistoryPanelProps;
  runDetailsRef: RefObject<HTMLElement | null>;
  runDetails: RunDetailsPanelProps;
  explorer: StudioExplorerModel;
  sessionRestore: Pick<SessionRestoreBannerProps, "prompt" | "onRestore" | "onDismiss">;
};

export function StudioWorkspaceSection({
  jobsHistory,
  runDetailsRef,
  runDetails,
  explorer,
  sessionRestore,
}: StudioWorkspaceSectionProps) {
  /** Replié par défaut : le détail du run reste prioritaire visuellement. */
  const [explorerParamsOpen, setExplorerParamsOpen] = useState(false);

  return (
    <div className="studio-workspace-layout">
      <SessionRestoreBanner
        prompt={sessionRestore.prompt}
        onRestore={sessionRestore.onRestore}
        onDismiss={sessionRestore.onDismiss}
      />
      <StudioExplorerTopBar explorer={explorer} />
      <div className="studio-workspace-body studio-workspace-body--run-primary">
        <div
          className="studio-workspace-primary studio-workspace-primary--surface"
          aria-label="Détail du run et transcript"
        >
          <RunDetailsPanel ref={runDetailsRef} {...runDetails} />
        </div>
        <div className="studio-workspace-secondary" aria-label="Historique des jobs et paramètres">
          <div className="studio-workspace-secondary-stack">
            <div className="studio-jobs-rail studio-workspace-rail-card">
              <JobsHistoryPanel {...jobsHistory} />
            </div>
            <details
              className="studio-explorer-params"
              open={explorerParamsOpen}
              onToggle={(e) => setExplorerParamsOpen(e.currentTarget.open)}
            >
              <summary className="studio-explorer-params__summary">
                Paramètres explorateur — calques, pauses, locuteurs, recalcul
              </summary>
              <div className="studio-explorer-params__body">
                <aside aria-label="Calques et locuteurs">
                  <StudioExplorerSidePanels explorer={explorer} />
                </aside>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
