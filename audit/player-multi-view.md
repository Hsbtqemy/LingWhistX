# Player multi-vues (LingWhistX Studio)

**Ticket backlog :** `WX-624` (`whisperx-studio/backlog/backlog.json`).

La spécification produit détaillée (workspaces, layout, 5 vues, alertes, raccourcis, contrats IPC Tauri, budgets perf, roadmap v1/v2) est portée par le champ **`spec`** du ticket **WX-624** et par **`definitionOfDone`** / **`acceptance`**.

### Backlog `execute` (WX-624) ↔ implémentations

Les commandes du ticket sont pensées pour être lancées **depuis la racine du dépôt** `LingWhistX` (clone Git). Si tu préfères travailler dans `whisperx-studio/`, exécute les mêmes scripts **sans** le préfixe `cd …` (voir colonne « Équivalent »).

| Commande backlog | Équivalent si cwd = `whisperx-studio/` | Couverture |
|------------------|----------------------------------------|------------|
| `cd whisperx-studio && npm run build` | `npm run build` | **Front Player** : `tsc` + `vite build` — `PlayerWorkspaceSection`, `PlayerRunWindowViews`, `usePlayerPlayback`, `usePlayerRunWindow`, `derivePlayerAlerts`, `types` (`QueryWindowRequest` / `QueryWindowResult`), styles `App.css` (`player-*`). |
| `cd whisperx-studio/src-tauri && cargo check` | `(cd src-tauri && cargo check)` | **Rust** : IPC `query_run_events_window`, `list_run_speakers`, `read_run_manifest_summary`, `export_run_timing_pack`, logique `window_slice` / `player_run_commands` alignée avec le front. |
| `cd whisperx-studio && npm run test` | `npm run test` | **Vitest** : utilitaires + `derivePlayerAlerts` + **`PlayerRunWindowViews.test.tsx`** (viewport / erreur IPC / Lanes seek). |

**Champ `scope` du ticket** : pointe les dossiers / fichiers « propriétaires » du Player (UI + `usePlayerPlayback` + commandes Rust + cet audit). Ce n’est pas un substitut aux commandes `execute` : `build` + `cargo check` + `test` restent la barrière minimale avant merge.

---

## Checklist spec vs implémentation (WX-624)

**Légende** : **OK** = couvert en l’état · **Partiel** = existe mais incomplet ou différent de la spec longue · **Non** = pas livré · **v2** = prévu roadmap / hors scope v1 court terme

