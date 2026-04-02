import { StudioHero } from "./StudioHero";
import { STUDIO_HUB_CARDS, type HubCardId } from "../config/studioHubSections";
import type { RuntimeStatus, StudioView } from "../types";

export type HomeHubProps = {
  setActiveView: (view: StudioView) => void;
  runtimeReady: boolean;
  runtimeStatus: RuntimeStatus | null;
};

const iconProps = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function HubCardIcon({ cardId }: { cardId: HubCardId }) {
  switch (cardId) {
    case "import":
      return (
        <svg {...iconProps}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case "editor":
      return (
        <svg {...iconProps}>
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case "player":
      return (
        <svg {...iconProps}>
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Hub d’entrée : cartes vers les quatre zones principales de l’app.
 */
export function HomeHub({ setActiveView, runtimeReady, runtimeStatus }: HomeHubProps) {
  const whisperxOk = runtimeStatus?.whisperxOk === true;
  const runtimeHint = whisperxOk
    ? "WhisperX utilisable"
    : runtimeReady
      ? "Runtime partiel — voir Paramètres généraux"
      : "Runtime non vérifié";

  return (
    <div className="home-hub">
      <StudioHero />
      <section className="home-hub-section" aria-labelledby="home-hub-heading">
        <div className="home-hub-panel">
          <h2 id="home-hub-heading" className="home-hub-heading">
            Par quoi commencer ?
          </h2>
          <ul className="home-hub-grid">
            {STUDIO_HUB_CARDS.map((card) => (
              <li key={card.view} className="home-hub-grid__cell">
                <button
                  type="button"
                  className={`home-hub-card home-hub-card--${card.cardId}`}
                  data-hub-card={card.cardId}
                  onClick={() => setActiveView(card.view)}
                >
                  <span className="home-hub-card__accent" aria-hidden />
                  <span className="home-hub-card__body">
                    <span className="home-hub-card__icon-wrap">
                      <HubCardIcon cardId={card.cardId} />
                    </span>
                    <span className="home-hub-card__text">
                      <span className="home-hub-card__kicker">{card.kicker}</span>
                      <span className="home-hub-card__title">{card.title}</span>
                      <span className="home-hub-card__desc">{card.description}</span>
                    </span>
                    <span className="home-hub-card__chevron" aria-hidden>
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p
          className="home-hub-runtime"
          data-runtime-ready={runtimeReady}
          data-whisperx-ok={whisperxOk}
        >
          <span className="home-hub-runtime__dot" aria-hidden />
          {runtimeHint}
        </p>
      </section>
    </div>
  );
}
