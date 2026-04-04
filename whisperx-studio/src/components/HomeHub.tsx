import { useEffect, useState } from "react";
import { StudioHero } from "./StudioHero";
import { STUDIO_HUB_CARDS, type HubCardId } from "../config/studioHubSections";
import type { RuntimeStatus, StudioView } from "../types";

export type HomeHubProps = {
  setActiveView: (view: StudioView) => void;
  onAnnoterAudioOnly?: () => void | Promise<void>;
  onAnnoterWithTranscript?: () => void | Promise<void>;
  onAnnoterFromLibrary?: () => void;
  annoterBusy?: boolean;
  annoterError?: string;
  runtimeReady: boolean;
  runtimeStatus: RuntimeStatus | null;
};

const iconProps = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function AnnoterModeChevron() {
  return (
    <svg
      className="home-hub-card__annoter-mode__chevron"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

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
 * Hub d’entrée : cartes vers les zones principales de l’app.
 */
export function HomeHub({
  setActiveView,
  onAnnoterAudioOnly,
  onAnnoterWithTranscript,
  onAnnoterFromLibrary,
  annoterBusy = false,
  annoterError = "",
  runtimeReady,
  runtimeStatus,
}: HomeHubProps) {
  const [annoterExpanded, setAnnoterExpanded] = useState(false);

  useEffect(() => {
    if (!annoterExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAnnoterExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [annoterExpanded]);

  const whisperxOk = runtimeStatus?.whisperxOk === true;
  const runtimeHint = whisperxOk
    ? "WhisperX utilisable"
    : runtimeReady
      ? "Runtime partiel — voir Paramètres généraux"
      : "Runtime non vérifié";

  return (
    <div className="home-hub" id="studio-home-hub">
      <StudioHero />
      <section className="home-hub-section" aria-labelledby="home-hub-heading">
        <div className="home-hub-panel">
          <h2 id="home-hub-heading" className="home-hub-heading">
            Par quoi commencer ?
          </h2>
          <ul className="home-hub-grid">
            {STUDIO_HUB_CARDS.map((card) => (
              <li key={card.view} className="home-hub-grid__cell">
                {card.cardId === "editor" ? (
                  <div
                    className={`home-hub-card home-hub-card--${card.cardId} home-hub-card--annoter`}
                    data-hub-card={card.cardId}
                  >
                    <button
                      type="button"
                      className="home-hub-card__annoter-toggle"
                      aria-expanded={annoterExpanded}
                      aria-controls="home-hub-annoter-modes"
                      onClick={() => setAnnoterExpanded((v) => !v)}
                    >
                      <span className="home-hub-card__accent" aria-hidden />
                      <span className="home-hub-card__body home-hub-card__body--annoter-head">
                        <span className="home-hub-card__text">
                          <span className="home-hub-card__kicker">{card.kicker}</span>
                          <span className="home-hub-card__title-row">
                            <span className="home-hub-card__icon-wrap">
                              <HubCardIcon cardId={card.cardId} />
                            </span>
                            <span id="home-hub-annoter-title" className="home-hub-card__title">
                              {card.title}
                            </span>
                          </span>
                          <span className="home-hub-card__desc">{card.description}</span>
                        </span>
                        <span
                          className={`home-hub-card__chevron home-hub-card__chevron--annoter${
                            annoterExpanded ? " home-hub-card__chevron--annoter-open" : ""
                          }`}
                          aria-hidden
                        >
                          <svg
                            width="22"
                            height="22"
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
                    <div
                      id="home-hub-annoter-modes"
                      className="home-hub-card__annoter-modes"
                      role="group"
                      aria-labelledby="home-hub-annoter-title"
                      hidden={!annoterExpanded}
                    >
                      <button
                        type="button"
                        className="home-hub-card__annoter-mode"
                        disabled={annoterBusy}
                        aria-busy={annoterBusy ? true : undefined}
                        onClick={() => {
                          setAnnoterExpanded(false);
                          if (onAnnoterAudioOnly) void onAnnoterAudioOnly();
                        }}
                      >
                        <span className="home-hub-card__annoter-mode__text">
                          <strong>Audio seul</strong>
                          <span className="small">Créer un run vide, annoter depuis zéro</span>
                        </span>
                        <AnnoterModeChevron />
                      </button>
                      <button
                        type="button"
                        className="home-hub-card__annoter-mode"
                        disabled={annoterBusy}
                        aria-busy={annoterBusy ? true : undefined}
                        onClick={() => {
                          setAnnoterExpanded(false);
                          if (onAnnoterWithTranscript) void onAnnoterWithTranscript();
                        }}
                      >
                        <span className="home-hub-card__annoter-mode__text">
                          <strong>Audio + transcript</strong>
                          <span className="small">Importer un SRT / VTT / JSON existant</span>
                        </span>
                        <AnnoterModeChevron />
                      </button>
                      <button
                        type="button"
                        className="home-hub-card__annoter-mode"
                        onClick={() => {
                          setAnnoterExpanded(false);
                          onAnnoterFromLibrary?.();
                        }}
                      >
                        <span className="home-hub-card__annoter-mode__text">
                          <strong>Run existant</strong>
                          <span className="small">Ouvrir un run déjà présent dans la bibliothèque</span>
                        </span>
                        <AnnoterModeChevron />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`home-hub-card home-hub-card--${card.cardId}`}
                    data-hub-card={card.cardId}
                    onClick={() => setActiveView(card.view)}
                  >
                    <span className="home-hub-card__accent" aria-hidden />
                    <span className="home-hub-card__body">
                      <span className="home-hub-card__text">
                        <span className="home-hub-card__kicker">{card.kicker}</span>
                        <span className="home-hub-card__title-row">
                          <span className="home-hub-card__icon-wrap">
                            <HubCardIcon cardId={card.cardId} />
                          </span>
                          <span className="home-hub-card__title">{card.title}</span>
                        </span>
                        <span className="home-hub-card__desc">{card.description}</span>
                      </span>
                      <span className="home-hub-card__chevron" aria-hidden>
                        <svg
                          width="22"
                          height="22"
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
                )}
              </li>
            ))}
          </ul>

          {annoterError.trim() ? (
            <p className="home-hub-annoter-error small" role="alert">
              {annoterError}
            </p>
          ) : null}
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