| Thème | Spec / attente | État | Notes |
|--------|----------------|------|--------|
| **Workspaces** | Player = visualisation sans compute lourd | OK | Lecture média + SQLite + heuristiques alertes ; pas de worker ASR depuis le Player |
| **Entrée** | Open run → Player, run = source de vérité | OK | Manifest + `events.sqlite` via `query_run_events_window` ; média depuis manifest |
| **TopBar** | Libellé run, transport, loop, QC, export | Partiel | QC condensé (alertes fenêtre + stats manifest + troncature) ; pas device CPU/CUDA dans le Player |
| **TopBar** | % interpolé, missing timing (QC détaillé) | Non / v2 | À brancher si exposé par manifest / stats run |
| **Viewport** | 6 modes (**⌃1–6**) : Lanes, Chat, Mots, Colonnes, Rythmo, Karaoké (aligné UI ; spec longue « 5 vues » sans Mots séparé) | Partiel | **Lanes**, **Chat**, **Mots**, **Colonnes** (⌃4), **Rythmo** (⌃5), **Karaoké** (⌃6, WX-651 clos) |
| **Panneau gauche** | Icônes + labels vues | Partiel | Onglets texte Lanes → Karaoké (6) ; hint **⌃1–6** ; case **Fenêtre mots (30s)** + requête `words` |
| **Panneau gauche** | Speakers alias / mute / hide | Non / v2 | Solo locuteur (filtre fenêtre) + clavier 1–9 / 0 |
| **Panneau gauche** | Navigateur next/prev + **jump to time** | Partiel | **N** / **P** (alertes) ; **Aller au temps** (champ + Entrée) |
| **Panneau gauche** | Filtre « alerts only » sur le viewport | Non / v2 | Filtre **type** d’alerte sur la **liste** droite ; pas masquage bulles hors alerte dans Chat |
| **Panneau droit** | Grand public / avancé (seuils, recompute) | Partiel | Liste + filtre + **Avancé** : seuil pause longue (ms), **Recalculer (IPC)** `recompute_player_alerts`, stats QC Rust (WX-652) |
| **Aide** | Liste raccourcis intégrée | OK | **`?`** + bouton barre · overlay **portail** · **Échap** · focus **Fermer** à l’ouverture ; détail `audit/player-multi-view.md` |
| **Transport** | play/pause/stop, seek, vitesse, loop A–B, follow | OK | **Stop**, **Home** / **Fin**, **volume** + **M** muet (persistés **session** `sessionStorage`), **Copier** (**⌃⇧C**), **plein écran** vidéo (**Alt+Entrée** + bouton) ; désactivation follow au scroll panneau événements |
| **Transport** | Événements `playback:tick` / `seek` / `state` (bus) | Partiel | Équivalent React + RAF dans `usePlayerPlayback`, pas bus nommé |
| **ViewportRenderer** | Abstraction `render` / `hitTest` / `getPreferredWindow` | Partiel | Types `PlayerViewportRendererContract` dans `playerViewportContract.ts` ; rendu toujours centralisé dans `PlayerRunWindowViews` |
| **Vue Karaoké** | Bande, mots, virtualisation ±N segments | Partiel | **⌃6** : bande horizontale + préfixe locuteur au changement + virtualisation ±40 mots + suivi lecture (**F**) ; fenêtre mots auto si mode Karaoké |
| **Vue Lanes** | Lanes empilées, turns/pauses/IPU, drag loop, mini-map | Partiel | DOM par fenêtre ; clic tour → seek ; **mini-carte** durée média + fenêtre SQLite + boucle A–B ; **glisser** sur la mini-carte → `setLoopRange` (WX-653) |
| **Vue Colonnes** | Bins time/turn aligned | Partiel | Temps 1s/2s/5s + mode Tours ; scroll horizontal · pas de virtualisation fenêtre > 60s (WX-649 clos) |
| **Vue Rythmo** | NOW fixe, scroll, scrub | Partiel | Liste IPU + repère « lecture » + **barre scrub** (fenêtre courante) + scroll suivi + seek clic IPU (WX-650) |
| **Vue Mots** | surlignage mot courant, words si fenêtre ≤ 30s | Partiel | Chips + **clic → seek** ; pas karaoké continu |
| **Vue Chat** | Bulles, badges, pagination ~50, clic→seek | Partiel | Bulles + playhead + **clic → seek** ; pas badges riches / « only alerts » vue / pagination explicite |
| **Modèle Alert** | Types étendus (IPU court, interpolation, …) | Partiel | Heuristiques `derivePlayerAlerts` (overlap tours, pause longue) ; pas table `alerts` SQLite dédiée |
| **UX alertes** | Liste, next/prev, halo dans vues, heat strip | Partiel | Liste + N/P + seek ; surlignage actif renforcé (Lanes / Chat / Mots) ; pas heat strip |
| **Raccourcis** | Espace, flèches, Shift/Alt, ± vitesse, L, N/P, F, W, ⌃1–6 | Partiel | **⌃1–6** + **⌃⇧C** / **⌃⇧E** / **⌃⇧O** + **W** **L** **0–9** solo ; **⌃4–6** = vues v2 (Colonnes, Rythmo, Karaoké) |
| **Speakers 1–9** | Visibilité par lane | Partiel | **Filtre** SQLite solo (spec longue = visibilité) |
| **IPC** | `query_window` + layers + limits | OK | `query_run_events_window` + `QueryWindowResult` |
| **IPC** | `open_run` / `get_run_status` / `recompute_alerts` / `ensure_envelopes` | Partiel | **`recompute_player_alerts`** (fenêtre + seuil + preset) pour alertes dérivées ; pas `ensure_envelopes` |
| **IPC** | `export_pack` | OK | `export_run_timing_pack` (aligné Explorer) + raccourci **⌃⇧E** dans le Player |
| **Perf front** | Canvas lanes / rythmo | Non | Lanes/Chat en DOM ; spec cible canvas |
| **Perf** | Pas d’IPC à 60 Hz | OK | Grille ~4 Hz + RAF playhead |
| **Perf** | Buffer ±10 s, debounce 50–100 ms | OK | **`playerRunWindowBounds`** + `usePlayerRunWindow` : marge ±10 s, debounce 100 ms, intervalle min entre IPC (WX-654) |
| **Perf** | Budgets ms mesurés (30 / 50 / 150 / 100) | Non | Objectifs backlog ; pas tableau de bord perf intégré |
| **Limites words** | `max_words` + fallback densité | Partiel | Plafonds Rust + `truncated` ; message dégradation à renforcer si besoin |
| **Tests auto** | `execute` build / cargo / test | OK | Vitest : `derivePlayerAlerts`, `karaokeWords`, `playerRunWindowBounds`, RTL `PlayerRunWindowViews` (+ scrub Rythmo, …) |

