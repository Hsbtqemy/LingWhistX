# LingWhistX — Audit UI/UX, design system cible, navigation & plan d’implémentation

**Document** : spécifications actionnables post-refactor (WX-625).  
**Hypothèses** : UI en français ; desktop Tauri (Windows 11 + macOS) ; pas de changement de pipeline métier dans ce document ; les couleurs actuelles (teal `#0f8a94`, fond `#f3f8f7`) servent de base de continuité.

**Backlog exécutable** : tâches **WX-626** à **WX-637** dans `whisperx-studio/backlog/backlog.json` (scripts `backlog.ps1` : `list`, `ready`, `next`). Libellé workspace **« Studio »** provisoire (WX-633) ; arbitrage nom final **WX-637**.

---

## A) Audit UX (factuel)

Gravité : **High** = bloque compréhension ou risque d’erreur ; **Med** = friction récurrente ; **Low** = polish.

| ID | Gravité | Écran / zone | Composant(s) | Problème | Impact |
|----|---------|--------------|--------------|----------|--------|
| A1 | **High** | Accueil + workspace | `StudioNav` | Les libellés « Créer un job », « Historique & run », « Player », « À propos » ne décrivent pas un **parcours** (pas de “Compute” vs “Explorer”). Le joueur est accessible sans run chargé (`Player` tab) alors que `PlayerWorkspaceSection` affiche un vide si `runDir` null. | Charge cognitive : où commencer ? Clic Player sans contexte. |
| A2 | **High** | `StudioWorkspaceSection` | `StudioExplorerTopBar` + `JobsHistoryPanel` + `RunDetailsPanel` | **Pas de séparation visuelle forte** entre (a) actions globales run, (b) job sélectionné, (c) analyse légère. La barre Explorer empile **4 rangées** (actions, meta, chips, nav) + import ; tout en `ghost` + densité variable. | Hiérarchie floue ; actions “Indexer” vs “Export pack” vs “Pause suivante” mélangées. |
| A3 | **Med** | Explorer sidebar | `StudioExplorerSidePanels` | Section « Calques » avec texte *« Branchement requêtes timeline à venir »* — **état produit incohérent** pour l’utilisateur (cases à cocher sans effet clair sur le canvas). | Méfiance / désactivation des calques. |
| A4 | **Med** | Explorer | `StudioExplorerChrome` | « Overlap suivant » **disabled** avec tooltip « à brancher » — **discoverability négative** (bouton mort visible). | Frustration, perception d’inachèvement. |
| A5 | **Med** | Créer un job | `WhisperxOptionsForm` | `Profil rapide`, modèle, langue, device, compute, **diarize**, **chunking**, **analyse** (pauses/IPU), exports — **dans un seul flux vertical** sans groupement visuel “coûteux vs rapide”. | Risque perçu : tout semble coûteux ; en réalité le recalc Explorer est séparé côté backend mais pas côté **story** UI sur l’accueil. |
| A6 | **Med** | Global | `App.css` | **~3000 lignes** ; tokens partiels (`:root` + `--home-accent` seulement) ; centaines de `.explorer-*`, `.panel-*`, media queries dupliquées. | Dette CSS, incohérences radius (12px / 20px), ombres multiples. |
| A7 | **Med** | Détails run | `RunDetailsPanel` | Colonne unique `details-layout` + sous-panneaux ; pas de **onglets primaires** “Lecture / Fichiers / Alignement / Transcript” au niveau supérieur. | Scroll long ; perte de contexte job. |
| A8 | **Low** | Navigation | `StudioNav` | Onglets `role="tablist"` mais **pas de `tabpanel`** associé par id — pattern ARIA incomplet. | Accessibilité lecteurs d’écran. |
| A9 | **Low** | Boutons | `button.ghost` partout | Faible contraste de différenciation **primaire / secondaire / danger** (sauf `.primary` ponctuel). | Clics hésitants sur actions destructives ou coûteuses. |
| A10 | **Low** | Explorer recalc | `explorer-recalc-grid` | Champs texte pour nombres ; pas de **bornes visibles** dans l’UI (min/max) — la validation est message d’erreur après coup. | Erreurs évitables. |

