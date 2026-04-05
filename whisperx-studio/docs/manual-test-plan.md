# Plan de test manuel — WhisperX Studio

Document vivant : à mettre à jour quand une zone du produit change (navigation, bibliothèque, player, etc.).

**Lancer l’app (Tauri requis pour IPC et fichiers) :**

```bash
cd whisperx-studio && npm run tauri dev
```

---

## Légende

- [ ] = non testé / à refaire
- [x] = OK
- Notes : anomalies, build, OS, date.

---

## 1. Navigation & hub

| #   | Cas                                                                                                            | OK  | Notes |
| --- | -------------------------------------------------------------------------------------------------------------- | --- | ----- |
| 1.1 | Au chargement, l’onglet restauré est cohérent (sessionStorage).                                                | [x] |       |
| 1.2 | Onglet **Import** : le **hub** (cartes « Par quoi commencer ? » + héros) est visible **en haut** de la page.   | [x] |       |
| 1.3 | Clic sur la marque **LingWhistX** : bascule vers **Import** et fait défiler jusqu’au hub (`#studio-home-hub`). | [x] |       |
| 1.4 | Les onglets **Import / Éditeur / Player** (et **Paramètres** via ⚙) s’ouvrent sans erreur.                     | [x] |       |
| 1.5 | Console du webview (F12) : pas d’erreur bloquante au changement d’onglet.                                      | [x] |       |
| 1.6 | **Aide** (?) s’ouvre et se ferme.                                                                              | [x] |       |

**Suite prévue (hors scope de ce tableau) :** reprendre le **contenu et la structure du bloc hub** sur l’onglet Import — actuellement long, peu spécifique, et empilé au-dessus du flux « nouveau job / run » hérité des itérations. Voir discussion produit : évaluation après fin du test manuel complet vs. chantier UX dédié.

---

## 2. Bibliothèque de runs

| #   | Cas                                                                                                                                                                           | OK  | Notes |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| 2.1 | Bouton **Bibliothèque** dans la barre : ouverture du panneau / modal liste.                                                                                                   | [x] |       |
| 2.2 | **Recherche** : le placeholder et le texte d’aide indiquent qu’on peut filtrer par **nom de média** ou **ID de run** ; champ vide = liste complète.                           | [x] |       |
| 2.3 | Saisie partielle : la liste se filtre correctement.                                                                                                                           | [x] |       |
| 2.4 | **Ouvrir en Lecture** / **Ouvrir en Édition** : bon onglet + run chargé.                                                                                                      | [x] |       |
| 2.5 | Fermeture (× ou Échap) + réouverture : pas de crash.                                                                                                                          | [x] |       |
| 2.6 | **Actualiser** : en-tête du panneau Bibliothèque, bouton **icône + libellé « Actualiser »** (à gauche du × Fermer) — relance le chargement des runs récents depuis le disque. | [x] |       |

---

## 3. Brush stats ↔ waveform (WX-724 / WX-727)

**Prérequis :** run avec données (events / player peuplé).

| #   | Cas                                                                                                                                                                                                                                                                                                                                                                                   | OK  | Notes |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| 3.1 | Onglet **Player** → vue **Stats**.                                                                                                                                                                                                                                                                                                                                                    | [x] |       |
| 3.2 | **Brush** sur un canvas (timeline / taux / densité) : zone de sélection visible.                                                                                                                                                                                                                                                                                                      | [x] |       |
| 3.3 | Résumé + cartes locuteurs reflètent la **plage** sélectionnée.                                                                                                                                                                                                                                                                                                                        | [x] |       |
| 3.4 | **Réinitialiser** (barre d’info brush) ou **Shift+clic** sur le canvas avec une sélection active : retour pleine durée. **Double-clic** efface aussi la sélection, mais chaque **clic simple** sur une plage de moins de ~500 ms déclenche un **seek** (et peut faire défiler le contenu sous les graphiques) — pour un test fiable, privilégier **Réinitialiser** ou **Shift+clic**. | [x] |       |
| 3.5 | **Sélection de région** sur la **waveform** (mode analyse si présent) : les **stats** suivent la **même** plage que les graphiques (source de vérité partagée).                                                                                                                                                                                                                       | [x] |       |
| 3.6 | Changement de vue (ex. Lanes puis Stats) : sélection cohérente. **Lanes** : texte par tour = **tokens** si la couche mots est chargée (ex. **Fenêtre mots** activée) ; sinon **IPU** (résumés courts possibles, ex. « But »).                                                                                                                                                         | [x] |       |

