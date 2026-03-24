# Plan refactor — découpage & hooks (LingWhistX Studio + whisperx)

**Backlog** : tâche **WX-625** (`whisperx-studio/backlog/backlog.json`) — suivi des phases ci-dessous.

Objectif : **réduire la complexité cyclomatique**, **tester plus facilement** (Vitest), et **limiter les régressions** en découpant par **responsabilité** sans changer le comportement produit par vagues.

**Principes**
- Une PR = un axe (un gros fichier ou une famille de hooks), avec `build` + `test` + `cargo check` verts.
- Conserver les **APIs publiques** des hooks/composants tant que possible ; renommer/exporter seulement quand le découpage est stable.
- Pas de refonte UX ni de nouvelles features dans les mêmes PRs que le découpage.

---

## Phase 0 — Cartographie (½ j)

- Lister tailles / deps : `useTranscriptEditor.ts`, `useStudioExplorer.ts`, `PlayerWorkspaceSection.tsx`, `transcribe.py` (`transcribe_task`).
- Noter les **effets de bord** : IPC Tauri, `localStorage`, raccourcis globaux, RAF waveform.

---

## Phase 1 — Front : erreurs & shell (faible risque) — **fait**

| Livrable | Action |
|----------|--------|
| `useAppErrorStack` | Extraire de `App.tsx` la logique `appErrors` + `setError` (pile max 5, clear sur `""`). |
| Tests | `useAppErrorStack.test.tsx` (Vitest). |

**Critère de done** : `App.tsx` allégé ; comportement identique ; hook testé.

---

## Phase 2 — `useTranscriptEditor` (priorité haute, risque moyen) — **livrée (optionnel : `useEditorSegmentsState` seulement)**

Découpage **vertical** recommandé (fichiers sous `hooks/transcript/` ou `hooks/editor/`) :

| Hook / module | Responsabilité |
|-----------------|----------------|
| `useEditorSegmentsState` | `segments`, setters — **optionnel** (cœur encore dans `useTranscriptEditor`) |
| `transcriptSegmentMutations` | redimensionnement / texte / fusion — **fait** (pur, `transcriptSegmentMutations.ts`, tests) |
| `useTranscriptWaveformInteraction` | souris waveform, drag bords, undo drag — **fait** (`useTranscriptWaveformInteraction.ts`) |
| `useEditorHistory` | undo / redo, snapshots — **fait** (`hooks/transcript/useEditorHistory.ts`, tests `useEditorHistory.test.tsx`) |
| `useEditorDraftPersistence` | brouillon, autosave, chemins draft — **fait** (`hooks/transcript/useEditorDraftPersistence.ts`, tests `useEditorDraftPersistence.test.tsx`) |
| `useEditorQa` | issues QA, auto-fix si isolé — **fait** (`hooks/transcript/useEditorQa.ts`, tests `useEditorQa.test.tsx`) |
| IPC Tauri (`transcriptEditorTauri`) | `invoke` load/save/export transcript — **fait** (`hooks/transcript/transcriptEditorTauri.ts`, tests `transcriptEditorTauri.test.ts`) |
| Chargement / pack export | `loadTranscriptFromPath`, `exportTimingPackSequential` — **fait** (`transcriptEditorLoad.ts`, `transcriptEditorExportSequences.ts`, tests) |
| Save / export (garde + `isSaving`) | `transcriptEditorIoHelpers` — **fait** (`transcriptEditorIoHelpers.ts`, tests) |
| Split / merge / nav clavier | `transcriptEditorSplitMerge`, `transcriptEditorNavigation` — **fait** (tests) |
| `useTranscriptEditor` | **compose** les hooks ci-dessus, expose l’API actuelle |

**Ordre d’extraction** (du moins couplé au plus couplé) :
1. Historique (undo/redo) si frontière claire dans le fichier.
2. Draft / autosave.
3. QA + raccourcis clavier (souvent mélangés — dernier passage).

**Critère de done** : aucun changement visible ; tests existants + smoke manuel éditeur (ouverture, édition, export).

---

## Phase 3 — `useStudioExplorer` & workspace (risque moyen) — **fait**

- Identifier blocs : **run sélectionné**, **waveform**, **recalc pauses/IPU**, **navigation temps**.
- Extraire `useExplorerRunContext` + `useExplorerRecalc` (noms indicatifs) si les dépendances le permettent.
- Éviter de dupliquer `setError` : réutiliser `useAppErrorStack` si Phase 1 faite.

