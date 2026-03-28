import type { StudioView } from "../types";

export type HubCardId = "workspace" | "player" | "jobs" | "about";

/** Cartes hub + libellés nav — une seule source de vérité. */
export const STUDIO_HUB_CARDS: {
  title: string;
  kicker: string;
  description: string;
  view: StudioView;
  cardId: HubCardId;
}[] = [
  {
    title: "Transcrire",
    kicker: "Studio",
    description: "Média, lancement de job, pipeline et transcript.",
    view: "workspace",
    cardId: "workspace",
  },
  {
    title: "Analyser",
    kicker: "Player",
    description: "Lecture, manifest et vues alignées sur le média.",
    view: "player",
    cardId: "player",
  },
  {
    title: "Historique",
    kicker: "Jobs",
    description: "Liste des runs, détail et annulation.",
    view: "jobs",
    cardId: "jobs",
  },
  {
    title: "Paramètres généraux",
    kicker: "Système",
    description: "À propos, diagnostic runtime et préférences.",
    view: "about",
    cardId: "about",
  },
];
