# Revue full-stack whisperx-studio (2026-03-27)

Artefacts produits pour une revue **fichier par fichier** (inventaire + notes), une **synthèse par module**, et un **backlog exécutable** (`backlog/backlog.json`, tickets WX-638+).

**Dernière mise à jour inventaire** : régénérer ou compléter `01-inventaire-fichiers.md` après un refactor majeur des hooks ou du backend Rust (voir ticket backlog **WX-643**).

## Contenu

| Fichier | Description |
|--------|-------------|
| [01-inventaire-fichiers.md](./01-inventaire-fichiers.md) | Table **une ligne par fichier** source (rôle, niveau de revue, note). |
| [02-revue-par-module.md](./02-revue-par-module.md) | Analyse agrégée par dossier (patterns, risques, dépendances). |
| [03-synthese-risques-et-recommandations.md](./03-synthese-risques-et-recommandations.md) | Matrice risques, priorités, liens vers tickets backlog. |

## Périmètre

- `whisperx-studio/src/**` (TS/TSX/CSS hors `node_modules`)
- `whisperx-studio/src-tauri/src/**` (Rust)
- Exclus : `dist/`, `node_modules/`, binaires, `gen/`

## Méthode

- **OK** : conforme aux conventions, pas de signal d’alarme.
- **Attention** : complexité, dette, ou point à surveiller en évolution.
- **Suivi** : action backlog ou test manuel recommandé.

## Backlog exécutable

Les tâches **WX-638 à WX-645** dans `backlog/backlog.json` matérialisent les sorties de cette revue (statut `todo` sauf mention).