*Dernière revue (vérif code) : **2026-03-28** — Rythmo : barre scrub sur `[t0,t1]` ; WX-653 / WX-654 comme ci-dessus.*

### Roadmap Player v2 (backlog exécutable)

| Ticket | Sujet |
|--------|--------|
| **WX-649** | Vue **Colonnes** — **fait** (⌃4 : grille temps + mode Tours) |
| **WX-650** | Vue **Rythmo** — **fait** (⌃5 : piste IPU + suivi + scrub fenêtre) |
| **WX-651** | Vue **Karaoké** (bande, surlignage, virtualisation) — remplace placeholder ⌃6 |
| **WX-652** | **IPC `recompute_player_alerts`** + panneau seuils / stats QC — **fait** |
| **WX-653** | **Lanes pro** — **fait** (mini-carte DOM, drag → boucle A–B, canvas laissé en option si besoin) |
| **WX-654** | **Perf** fenêtre SQLite — **fait** (buffer ±10 s, debounce 100 ms, plafond ~10 IPC/s) |

Ordre de priorisation conseillé : **649–654** livrés (Player v2 backlog principal).

---

## Navigation

- Entrée : **Créer un job** → **Open run** (manifest) → **Ouvrir le Player (WX-624)** ; ou onglet **Player** puis contexte avec run déjà choisi.
- Retour : bouton **← Retour** (vue Créer un job par défaut).
- Le workspace Player est un conteneur focalisable (`tabIndex={0}`) : les raccourcis ci-dessous s’appliquent lorsque le focus est dans le Player **et** que la cible n’est pas un champ de saisie (`input` / `textarea` / `contenteditable`).

---

## Raccourcis (focus Player)

| Action | Raccourci |
|--------|-----------|
| Lecture / pause | `Espace` |
| Stop (pause + début) | Bouton **Stop** ou touche **`Home`** |
| Fin de média | Touche **`Fin`** (seek fin si durée connue) |
| Copier position (timecode affiché) | Bouton **Copier**, **`⌃⇧C`** / **`⌘⇧C`**, ou **double-clic** sur le timecode |
| Export pack timing | Bouton barre du haut ou **`⌃⇧E`** / **`⌘⇧E`** |
| Ouvrir le dossier du run | Bouton **Dossier run** ou **`⌃⇧O`** / **`⌘⇧O`** |
| Seek −1 s / +1 s | `←` / `→` |
| Seek −5 s / +5 s | `Shift` + `←` / `→` |
| Seek −0,1 s / +0,1 s | `Alt` + `←` / `→` |
| Vitesse − / + | `-` / `=` (ou pavé `+` / `-`) |
| Volume | Curseur **Vol.** · **M** muet / son (préférences **session** : `wx-player-volume` / `wx-player-muted`) |
| Plein écran (vidéo) | Bouton **Plein écran** · **`Alt`**+**`Entrée`** (élément `<video>`) |
| Suivre la tête dans le viewport (Lanes / Chat / Mots) | `F` (toggle) ; **Suivi** désactivé si l’utilisateur fait défiler le panneau événements |
| Vues (Lanes … Karaoké) | `⌃` `1` … `6` (`⌘` sur macOS accepté) ; **⌃4–⌃6** = Colonnes, Rythmo, Karaoké |
| Aller au temps (seek) | Champ **Navigateur** (secondes, `mm:ss`, `hh:mm:ss`) + **Aller** ou `Entrée` |
| Alerte suivante / précédente (seek) | `N` / `P` (liste filtrée = panneau **droite**) |
| Fenêtre **Mots** (30s, couche SQLite `words`) | Case **panneau gauche** · **`W`** (toggle) · vue **Mots** (⌃3) |
| Boucle A → B → effacer | `L` (média chargé) |
| Solo locuteur (fenêtre d’événements) | `1`–`9` (slot = n-ième locuteur du run, réappuyer = off) ; `0` = tous |
| Aide (liste des raccourcis) | Bouton **Aide (?)** en barre du haut · touche **`?`** (ouvre / ferme) ; **`Échap`** ferme · rendu via **portail** `document.body` |

