# QA UI — contraste, focus, zoom

Checklist alignée sur **F.1** de l’audit :

- [`audit/ui-ux-harmonization-spec.md`](../../audit/ui-ux-harmonization-spec.md#f1-checklist-qa)

## F.1 — Items à valider (cases à cocher)

> Pour une **release candidate**, viser au moins **5 items** cochés sur une build identifiée (voir tableau ci-dessous).

- [ ] Contraste texte/fond sur **tous** les boutons `ghost` et `primary` (≥ 4.5:1 pour texte normal).
- [ ] **Focus visible** : Tab à travers `StudioNav`, Explorer, formulaire job, Player.
- [ ] **Navigation clavier** : modales (Échap), aide raccourcis (`?`).
- [ ] **Fenêtre redimensionnée** : 1280, 1024, 900px — pas de collapse sidebar bloquant.
- [ ] **Zoom OS** : 125 % / 150 % — pas de chevauchement topbar.
- [ ] **Hi-DPI** : canvas waveform sans flou (déjà `devicePixelRatio` côté canvas si applicable).

## Passe manuelle (plateformes)

| Date       | Plateforme | Version app / build | Validateur | Notes |
| ---------- | ---------- | ------------------- | ---------- | ----- |
| 2026-03-23 | macOS      | dev `0.1.0`         | doc init   | Template — à dupliquer lors des RC. |
|            | Windows    |                     |            |       |
