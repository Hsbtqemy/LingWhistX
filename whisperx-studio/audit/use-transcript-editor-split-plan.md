# Plan de découpe — `useTranscriptEditor` (WX-641)

Dernière mise à jour : 2026-03-27.

## État actuel

Le hook `src/hooks/useTranscriptEditor.ts` orchestre l’éditeur de transcript mais délègue déjà à des modules dédiés sous `src/hooks/transcript/` :

- clavier, export, chargement, IPC Tauri, navigation, split/merge, mutations, historique, QA, ondeforme, brouillon.

## Responsabilités restant dans le hook

- Liaison `WaveformWorkspace` + `useTranscriptWaveformInteraction`.
- État React central (segments, langue, dirty, statut, règles d’export, job sélectionné).
- Orchestration undo/redo via `useEditorHistory` et snapshot baseline.

## Extraction récente

- `computeEditorDirtyFromBaseline` → `transcript/computeEditorDirty.ts` (+ tests Vitest).

## Pistes suivantes (priorité basse)

- Regrouper les callbacks « sauvegarde / export » derrière un petit objet ou hook `useTranscriptEditorActions` si le fichier dépasse encore ~600 lignes.
- Tests d’intégration légers sur `setEditorSnapshotState` + baseline si la logique dirty évolue.