**Forces actuelles (à préserver)** :  
- Recalc Pauses/IPU (`StudioExplorerChrome`) est **explicitement** documenté comme Rust, sans Whisper — bon alignement produit.  
- `PlayerWorkspaceSection` : transport + QC + shortcuts help — **bonne densité** pour power users.  
- `empty-state-card` sur `RunDetailsPanel` — pattern clair quand pas de job.

---

## B) Proposition d’architecture UI

### B.1 Workspaces recommandés (libellés “grand public”)

| Workspace | Contenu actuel mappé | Objectif utilisateur |
|-----------|----------------------|----------------------|
| **Accueil** | `activeView === "create"` (`StudioHero`, `StudioOpenRunSection`, `StudioNewJobSection`) | Ouvrir un run récent, lancer un traitement, **sans jargon GPU**. |
| **Travail** (nom interne `workspace`) | `StudioWorkspaceSection` | Explorer timeline + job sélectionné + éditeur : **cœur de la journée**. |
| **Lecture** | `PlayerWorkspaceSection` | Écouter, contrôler, alertes, QA fenêtre — **sans** créer de job. |
| **Système** | `StudioAboutView` + diagnostic runtime | Versions, chemins, FFmpeg, dépannage. |

**Renommage UI (exemples)** :  
- « Créer un job » → **« Accueil »** ou **« Nouveau traitement »** (à trancher produit).  
- « Historique & run » → **« Studio »** ou **« Travail »**.  
- « À propos & diagnostic » → **« Aide & système »**.

### B.2 Comportement Player sans run

**Règle** : si `playerRunDir === null`, afficher un **panneau d’appel** (CTA) : « Ouvrir un run depuis l’accueil » avec bouton **vers Accueil** ou **vers Travail** — **ne pas** laisser l’onglet Lecture vide sans explication.

### B.3 Layout cible par workspace

#### Accueil (grille simple)

```
┌─────────────────────────────────────────────────────────────┐
│ [Logo] Accueil │ Studio │ Lecture │ Aide          (topbar)  │
├─────────────────────────────────────────────────────────────┤
│  Héros (1 phrase) + CTA principal                          │
├──────────────────────────┬──────────────────────────────────┤
│  Ouvrir run (récent)     │  Nouveau traitement (formulaire) │
│  (liste cartes)          │  (sections repliables)           │
└──────────────────────────┴──────────────────────────────────┘
```

- **Par défaut** : sections formulaire **repliées** sauf « Fichier média » + « Profil rapide ».  
- **Mode Avancé** (toggle global sur la page) : affiche device, compute, chunking, diarize, tous les sliders d’analyse.

