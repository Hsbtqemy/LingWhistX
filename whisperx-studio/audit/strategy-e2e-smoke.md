# Stratégie E2E & smoke — WhisperX Studio

**Objectif** : garder une **barrière automatique** minimale quand les releases s’accélèrent, sans confondre « build installateur » et « comportement navigateur ».

## Couches actuelles

| Couche | Commande / emplacement | Ce que ça garantit |
|--------|------------------------|--------------------|
| **Unitaires / intégration front** | `npm run test` (Vitest) | Logique React, hooks, composants isolés. |
| **Backend Tauri** | `cargo test` (CI) | Inclut `smoke_mock_edit_export_flow` (transcript / worker mock). |
| **Smoke navigateur (SPA)** | `npm run smoke:web` ou `npm run smoke:browser` | Build prod + **Puppeteer** sur `vite preview` : chargement du shell, `[data-testid="studio-app-root"]`, onglet Studio, bouton aide. **Pas de fenêtre Tauri** — uniquement le bundle web. |
| **Smoke release (Windows)** | `npm run smoke:e2e` (`scripts/smoke-e2e.ps1`) | `npm run build`, `cargo check`, test Rust smoke, **`tauri build`**, artefacts MSI/EXE + hashes. **À réserver aux release** (long, machine Windows). |

## Scénario critique automatisé (recommandé CI)

1. **`npm run build`** (déjà en CI).
2. **`npm run smoke:browser`** : démarre `vite preview` (sauf si `SMOKE_URL` fourni), ouvre Chromium headless, vérifie le shell LingWhistX.

C’est le **scénario critique** retenu : **régression de chargement / routage / layout** du Studio (plus de valeur que du pur snapshot sans coût Tauri).

## Quand accélérer la release

- **CI** : la smoke navigateur est **déjà branchée** sur `studio-ci.yml` après Vitest.  
- **Local** : `npm run smoke:web` avant tag si vous ne lancez pas le pipeline complet.
- **Ne pas** remplacer le smoke **PS1** (`smoke:e2e`) par la smoke navigateur : l’installateur et les artefacts restent un contrôle séparé.

## Évolutions possibles (hors scope immédiat)

- **Playwright** + projet Tauri : lancer l’app binaire et piloter la fenêtre (vrai E2E desktop) — coût CI, cache navigateur, flakiness.
- **Scénario secondaire** : ouvrir un panneau, lancer un job mock — dépend du runtime Python / worker en CI.
- **Matrice** : si la durée CI augmente, restreindre `smoke:browser` à **un** OS (ex. `ubuntu-latest`) uniquement.

## Variables utiles

| Variable | Rôle |
|----------|------|
| `SMOKE_URL` | URL du preview si déjà démarré (évite le double `vite preview`). |
| `SMOKE_HEADLESS=0` | Afficher le navigateur (debug local). |
| `PUPPETEER_*` | Variables officielles Puppeteer (ex. binaire Chromium si besoin). |

## Dépannage

| Problème | Piste |
|----------|--------|
| `Timeout waiting for HTTP` | Port **4173** déjà pris — arrêter l’autre `vite preview` ou utiliser `SMOKE_URL` vers un autre port. |
| `smoke:browser` sans `dist/` | Lancer d’abord **`npm run build`** (ou `npm run smoke:web`). |
| Échec sélecteurs | Vérifier `data-testid="studio-app-root"` sur `<main>`, vue par défaut **workspace** (onglets visibles). |
| CI Linux | Chromium embarqué par Puppeteer ; flags `--no-sandbox` déjà passés pour les runners GitHub. |

## Comportement du script (`scripts/smoke-browser.mjs`)

- **`page.goto`** utilise `waitUntil: "load"` (pas `networkidle`) pour limiter les faux négatifs si une ressource reste en vol.
- Arrêt du sous-processus **`vite preview`** dans un `finally` (y compris si Puppeteer ou les assertions échouent).
