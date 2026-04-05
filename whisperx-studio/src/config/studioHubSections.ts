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
    description:
      "Importer un média, régler le pipeline WhisperX et lancer la transcription.",
    view: "import",
    cardId: "import",
  },
  {
    title: "Annoter",
    kicker: "Éditeur",
    description:
      "Annoter sans ASR. Choisissez un mode ci-dessous : audio seul, avec transcript ou depuis la bibliothèque.",
    view: "editor",
    cardId: "editor",
  },
  {
    title: "Analyser",
    kicker: "Player",
    description:
      "Lire le média, aligner les vues et consulter les statistiques prosodiques.",
    view: "player",
    cardId: "player",
  },
];
