# Audit global — LingWhistX / WhisperX Studio

**Date :** 2026-03-28  
**Dépôt :** `LingWhistX` (racine)  
**Périmètre :** application **whisperx-studio** (React + Vite + Tauri 2), worker Python, workflows GitHub Actions, documentation d’audit existante.

---

## 1. Résumé exécutif

| Domaine | Verdict | Détail |
|--------|---------|--------|
| **Build front** | OK | `npm run build` (tsc + vite) sans erreur |
| **Tests JS/TS** | OK | Vitest : **143** tests sur **32** fichiers |
| **Lint ESLint** | **Attention** | **0 erreur**, **5 avertissements** `react-hooks/exhaustive-deps` (voir §6) |
| **Rust** | OK | `cargo clippy -- -D warnings` sans erreur |
| **Tests Rust** | OK | Suite unitaire Tauri (smoke + modules) |
| **Python (worker)** | OK | **23** tests `unittest` OK |
| **Backlog JSON** | OK | **96** entrées `WX-*`, toutes en statut **`done`** |
| **CI** | OK (déclaré) | Workflow `studio-ci.yml` : Prettier, Python, build, ESLint, Vitest, cargo check/fmt/clippy/test |

**Conclusion :** la base est **prête pour le développement et la release** au sens des barrières automatisées. La dette principale observable immédiatement est **cosmétique / hooks React** (warnings ESLint), pas des échecs de build ou de tests.

---

## 2. Méthodologie

Commandes exécutées localement (macOS) lors de l’audit :

- `cd whisperx-studio && npm run test`
- `cd whisperx-studio && npm run build`
- `cd whisperx-studio && npm run lint`
- `cd whisperx-studio/src-tauri && cargo clippy -- -D warnings`
- `cd whisperx-studio && python -m unittest discover -s python -p 'test_*.py' -q`

Inventaire approximatif :

- ~**147** fichiers `.ts` / `.tsx` sous `whisperx-studio/src`
- ~**31** fichiers `.rs` sous `whisperx-studio/src-tauri/src`

Recherche de marqueurs de dette dans `whisperx-studio/src` : **aucun** `TODO` / `FIXME` / `HACK` / `XXX` trouvé (recherche textuelle sur `*.ts` / `*.tsx`).

---

## 3. Architecture (vue d’ensemble)

- **UI :** React 19, Vite 7, styles principalement dans `src/styles/main.css` + tokens.
- **Bureau :** Tauri 2 (`src-tauri/`) : jobs, runs, transcript, waveform, **SQLite événements** (`query_run_events_window`, `recompute_player_alerts`, etc.).
- **Worker :** Python sous `whisperx-studio/python/` (pipeline côté job ; tests unitaires dédiés).
- **Audits thématiques** (racine `audit/`) : Player multi-vues (`player-multi-view.md`), pipeline, roadmap historique, reprise 2026-03-20, etc.
- **Revue fichier** : `whisperx-studio/audit/review-2026-03-27/` (inventaire + modules + synthèse risques).

---

## 4. Player & produit récent (WX-624 / v2)

Le **roadmap Player v2** documenté dans `audit/player-multi-view.md` couvre les tickets **WX-649 à WX-654** (Colonnes, Rythmo, Karaoké, alertes IPC, Lanes mini-carte, perf fenêtre SQLite). L’audit checklist du même fichier est **aligné** avec l’implémentation actuelle (vues, scrub Rythmo, buffer IPC, panneau seuils).

Pour le détail fonctionnel et les limites résiduelles (ex. canvas lanes, heat strip d’alertes), se référer à **`audit/player-multi-view.md`**.

---

## 5. CI/CD

Fichier principal : **`.github/workflows/studio-ci.yml`**

- Déclenché sur `push` / `PR` vers `main` pour les chemins `whisperx-studio/**`, `whisperx/**`.
- Matrice **windows / ubuntu / macos**.
- Étapes : Prettier, **Python** (`py_compile` + unittest), **npm run build**, **ESLint**, **Vitest**, **cargo** check / fmt / clippy / test.

Autres workflows présents : sécurité Python, compatibilité Python, build/release, e2e audio nightly — à consulter pour le périmètre exact.

---

## 6. ESLint — avertissements restants

Après correction d’une **erreur** (`no-unused-vars` sur le handler d’erreur média dans `usePlayerPlayback.ts`), il reste **5 warnings** :

| Fichier | Sujet |
|---------|--------|
| `PlayerWorkspaceSection.tsx` | `useEffect` / `useCallback` — dépendances `wf`, `runWindow.slice` |
| `usePlayerKeyboard.ts` | `useCallback` — dépendance `o` |
| `usePlayerRunWindow.ts` | `useEffect` — `speakersFilter` vs `speakersKey` |
| `useWaveformWorkspace.ts` | `useEffect` — `getActiveMediaElement` |

Ces motifs sont souvent **volontaires** (stabilisation volontaire des deps, ou clés dérivées). Recommandation : traiter **au cas par cas** (commentaire `eslint-disable-next-line` justifié, ou refactor léger) pour tendre vers **0 warning** en CI si la politique d’équipe le demande.

---

## 7. Documentation d’audit existante (index)

| Document | Rôle |
|----------|------|
| `audit/README.md` | Index des audits historiques |
| `audit/player-multi-view.md` | Spec vs impl Player, raccourcis, IPC, roadmap v2 |
| `audit/audit-resume-2026-03-20.md` | Reprise post-correctifs |
| `audit/workspace-audit.md` | Inventaire workspace |
| `audit/implementation-roadmap.md` | Roadmap implémentation |
| `whisperx-studio/audit/review-2026-03-27/*` | Revue par fichiers / modules |

---

## 8. Recommandations priorisées

1. **ESLint hooks :** réduire les 5 warnings ou les documenter explicitement pour éviter la dérive lors des refactors.
2. **Tests d’intégration :** les tests actuels sont majoritairement **unitaires / RTL ciblés** ; pour les parcours critiques (Open run → Player → export), s’appuyer sur `smoke-e2e` / stratégie produit existante.
3. **Perf réelle :** les budgets IPC Player sont **documentés** (`playerRunWindowBounds`, audit) ; une mesure occasionnelle sur run **long** (≥ 2 h) reste utile pour valider les ordres de grandeur côté SQLite.
4. **Sécurité / dépendances :** suivre les workflows `security-python.yml` et les mises à jour npm/cargo selon la politique du projet.

---

## 9. Synthèse

Le dépôt **LingWhistX** présente une **chaîne de qualité solide** : tests front, worker Python, backend Rust, et CI multi-OS. Le backlog **`whisperx-studio/backlog/backlog.json`** est entièrement marqué **done** pour les entrées présentes ; les évolutions futures devront ajouter de nouveaux tickets ou rouvrir des axes (thème waveform canvas, enrichissements QC, etc.) selon la roadmap produit.

*Document généré dans le cadre d’un audit demandé ; à compléter après revue humaine des risques métier et de la sécurité des chemins fichiers (Tauri).*