---

## 4. Annotation / import sans ASR (récent)

| #   | Cas                                                                                                                                     | OK  | Notes |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| 4.1 | Flux « run sans transcription complète » ou **Audio + Transcript** / **audio seul** selon l’UI : création de run sans erreur bloquante. |     |       |
| 4.2 | Import **EAF / TextGrid** si exposé dans l’UI : comportement attendu.                                                                   |     |       |

---

## 5. Import & jobs

| #   | Cas                                                                          | OK  | Notes |
| --- | ---------------------------------------------------------------------------- | --- | ----- |
| 5.1 | Sélection d’un média, configuration, lancement (mock ou réel selon ton env). |     |       |
| 5.2 | Historique / file : statuts et logs lisibles.                                |     |       |

---

## 6. Éditeur (transcript)

**Prérequis :** run ouvert depuis la bibliothèque ou l’import ; onglet **Éditeur** actif ; `data-lx-editor-view` sur `<html>` (pas de défilement de toute la page : la **barre du bas** reste dans le viewport).

| #   | Cas                                                                                                                                                                                                                                                                                                                                 | OK  | Notes |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| 6.1 | Ouverture / détection auto d’un **transcript JSON** dans le run : segments affichés, pas d’erreur bloquante.                                                                                                                                                                                                                        |     |       |
| 6.2 | **Barre Fichier** (au-dessus de la waveform) : chemin / état, **langue**, **Sauvegarder**, **Ouvrir le lecteur** — actions cohérentes (dont dirty / chargement).                                                                                                                                                                    |     |       |
| 6.3 | **Mini-player** : média + waveform ; pas de transport dupliqué ici (lecture dans la barre du bas).                                                                                                                                                                                                                                    |     |       |
| 6.4 | **Lecture** (toolbar) : temps, play/pause, vitesse, boucle A–B, **Autres…** en vue étroite si présent.                                                                                                                                                                                                                                |     |       |
| 6.5 | **Segments** : **Undo / Redo** (icônes seules), **Split**, **Merge** (↑ \| Merge \| ↓), **+ Segment**, **Supprimer** ; en vue étroite, **Autres…** regroupe les actions secondaires.                                                                                                                                                    |     |       |
| 6.6 | **Convention** (même ligne que les boutons segments si place) : libellé + liste + **marques** ; pas de bandeau défilant imposé sur les pilules ; groupe **Convention + liste** ne se coupe pas (libellé au-dessus du menu seul).                                                                                                      |     |       |
| 6.7 | **Export** : choix de format, case **chevauchements**, aide **?** ; vue **étroite** : format + chevauchements sans régression.                                                                                                                                                                                                       |     |       |
| 6.8 | **Barre du bas** (Lecture + Segments + Export + statut) : reste **visible** en bas du panneau en faisant défiler **uniquement** la liste de segments (pas la page entière).                                                                                                                                                           |     |       |
| 6.9 | **Sauvegarde** + **exports** (JSON, SRT, etc.) : chemins / messages de statut attendus.                                                                                                                                                                                                                                            |     |       |

---

## 7. Barrières automatisées (rappel)

Avant une release, depuis `whisperx-studio/` :

- `npm run build`
- `npm run test`
- `npm run lint`

À la racine du dépôt : `pytest tests/`, `ruff check whisperx tests`, et Rust : `cargo clippy` / `cargo test` dans `src-tauri` selon la CI.

---

## Historique des mises à jour

| Date       | Changement                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-03-27 | Section 6 (éditeur) : plan détaillé — barre fichier, mini-player, toolbar Lecture/Segments/Convention/Export, merge cluster, viewport `data-lx-editor-view`, barre du bas fixe dans le panneau. |
| 2026-04-04 | Création : hub sur Import, marque LingWhistX, bibliothèque (placeholder + hints), brush stats.                  |
| 2026-04-04 | Section 1 (navigation & hub) : tous les cas cochés ; note de suivi sur refonte du hub (longueur / spécificité). |
| 2026-04-04 | Section 2 (bibliothèque de runs) : tous les cas cochés.                                                         |
