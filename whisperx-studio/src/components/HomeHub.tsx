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

const svgBase = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function IconTranscrire() {
  return (
    <svg {...svgBase}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconAnnoter() {
  return (
    <svg {...svgBase}>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconAnalyser() {
  return (
    <svg {...svgBase}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
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
      return <IconTranscrire />;
    case "editor":
      return <IconAnnoter />;
    case "player":
      return <IconAnalyser />;
  }
}

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
  const whisperxOk = runtimeStatus?.whisperxOk === true;
  const runtimeHint = whisperxOk
    ? "WhisperX prêt"
    : runtimeReady
      ? "Runtime partiel — voir Paramètres"
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
                  /* ── Carte Annoter : header + modes intégrés ── */
                  <div
                    className="home-hub-card home-hub-card--editor"
                    data-hub-card="editor"
                    role="group"
                    aria-label="Annoter"
                  >
                    <div className="home-hub-card__accent" aria-hidden />
                    <div className="home-hub-card__header">
                      <span className="home-hub-card__icon-wrap">
                        <HubCardIcon cardId="editor" />
                      </span>
                      <span className="home-hub-card__kicker">{card.kicker}</span>
                      <span className="home-hub-card__title">{card.title}</span>
                    </div>
                    <div className="home-hub-card__divider" aria-hidden />
                    <div className="home-hub-card__modes">
                      <button
                        type="button"
                        className="hub-mode-btn"
                        disabled={annoterBusy}
                        aria-busy={annoterBusy ? true : undefined}
                        onClick={() => {
                          if (onAnnoterAudioOnly) void onAnnoterAudioOnly();
                        }}
                      >
                        <span className="hub-mode-btn__content">
                          <span className="hub-mode-btn__label">Audio seul</span>
                          <span className="hub-mode-btn__desc">Run vide, annoter depuis zéro</span>
                        </span>
                        <IconChevron />
                      </button>
                      <button
                        type="button"
                        className="hub-mode-btn"
                        disabled={annoterBusy}
                        aria-busy={annoterBusy ? true : undefined}
                        onClick={() => {
                          if (onAnnoterWithTranscript) void onAnnoterWithTranscript();
                        }}
                      >
                        <span className="hub-mode-btn__content">
                          <span className="hub-mode-btn__label">Audio + transcript</span>
                          <span className="hub-mode-btn__desc">Importer SRT / VTT / JSON</span>
                        </span>
                        <IconChevron />
                      </button>
                      <button
                        type="button"
                        className="hub-mode-btn"
                        onClick={() => onAnnoterFromLibrary?.()}
                      >
                        <span className="hub-mode-btn__content">
                          <span className="hub-mode-btn__label">Run existant</span>
                          <span className="hub-mode-btn__desc">Bibliothèque de runs</span>
                        </span>
                        <IconChevron />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Cartes simples : Transcrire + Analyser ── */
                  <button
                    type="button"
                    className={`home-hub-card home-hub-card--${card.cardId}`}
                    data-hub-card={card.cardId}
                    onClick={() => setActiveView(card.view)}
                  >
                    <div className="home-hub-card__accent" aria-hidden />
                    <div className="home-hub-card__header">
                      <span className="home-hub-card__icon-wrap">
                        <HubCardIcon cardId={card.cardId} />
                      </span>
                      <span className="home-hub-card__kicker">{card.kicker}</span>
                      <span className="home-hub-card__title">{card.title}</span>
                    </div>
                    <div className="home-hub-card__divider" aria-hidden />
                    <div className="home-hub-card__footer">
                      <span className="home-hub-card__desc">{card.description}</span>
                      <span className="home-hub-card__cta" aria-hidden>
                        Ouvrir <IconChevron />
                      </span>
                    </div>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {annoterError.trim() ? (
            <p className="home-hub-error small" role="alert">
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
