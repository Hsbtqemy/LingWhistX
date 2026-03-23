import type { RefObject } from "react";
import type { StudioExplorerModel } from "../hooks/useStudioExplorer";
import { JobsHistoryPanel, type JobsHistoryPanelProps } from "./JobsHistoryPanel";
import { RunDetailsPanel, type RunDetailsPanelProps } from "./runDetails/RunDetailsPanel";
import { StudioExplorerSidePanels, StudioExplorerTopBar } from "./StudioExplorerChrome";

export type StudioWorkspaceSectionProps = {
  jobsHistory: JobsHistoryPanelProps;
  runDetailsRef: RefObject<HTMLElement | null>;
  runDetails: RunDetailsPanelProps;
  explorer: StudioExplorerModel;
};

export function StudioWorkspaceSection({
  jobsHistory,
  runDetailsRef,
  runDetails,
  explorer,
}: StudioWorkspaceSectionProps) {
  return (
    <div className="studio-workspace-layout">
      <StudioExplorerTopBar explorer={explorer} />
      <JobsHistoryPanel {...jobsHistory} />
      <div className="explorer-workspace-grid">
        <aside className="explorer-sidebar" aria-label="Calques et locuteurs">
          <StudioExplorerSidePanels explorer={explorer} />
        </aside>
        <div className="explorer-workspace-main">
          <RunDetailsPanel ref={runDetailsRef} {...runDetails} />
        </div>
      </div>
    </div>
  );
}
