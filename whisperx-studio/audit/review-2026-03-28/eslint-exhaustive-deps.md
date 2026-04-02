# ESLint `react-hooks/exhaustive-deps` — WhisperX Studio

**Date** : 2026-03-28  
**Contexte** : `npm run lint` ne doit pas laisser d’avertissements `react-hooks/exhaustive-deps` non traités ou non documentés.

## Politique

1. **Par défaut** : respecter la règle — inclure toutes les valeurs du corps de l’effet dans le tableau de dépendances, ou refactoriser (extraire des callbacks stables, `useRef`, etc.).

2. **Exception documentée — objets hook** : lorsque le hook retourne un **objet agrégé** recréé à chaque rendu (`useWaveformWorkspace` → `wf`, `useTranscriptEditor` → `te`), lister l’objet entier (`wf`, `te`) dans les deps **provoquerait** un nouveau référencement à chaque rendu parent et donc des effets exécutés trop souvent (scroll waveform, sync transport, segment actif).

3. **Exception documentée — refs** : effet qui lit `queryContract` / temps courant via **`useRef`** (valeur à jour sans figer les deps) tout en déclenchant sur des **clés dérivées** (`coarseKey`, `contractLayersKey`, `refreshEpoch`, …) — voir `usePlayerRunWindow`.

4. **Mise en œuvre** : conserver des **dépendances granulaires** ou des **clés stables** ; désactivation ESLint **ciblée** sur la ligne signalée (souvent `}, [`), avec libellé `-- …` explicite (`wf granulaire`, `te granulaire`, `refs + clés`, etc.).

## Sites actuels (vérifiés)

| Fichier                                            | Sujet                                            | Désactivation                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/player/PlayerWorkspaceSection.tsx` | Sync `currentTimeSec` → `wf.setMediaCurrentSec`  | `// eslint-disable-line` sur la ligne du tableau de deps (1re effet)                                                                                                           |
| Idem                                               | Follow playhead / scroll ondeforme               | `// eslint-disable-next-line` immédiatement avant `}, [` (2e effet, deps multilignes)                                                                                          |
| Idem                                               | Segment actif éditeur vs playhead                | `// eslint-disable-line` sur la ligne du tableau de deps (3e effet)                                                                                                            |
| `src/hooks/usePlayerRunWindow.ts`                  | Fenêtre IPC `query_run_events_window` (debounce) | `// eslint-disable-next-line` avant `}, [` — `queryContract` / centre temporel lus via **refs** ; deps = `coarseKey`, `contractLayersKey`, `speakersKey`, `refreshEpoch`, etc. |

## Vérification

```bash
npm run lint
```

Attendu : **aucune** alerte `react-hooks/exhaustive-deps` (ni directive `eslint-disable` inutilisée).

## Évolutions possibles (hors scope immédiat)

- Refactoriser `useWaveformWorkspace` / `useTranscriptEditor` pour exposer un **contexte** ou des **refs stables** réduisant le besoin de désactivations.
- Ticket backlog si la dette doit être planifiée explicitement.
