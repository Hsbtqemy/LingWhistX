# Parcours utilisateur — Explorer (Studio)

Ce document décrit le flux **ouvrir un run → indexer → recalcul léger → export**, sans jargon GPU. Il complète le tableau **F.2** de l’audit UI/UX :

- [`audit/ui-ux-harmonization-spec.md`](../../audit/ui-ux-harmonization-spec.md#f2-scénarios-utilisateurs) (section **F.2 Scénarios utilisateurs**).

## 1. Ouvrir un run

- Depuis l’**accueil** : choisir un run récent, ou **parcourir** un dossier qui contient un `run_manifest.json` valide.
- Passer à l’onglet **Studio** : la zone de travail affiche l’historique des jobs, le détail du run sélectionné et l’**Explorer** (barre du haut + panneaux latéraux).
- **Succès attendu** : méta du run visibles, média / waveform chargés sans état vide bloquant.

## 2. Indexer les événements (`events.sqlite`)

- Dans la barre **Explorer** : **Indexer les événements** (ou équivalent) pour remplir la base SQLite à côté du run à partir du fichier timeline du manifest.
- Attendre la fin de l’indexation ; les compteurs (mots, tours, pauses…) apparaissent dans les stats.
- **Sans cette étape** : les requêtes fenêtre sur la timeline et certains panneaux restent limités.

## 3. Recalcul léger (pauses / IPU)

- Panneau **Pauses / IPU (Rust)** : ajuster les seuils (pause min, filtres IPU, etc.).
- L’**aperçu** se met à jour sans relancer Whisper : le recalcul part des **mots** déjà en base.
- **Appliquer → SQLite** uniquement quand le résultat convient — cela écrit les pauses / IPU recalculées, toujours **sans** relancer la transcription ASR.

## 4. Export

- **Explorer — Export pack timing** : export JSON + SRT + CSV à partir du transcript source du run (voir info-bulle dans l’app).
- **Player** : export pack timing depuis la barre du lecteur lorsqu’un run est ouvert.
- Vérifier le message de confirmation ou le chemin du dernier fichier exporté.

## Voir aussi

- Scénarios additionnels (alertes Player, etc.) : **F.2** dans l’audit ci-dessus.
- Libellé officiel de l’onglet **Studio** (workspace jobs / Explorer) : [`workspace-tab-label.md`](workspace-tab-label.md) (WX-637).
- Backlog tâches UI : `backlog/backlog.json` (WX-626 à WX-637).