**Livré (2026-03)** : `useExplorerRecalc` + `buildRecalcPausesIpuConfig` (`studioExplorerRecalcConfig.ts`), persistance calques `studioExplorerLayers.ts`, `formatDuration` / `parseOptionalFloat` (`studioExplorerUi.ts`) ; **`useExplorerRunContext`** (`manifest` depuis le job sélectionné, ouverture run/fichier, import events, speakers UI) ; `useStudioExplorer` ne fait plus que composer recalc + run + calques + navigation temps + mémos barre d’état. `setError` injecté depuis `App` via `useAppErrorStack`.

---

## Phase 4 — Player (WX-624) (risque faible à moyen) — **fait**

| Livrable | Action |
|----------|--------|
| `usePlayerKeyboard` | Raccourcis dans `PlayerWorkspaceSection` (déjà volumineux). |
| `PlayerTopBar` / `PlayerJumpPanel` | Sous-composants présentationnels + props stables. |

**Critère de done** : mêmes raccourcis ; pas de changement IPC.

**Livré (2026-03)** : `whisperx-studio/src/hooks/usePlayerKeyboard.ts` (logique inchangée) ; `PlayerTopBar.tsx` / `PlayerJumpPanel.tsx` ; `PlayerWorkspaceSection` allégé (layout + portal aide + panneaux).

---

## Phase 5 — Python `whisperx` (risque moyen, tests à ajouter) — **fait**

| Livrable | Action |
|----------|--------|
| `as_float` unique | Module `whisperx/numeric.py` (ou util dans `utils.py`) ; remplacer les 3 implémentations. |
| `transcribe_task` | Fonctions privées : `_validate_args`, `_build_timeline_config`, `_run_full_pipeline`, `_run_analyze_only_branch`. |
| Overlaps | Optionnel : factor `diarize` / `timeline` vers `overlap_events.py` **après** tests de non-régression sur JSON timeline. |

**Critère de done** : `py_compile` + tests existants + (idéal) 1 test ciblant `as_float` / un petit chemin `transcribe_task`.

**Livré (2026-03)** : `whisperx/numeric.py` (`as_float`) ; `utils` réexporte pour compat ; **`_build_timeline_analysis_config`**, **`_run_full_pipeline_align`**, **`_run_full_pipeline_diarize`**, **`_run_full_pipeline_write_outputs`** dans `transcribe.py` (branche analyze-only inchangée : `_run_analyze_only`). Tests `tests/test_numeric.py`. Overlaps / `overlap_events.py` non traités (optionnel plan).

---

## Phase 6 — Rust Tauri (faible priorité si fichiers < seuil) — **fait**

- `transcript_commands.rs` : déjà factorisé `write_export_sidecar_file` ; suite seulement si le fichier dépasse ~400–500 lignes.
- `run_events.rs` : extraire `query_window` si besoin de lisibilité.

**Livré (2026-03)** : `transcript_commands.rs` (~309 lignes) inchangé ; **`run_events/`** avec `mod.rs` (import / schéma / IPC) + **`run_events_query_window.rs`** (types fenêtre, requêtes SQL par couche, `query_run_events_window_inner`). Commande Tauri `query_run_events_window` reste dans `mod.rs`. `cargo clippy -- -D warnings` + `cargo test` OK.

---

## Jalons & estimation (ordre de grandeur)

| Phase | Effort |
|-------|--------|
| 0 Cartographie | 0,5 j |
| 1 App erreurs | 0,5–1 j |
| 2 Transcript editor | 3–7 j (itéré) |
| 3 Explorer | 2–4 j |
| 4 Player | 1–2 j |
| 5 Python | 2–5 j |
| 6 Rust | 1–2 j |

---

## Risques & mitigations

- **Régressions clavier / focus** : tester manuellement Player + éditeur après chaque extraction.
- **Hooks circulaires** : préférer des hooks « feuilles » sans importer le hook parent.
- **IPC** : garder les `invoke` dans une couche mince pour mocker en test si besoin.

---

## Références dans le repo

- Audit synthèse : `audit/lingwhistx-v3-review.md`
- Player : `audit/player-multi-view.md`
- CI locale : `cd whisperx-studio && npm run build && npm run test` ; `cd whisperx-studio/src-tauri && cargo clippy -- -D warnings && cargo test`

---

## Suite possible (hors backlog WX-625)

| Piste | Détail |
|-------|--------|
| Python overlaps | Factor `diarize` / `timeline` → `overlap_events.py` après tests golden timeline (phase 5 optionnelle). |
| `transcribe_task` | Extraire `_validate_args` / parsing CLI si on touche encore `transcribe.py`. |
| Éditeur | `useEditorSegmentsState` (phase 2 optionnelle) si le fichier `useTranscriptEditor` re-gonfle. |

**WX-625** : toutes les phases 1–6 livrées ; backlog `done`.

*Dernière mise à jour : 2026-03 — phases 0–6 bouclées.*
