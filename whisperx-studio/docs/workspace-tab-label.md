# Décision produit — libellé de l’onglet workspace (WX-637)

**Statut** : adopté (2026-03-23)

## Décision

L’onglet de navigation qui ouvre la vue **jobs + Explorer + détail de run** (vue `workspace` dans le code) porte le libellé officiel **« Studio »**.

## Contexte

- Cohérent avec le nom produit **LingWhistX Studio** et la proposition d’audit UI ([`audit/ui-ux-harmonization-spec.md`](../../audit/ui-ux-harmonization-spec.md) section B.1 : « Studio » ou « Travail »).
- Les CTA existants (« Aller au Studio » dans le Player) et le parcours doc ([`studio-user-flow.md`](studio-user-flow.md)) utilisent déjà ce terme.

## Alternatives non retenues pour l’instant

| Libellé          | Motif d’écart                                               |
| ---------------- | ----------------------------------------------------------- |
| Historique & run | Trop long ; focus « historique » plutôt que lieu de travail |
| Travail          | Valide sémantiquement ; réservé si test utilisateur futur   |
| Édition          | Sous-entend surtout le transcript, pas tout l’Explorer      |

Une révision est possible après retours terrain ; ouvrir une entrée backlog ou une issue dédiée.

## Références techniques

- Implémentation navigation : WX-633 (`StudioNav`, `role="tab"` / `tabpanel`).
- Fichiers UI visibles : `StudioNav.tsx`, textes Player (`PlayerWorkspaceSection`).
