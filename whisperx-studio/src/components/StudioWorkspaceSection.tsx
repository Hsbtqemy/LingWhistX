import { useState } from "react";
import type { RefObject } from "react";
import type { StudioExplorerModel } from "../hooks/useStudioExplorer";
import type { NewJobFormApi } from "../hooks/useNewJobForm";
import type { StudioView } from "../types";
import { RunDetailsPanel, type RunDetailsPanelProps } from "./runDetails/RunDetailsPanel";
import { SessionRestoreBanner } from "./SessionRestoreBanner";
import type { SessionRestoreBannerProps } from "./SessionRestoreBanner";
import { StudioExplorerSidePanels, StudioExplorerTopBar } from "./StudioExplorerChrome";
import { StudioNewJobSection } from "./StudioNewJobSection";
import { StudioOpenRunSection } from "./StudioOpenRunSection";

export type StudioWorkspaceSectionProps = {
  runDetailsRef: RefObject<HTMLElement | null>;
  runDetails: RunDetailsPanelProps;
  explorer: StudioExplorerModel;
  sessionRestore: Pick<SessionRestoreBannerProps, "prompt" | "onRestore" | "onDismiss">;
  setError: (message: string) => void;
  setActiveView: (view: StudioView) => void;
  setSelectedJobId: (id: string) => void;
  onOpenPlayer: (runDir: string, label?: string | null) => void;
  runningJobs: number;
  errors: string[];
  refreshJobs: () => Promise<void>;
  jobForm: NewJobFormApi;
};

export function StudioWorkspaceSection({
  runDetailsRef,
  runDetails,
  explorer,
  sessionRestore,
  setError,
  setActiveView,
  setSelectedJobId,
  onOpenPlayer,
  runningJobs,
  errors,
  refreshJobs,
  jobForm,
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
      <div className="studio-workspace-workbench" aria-label="Nouveau job et ouverture de run">
        <StudioNewJobSection
          setError={setError}
          runningJobs={runningJobs}
          errors={errors}
          refreshJobs={refreshJobs}
          jobForm={jobForm}
        />
        <details className="studio-workspace-open-run-details">
          <summary className="studio-workspace-open-run-details__summary">
            Ouvrir un run sur disque (manifest, index, Player)
          </summary>
          <div className="studio-workspace-open-run-details__body">
            <StudioOpenRunSection
              setError={setError}
              setActiveView={setActiveView}
              setSelectedJobId={setSelectedJobId}
              onOpenPlayer={onOpenPlayer}
            />
          </div>
        </details>
      </div>
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
            «&nbsp;pause suivante&nbsp;» et les calques, exporter un pack timing. Tu peux laisser ce
            panneau replié si tu travailles uniquement sur le job courant.
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
        <div className="studio-workspace-explorer" aria-label="Paramètres explorateur">
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
  );
}