#### Studio (Travail) — 3 colonnes

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Explorer bar : run actif | média | actions index/export | stats chips      │
├──────────┬─────────────────────────────────────────────────┬───────────────┤
│ Jobs     │  Run details (méta + onglets) + waveform      │ Calques       │
│ (liste)  │  + éditeur transcript (si actif)                │ Locuteurs     │
│          │                                                  │ Pauses/IPU    │
└──────────┴─────────────────────────────────────────────────┴───────────────┘
```

- **Par défaut** : panneau droit **Calques + Locuteurs** visible ; **Pauses/IPU** replié ou onglet « Avancé ».  
- **Avancé** : affiche tous les champs recalc, options de fenêtre query, limites max_words.

#### Lecture (Player)

```
┌─────────────────────────────────────────────────────────────┐
│ [Retour] Run | Transport | Timecode | QC | Export | Aide   │
├──────────┬──────────────────────────────┬────────────────────┤
│ Vues     │  Vidéo / events              │ Alertes            │
│ (tabs)   │  (viewport)                  │ (liste)            │
└──────────┴──────────────────────────────┴────────────────────┘
```

- **Par défaut** : mode Lanes ou Chat + liste alertes filtrée **Toutes**.  
- **Avancé** : fenêtre mots 30s, solo clavier, filtres overlap, etc. (déjà partiellement dans `PlayerWorkspaceSection`).

### B.4 Wireframes ASCII — Studio Explorer topbar (réorganisation)

```
┌─ Run ─────────────────────────────────────────────────────────────┐
│ [Ouvrir dossier] [Ouvrir fichier]  |  Média: fichier · durée   │
│ [Indexer] [Export pack timing]     |  Device · Py/WX/ff        │
├─ Navigation temps ────────────────────────────────────────────────┤
│ [Pause suivante]  Aller: [____] [Go]   (Overlap suivant masqué   │
│  ou dans Avancé si non branché)                                    │
├─ Stats ───────────────────────────────────────────────────────────┤
│ Mots | Segments | Locuteurs | Overlaps (manifest)               │
└───────────────────────────────────────────────────────────────────┘
```

**Règles** :  
- **Une seule ligne primaire** d’actions destructrices/indexation ; **secondaire** navigation temps.  
- Chips **non cliquables** = style `Badge` neutre (pas `button`).

---

## C) Mini design system (implémentable)

### C.1 Tokens CSS (proposition — préfixe `--lx-`)

| Token | Valeur suggérée | Usage |
|-------|-----------------|------|
| `--lx-surface-0` | `#f3f8f7` | fond app |
| `--lx-surface-1` | `#ffffff` @ 94% opacity | cartes |
| `--lx-surface-2` | `rgba(222,243,241,0.45)` | listes sélectionnées |
| `--lx-text-0` | `#072029` | texte principal |
| `--lx-text-1` | `#33535b` | secondaire |
| `--lx-text-2` | `#53727a` | hints |
| `--lx-border` | `rgba(9,69,76,0.1)` | bordures |
| `--lx-accent` | `#0f8a94` | primaire |
| `--lx-accent-hover` | `#0c6f77` | hover |
| `--lx-danger` | `#b42318` | erreur destructive |
| `--lx-warning` | `#8a4b16` | warnings (déjà proche) |
| `--lx-font-sans` | `ui-sans-serif, system-ui, ...` | body |
| `--lx-font-mono` | `ui-monospace, SFMono-Regular, ...` | chemins, timecode |
| `--lx-text-xs` | `0.72rem` | méta |
| `--lx-text-sm` | `0.85rem` | corps secondaire |
| `--lx-text-md` | `1rem` | corps |
| `--lx-text-lg` | `1.125rem` | titres section |
| `--lx-space-1` | `4px` | — |
| `--lx-space-2` | `8px` | — |
| `--lx-space-3` | `12px` | — |
| `--lx-space-4` | `16px` | — |
| `--lx-space-5` | `24px` | — |
| `--lx-radius-sm` | `8px` | inputs |
| `--lx-radius-md` | `12px` | boutons, cards |
| `--lx-radius-lg` | `20px` | panneaux home |
| `--lx-shadow-card` | `0 22px 48px rgba(6,39,44,0.06)` | cartes |
| `--lx-focus-ring` | `0 0 0 2px #fff, 0 0 0 4px var(--lx-accent)` | focus visible |

**États** : mapper `hover` / `active` / `focus-visible` / `disabled` (opacity 0.55 + `cursor: not-allowed`) sur tous les contrôles interactifs — aujourd’hui partiel (`button:hover` exclut `studio-nav-tab`).

### C.2 Composants génériques (specs)

| Composant | Fichier cible suggéré | Props | États | A11y |
|-----------|------------------------|-------|-------|------|
| `Button` | `components/ui/Button.tsx` | `variant: primary \| secondary \| ghost \| danger`, `size`, `disabled`, `loading`, `children`, `iconLeft?` | hover, active, focus-visible, disabled | `type="button"`, `aria-busy` si loading |
| `Toggle` | `components/ui/Toggle.tsx` | `checked`, `onChange`, `label`, `description?` | — | `role="switch"` + `aria-checked` |
| `Select` | wrapper | `value`, `onChange`, `options`, `label` | — | `label` + `htmlFor` |
| `Slider` | wrapper | `min`, `max`, `step`, `value`, `onChange`, `showValue` | — | `aria-valuemin/max/nowtext` |
| `Badge` | `components/ui/Badge.tsx` | `tone: neutral \| info \| warning \| success` | — | `span` + `role="status"` si dynamique |
| `Tooltip` | `components/ui/Tooltip.tsx` | `content`, `children` | — | éviter infos critiques **uniquement** en tooltip |
| `Modal` | `components/ui/Modal.tsx` | `open`, `onClose`, `title`, `children` | — | focus trap, `aria-modal`, Escape |
| `Tabs` | `components/ui/Tabs.tsx` | `tabs: {id,label}[]`, `activeId`, `onChange`, `panels` | — | `role="tablist"` + `aria-controls` / `id` |
| `Panel` | `components/ui/Panel.tsx` | `title`, `subtitle?`, `actions?`, `children`, `variant` | — | `section` + `aria-labelledby` |
| `DataTable` | `components/ui/DataTable.tsx` | `columns`, `rows`, `density` | — | `<table>` sémantique ou grid avec `role` |
| `Toast` | `components/ui/Toast.tsx` | `message`, `tone`, `onDismiss` | — | `role="status"` / `alert` |

