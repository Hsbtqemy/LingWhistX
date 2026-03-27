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
      <details className="studio-explorer-topbar-details">
        <summary
          className="studio-explorer-topbar-details__summary"
          title="Outils avancés : autre run sur disque, index SQLite, navigation par pauses"
        >
          Explorateur avancé — run sur disque, index, navigation temps
        </summary>
        <div className="studio-explorer-topbar-details__body">
          <p className="small studio-explorer-topbar-details__lead">
            Ces commandes ciblent un <strong>dossier de run déjà produit</strong> (souvent un autre
            chemin que le job sélectionné dans l&apos;historique) : ouvrir ce dossier, indexer les
            événements dans <code className="mono">events.sqlite</code> pour activer les sauts
            «&nbsp;pause suivante&nbsp;» et les calques, exporter un pack timing. Pour un premier
            job, l&apos;onglet <strong>Créer</strong> suffit — tu peux laisser ce panneau replié.
          </p>
          <StudioExplorerTopBar explorer={explorer} />
        </div>
      </details>
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