Les combinaisons **⌃1–6**, **⌃⇧C** (copier position), **⌃⇧E** (export pack), **⌃⇧O** (dossier run) et **N/P** utilisent `ctrlKey` / `metaKey` là où indiqué ; les autres touches sont intentionnellement **sans** modificateur pour rester utilisables dans le Player. Les chiffres **0–9** (solo) sont sans `Ctrl` / `⌘` / `Alt` pour ne pas entrer en conflit avec **⌃1–6** (vues). **Alt+Entrée** (plein écran) utilise **`altKey`** + **`Enter`**, sans `Ctrl` / `⌘`.

### Écarts backlog v1 (WX-624)

- La spec historique parle souvent de **cinq** modes (Karaoké, Lanes, Colonnes, Rythmo, Chat) ; l’UI actuelle expose **six** onglets (**⌃1–6**) en ajoutant **Mots** (⌃3) et la case **Fenêtre mots (30s)** (+ **`W`**). **⌃4–⌃6** ont un rendu **v2** (Colonnes, Rythmo, Karaoké) ; la couche **mots** SQLite est aussi activée automatiquement en mode **Karaoké** (sans cocher la case).
- **Plein écran vidéo** (**Alt+Entrée**, bouton barre) est en **v1** ; absent de certaines specs texte courtes.
- **Navigateur** : champ **Aller au temps** (`parsePlayerTimecodeToSeconds` dans `appUtils`) pour seek, en complément de **N** / **P** (alertes).
- Les touches **1–9** du backlog côté « visibilité speaker » sont implémentées ici comme **filtre locuteur** (solo) sur la fenêtre SQLite, cohérent avec le panneau Filtres.
- **N** / **P** respectent le filtre **type d’alerte** choisi dans le panneau droit (liste déroulante), pas seulement la liste complète.

---

## Cohabitation avec l’éditeur / Alignment

- Les raccourcis du Player ne sont actifs que lorsque le **focus** est sur le root du Player (pas dans l’historique, pas dans l’éditeur transcript de l’onglet **Historique & run**).
- L’éditeur et la zone Alignment conservent leurs propres liaisons ; pas de chevauchement tant que le focus reste contextuel.

---

## Données et IPC

- Fenêtre temporelle : `query_run_events_window` avec debounce / grille (~4 Hz max) — pas d’IPC à 60 Hz ; le timecode lecture reste côté média (RAF dans `usePlayerPlayback`).
- Export timing pack : commande **`export_run_timing_pack`** (JSON + SRT + CSV à partir de `timeline_json` / `run_json` du manifest), alignée sur le pack depuis l’Explorer.

---

## Exemples `WindowSlice` / requête fenêtre

La forme **`QueryWindowRequest`** / **`QueryWindowResult`** est définie dans `whisperx-studio/src/types.ts` (champs `t0Ms`, `t1Ms`, `layers`, `limits`, tables `words` / `turns` / `pauses` / `ipus`, `truncated`).