### C.3 Composants domaine (specs)

| Composant | Source actuelle | Props | Notes |
|-----------|-----------------|-------|--------|
| `LayerList` | `StudioExplorerSidePanels` | `layers: ExplorerLayerToggles`, `onToggle(key)` | Une ligne = Toggle + label ; désactiver **overlap** si non branché au lieu de checkbox muette. |
| `SpeakerList` | idem | `rows`, `onAlias`, `onVisibility`, `onSolo` | Grouper **solo** + visibilité ; `aria-label` sur chaque ligne. |
| `AlertList` | `PlayerWorkspaceSection` (droit) | `alerts`, `filter`, `onSeek` | Filtrer par type ; **bouton ligne** = seek. |
| `TransportControls` | `PlayerTopBar` | `playing`, `onPlayPause`, `seek`, `rate`, … | Déjà proche ; unifier styles avec Explorer nav. |
| `StatsCard` | chips Explorer | `items: {label, value, hint?}[]` | Remplacer `span` empilés par grille **4 colonnes max** responsive. |

---

## D) Refonte Explorer (cœur)

### D.1 Mode grand public vs Avancé

| Élément | Grand public | Avancé |
|---------|--------------|--------|
| **Calques** | Turns, Pauses, Mots, Segments (4 toggles max) | + Overlap, IPU, auto-zoom mots |
| **Locuteurs** | Liste + alias + visible | + Solo |
| **Pauses/IPU** | **Bloc replié** ; CTA « Ajuster les seuils » ouvre panneau | Tous les champs + stats détaillées + `Appliquer → SQLite` |
| **Topbar** | 3 groupes max (Fichier / Index+Export / Navigation temps) | Ligne complète + overlap suivant si branché |
| **Indexation** | Libellé explicite : « Préparer la timeline (index local) » | Tooltip technique SQLite |

### D.2 Densité d’information (quoi afficher quand)

| Contexte | Afficher | Masquer / différer |
|----------|----------|-------------------|
| Pas d’index SQLite | Calques **désactivés** ou tooltip « Indexer d’abord » | Pas de requête words lourde |
| Index OK | Words + turns sur waveform ; pauses/IPU si calques activés | IPU si fenêtre > 30s : message **déjà** dans Player (`sliceTruncation`) — répliquer hint dans Explorer si même query |
| Éditeur ouvert | Réduire sidebar Explorer (toggle) | — |

### D.3 Perf UI (règles)

1. **Fenêtre temporelle** : ne jamais charger > 30s de **words** sans opt-in explicite (déjà `wordsWindowEnabled` côté Player).  
2. **Explorer** : `usePlayerRunWindow` / `query_run_events_window` — respecter `limits` (`DEFAULT_MAX_*` côté Rust).  
3. **Canvas** : pas de re-render 60 Hz sur liste d’événements — conserver virtualisation / fenêtre (spec `player-multi-view.md`).  
4. **debounce** recalc preview (~320 ms) — **ne pas** réduire sans mesure perf.

### D.4 Raccourcis (Explorer — alignement Player)

