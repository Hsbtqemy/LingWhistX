import { Fragment } from "react";
import type { StudioView } from "../types";
import { STUDIO_HUB_CARDS, type HubCardId } from "../config/studioHubSections";
import { Button } from "./ui";

/** Préfixe ids DOM — panneaux dans App.tsx (`studio-panel-*`). Vue « create » : hub d’entrée (cartes). */
export const STUDIO_TAB_IDS: Record<StudioView, string> = {
  create: "studio-tab-create",
  workspace: "studio-tab-workspace",
  jobs: "studio-tab-jobs",
  player: "studio-tab-player",
  about: "studio-tab-about",
};

export const STUDIO_PANEL_IDS: Record<StudioView, string> = {
  create: "studio-panel-create",
  workspace: "studio-panel-workspace",
  jobs: "studio-panel-jobs",
  player: "studio-panel-player",
  about: "studio-panel-about",
};

const navIconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function NavIconHubCard({ cardId }: { cardId: HubCardId }) {
  switch (cardId) {
    case "workspace":
      return (
        <svg {...navIconProps}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      );
    case "player":
      return (
        <svg {...navIconProps}>
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "jobs":
      return (
        <svg {...navIconProps}>
          <path d="M12 8v4l3 2" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "about":
      return (
        <svg {...navIconProps}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    default:
      return null;
  }
}

export type StudioNavProps = {
  activeView: StudioView;
  onViewChange: (view: StudioView) => void;
  /** Au moins un job `queued` ou `running` — pastille sur l’onglet Studio. */
  workspaceHasActiveJobs?: boolean;
};

export function StudioNav({
  activeView,
  onViewChange,
  workspaceHasActiveJobs = false,
}: StudioNavProps) {
  return (
    <nav className="studio-nav studio-nav--topbar" aria-label="Studio LingWhistX">
      <div id={STUDIO_TAB_IDS.create} className="studio-nav-brand">
        <span className="studio-nav-brand__name">LingWhistX</span>
      </div>
      <div className="studio-nav-tabs" role="tablist" aria-label="Sections du studio">
        {STUDIO_HUB_CARDS.map((card) => {
          const label = `${card.kicker} — ${card.title}`;
          const tab = (
            <Button
              id={STUDIO_TAB_IDS[card.view]}
              variant="navTab"
              type="button"
              role="tab"
              aria-selected={activeView === card.view}
              aria-controls={STUDIO_PANEL_IDS[card.view]}
              active={activeView === card.view}
              onClick={() => onViewChange(card.view)}
              aria-label={label}
            >
              <span className="studio-nav-tab-inner">
                <NavIconHubCard cardId={card.cardId} />
                <span className="studio-nav-tab__stack">
                  <span className="studio-nav-tab__kicker">{card.kicker}</span>
                  <span className="studio-nav-tab__title">{card.title}</span>
                </span>
              </span>
            </Button>
          );

          if (card.cardId === "workspace") {
            return (
              <div
                key={card.view}
                className={`studio-nav-tab-slot${workspaceHasActiveJobs ? " studio-nav-tab-slot--live" : ""}`}
              >
                {tab}
                {workspaceHasActiveJobs ? (
                  <span className="studio-nav-activity-dot" title="Traitement en cours" />
                ) : null}
              </div>
            );
          }

          return <Fragment key={card.view}>{tab}</Fragment>;
        })}
      </div>
    </nav>
  );
}
