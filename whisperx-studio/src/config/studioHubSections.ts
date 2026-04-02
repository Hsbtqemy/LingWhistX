import type { StudioView } from "../types";

export type HubCardId = "import" | "editor" | "player";

/** Onglets principaux (3) — une seule source de vérité pour nav + hub. */
export const STUDIO_HUB_CARDS: {
  title: string;
  kicker: string;
  description: string;
  view: StudioView;
  cardId: HubCardId;
}[] = [
  {
    title: "Transcrire",
    kicker: "Import",
    description: "Importer un média, configurer le pipeline et lancer la transcription.",
    view: "import",
    cardId: "import",
  },
  {
    title: "Annoter",
    kicker: "Éditeur",
    description: "Corriger et annoter le transcript aligné.",
    view: "editor",
    cardId: "editor",
  },
  {
    title: "Analyser",
    kicker: "Player",
    description: "Lecture, vues alignées et statistiques prosodiques.",
    view: "player",
    cardId: "player",
  },
];