À documenter dans une **aide unique** (pas dupliquer les listes) :  
- Cohérence des libellés avec `PlayerWorkspaceSection` (Espace, flèches, etc.).  
- Explorer : ajouter raccourcis **optionnels** pour « Pause suivante » / « Go » si focus dans le shell — aujourd’hui partiel (`useStudioExplorer` pas de handler global documenté dans la même aide que Player).

---

## E) Plan de mise en œuvre (PRs)

| PR | Titre | Scope | Definition of Done |
|----|-------|-------|-------------------|
| **PR1** | Tokens + reset CSS | `App.css` : introduire `--lx-*`, mapper body + `.studio-shell` | Aucun changement visuel > 5% (pixel-diff optionnel) ; build OK |
| **PR2** | `Button` + `Badge` | Remplacer `ghost`/`primary` sur `StudioNav` + 1 écran pilote | Focus visible uniforme ; tests visuels manuels |
| **PR3** | `Panel` + `Tabs` | `RunDetailsPanel` : onglets Méta / Fichiers / Alignement / Transcript | Navigation clavier entre onglets ; pas de régression données |
| **PR4** | Explorer topbar regroupée | `StudioExplorerChrome` : 3 lignes max, `StatsCard` | Lighthouse accessibilité non régressé |
| **PR5** | Mode Avancé (formulaire job) | `StudioNewJobSection` + `WhisperxOptionsForm` : `<details>` ou toggle | Profil rapide visible ; reste plié par défaut |
| **PR6** | Explorer sidebar | `LayerList` + retrait texte “à venir” ou feature-flag | Calques soit fonctionnels, soit masqués |
| **PR7** | Player empty state | `PlayerWorkspaceSection` si `!runDir` | CTA clair ; pas d’écran vide |
| **PR8** | Navigation ARIA | `StudioNav` : `tab` + `tabpanel` ids | Test lecteur d’écran macOS VoiceOver |
| **PR9** | Toast erreurs | centraliser `setError` + pile | Déjà `useAppErrorStack` — aligner style |
| **PR10** | Doc utilisateur 1 page | `docs/` ou README | Parcours “ouvrir run → indexer → recalcul léger” |

**Quick wins** (ordre 1–3) : tokens, boutons, espacements (8px grid) sur `Explorer` + `Nav`.  
**Risques** :  
- **Dette CSS** : migration progressive par préfixe `.lx-` ou `data-theme`.  
- **mac/win** : tester `font-size` 100% + zoom OS ; `prefers-reduced-motion` déjà partiellement dans Player — étendre.  
- **Perf** : éviter `box-shadow` lourds sur listes longues (`JobsHistoryPanel`).

---

## F) Validation

### F.1 Checklist QA

- [ ] Contraste texte/fond sur **tous** les boutons `ghost` et `primary` (≥ 4.5:1 pour texte normal).  
- [ ] **Focus visible** : Tab à travers `StudioNav`, Explorer, formulaire job, Player.  
- [ ] **Navigation clavier** : modales (Échap), aide raccourcis (`?`).  
- [ ] **Fenêtre redimensionnée** : 1280, 1024, 900px — pas de collapse sidebar bloquant.  
- [ ] **Zoom OS** : 125 % / 150 % — pas de chevauchement topbar.  
- [ ] **Hi-DPI** : canvas waveform sans flou (déjà `devicePixelRatio` côté canvas si applicable).  

### F.2 Scénarios utilisateurs

| Scénario | Étapes | Succès |
|----------|--------|--------|
| **Ouvrir un run** | Accueil → run récent OU Ouvrir dossier → Studio → job sélectionné | Méta visible + waveform + pas d’erreur vide |
| **Recalibrer pauses** | Explorer → indexer si besoin → **Pauses/IPU** → modifier seuils → Aperçu OK → Appliquer | Stats mises à jour ; pas de relance Whisper |
| **Sauter à une alerte** | Player → liste alertes → clic ligne | Seek vers `startMs` ; message si hors fenêtre |
| **Export pack timing** | Explorer topbar **Export pack timing** OU Player **Export** | Fichiers écrits ; hint dernier chemin |

---

## Fin du document

Prochaine étape recommandée : **PR1–PR2** (tokens + Button/Badge) puis maquette **Studio** topbar (PR4).
