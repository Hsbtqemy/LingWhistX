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

| # | Cas | OK | Notes |
|---|-----|-----|--------|
| 1.1 | Au chargement, l’onglet restauré est cohérent (sessionStorage). | [x] | |
| 1.2 | Onglet **Import** : le **hub** (cartes « Par quoi commencer ? » + héros) est visible **en haut** de la page. | [x] | |
| 1.3 | Clic sur la marque **LingWhistX** : bascule vers **Import** et fait défiler jusqu’au hub (`#studio-home-hub`). | [x] | |
| 1.4 | Les onglets **Import / Éditeur / Player** (et **Paramètres** via ⚙) s’ouvrent sans erreur. | [x] | |
| 1.5 | Console du webview (F12) : pas d’erreur bloquante au changement d’onglet. | [x] | |
| 1.6 | **Aide** (?) s’ouvre et se ferme. | [x] | |

**Suite prévue (hors scope de ce tableau) :** reprendre le **contenu et la structure du bloc hub** sur l’onglet Import — actuellement long, peu spécifique, et empilé au-dessus du flux « nouveau job / run » hérité des itérations. Voir discussion produit : évaluation après fin du test manuel complet vs. chantier UX dédié.

---

## 2. Bibliothèque de runs

| # | Cas | OK | Notes |
|---|-----|-----|--------|
| 2.1 | Bouton **Bibliothèque** dans la barre : ouverture du panneau / modal liste. | [x] | |
| 2.2 | **Recherche** : le placeholder et le texte d’aide indiquent qu’on peut filtrer par **nom de média** ou **ID de run** ; champ vide = liste complète. | [x] | |
| 2.3 | Saisie partielle : la liste se filtre correctement. | [x] | |
| 2.4 | **Ouvrir en Lecture** / **Ouvrir en Édition** : bon onglet + run chargé. | [x] | |
| 2.5 | Fermeture (× ou Échap) + réouverture : pas de crash. | [x] | |
| 2.6 | **Actualiser** : en-tête du panneau Bibliothèque, bouton **icône + libellé « Actualiser »** (à gauche du × Fermer) — relance le chargement des runs récents depuis le disque. | [x] | |

---

## 3. Brush stats ↔ waveform (WX-724 / WX-727)

**Prérequis :** run avec données (events / player peuplé).

| # | Cas | OK | Notes |
|---|-----|-----|--------|
| 3.1 | Onglet **Player** → vue **Stats**. | [x] | |
| 3.2 | **Brush** sur un canvas (timeline / taux / densité) : zone de sélection visible. | [x] | |
| 3.3 | Résumé + cartes locuteurs reflètent la **plage** sélectionnée. | [x] | |
| 3.4 | **Réinitialiser** (barre d’info brush) ou **Shift+clic** sur le canvas avec une sélection active : retour pleine durée. **Double-clic** efface aussi la sélection, mais chaque **clic simple** sur une plage de moins de ~500 ms déclenche un **seek** (et peut faire défiler le contenu sous les graphiques) — pour un test fiable, privilégier **Réinitialiser** ou **Shift+clic**. | [x] | |
| 3.5 | **Sélection de région** sur la **waveform** (mode analyse si présent) : les **stats** suivent la **même** plage que les graphiques (source de vérité partagée). | [x] | |
| 3.6 | Changement de vue (ex. Lanes puis Stats) : sélection cohérente. **Lanes** : texte par tour = **tokens** si la couche mots est chargée (ex. **Fenêtre mots** activée) ; sinon **IPU** (résumés courts possibles, ex. « But »). | [x] | |

---

## 4. Annotation / import sans ASR (récent)

| # | Cas | OK | Notes |
|---|-----|-----|--------|
| 4.1 | Flux « run sans transcription complète » ou **Audio + Transcript** / **audio seul** selon l’UI : création de run sans erreur bloquante. | | |
| 4.2 | Import **EAF / TextGrid** si exposé dans l’UI : comportement attendu. | | |

---

## 5. Import & jobs

| # | Cas | OK | Notes |
|---|-----|-----|--------|
| 5.1 | Sélection d’un média, configuration, lancement (mock ou réel selon ton env). | | |
| 5.2 | Historique / file : statuts et logs lisibles. | | |

---

## 6. Éditeur (transcript)

| # | Cas | OK | Notes |
|---|-----|-----|--------|
| 6.1 | Ouverture d’un transcript JSON : segments affichés. | | |
| 6.2 | Sauvegarde / exports utilisés en routine. | | |

---

## 7. Barrières automatisées (rappel)

Avant une release, depuis `whisperx-studio/` :

- `npm run build`
- `npm run test`
- `npm run lint`

À la racine du dépôt : `pytest tests/`, `ruff check whisperx tests`, et Rust : `cargo clippy` / `cargo test` dans `src-tauri` selon la CI.

---

## Historique des mises à jour

| Date | Changement |
|------|------------|
| 2026-04-04 | Création : hub sur Import, marque LingWhistX, bibliothèque (placeholder + hints), brush stats. |
| 2026-04-04 | Section 1 (navigation & hub) : tous les cas cochés ; note de suivi sur refonte du hub (longueur / spécificité). |
| 2026-04-04 | Section 2 (bibliothèque de runs) : tous les cas cochés. |
