# QA UI — WhisperX Studio

Référence : `audit/ui-ux-harmonization-spec.md` §F (validation).

## F.1 — Checklist (à cocher lors des RC)

- [ ] Contraste texte/fond sur **tous** les boutons `ghost` et `primary` (≥ 4.5:1 pour texte normal).
- [ ] **Focus visible** : Tab à travers `StudioNav`, Explorer, formulaire job, Player.
- [ ] **Navigation clavier** : modales (Échap), aide raccourcis (`?`).
- [ ] **Fenêtre redimensionnée** : 1280, 1024, 900px — pas de collapse sidebar bloquant.
- [ ] **Zoom OS** : 125 % / 150 % — pas de chevauchement topbar.
- [ ] **Hi-DPI** : canvas waveform sans flou (`devicePixelRatio` côté canvas).

## F.2 — Scénarios (résumé)

Voir le tableau « Scénarios utilisateurs » dans `audit/ui-ux-harmonization-spec.md` §F.2 (ouvrir run, recalibrer pauses, alertes Player, export pack).

## Validation manuelle (template)

| Date       | Plateforme | Version app | Validateur | Notes |
|------------|------------|-------------|------------|-------|
| 2026-03-28 | macOS      | dev / RC    | CI + doc   | Checklist intégrée ; passes OS complètes à noter lors des release candidates. |
| _à compléter_ | Windows |             |            | Au moins 5 items F.1 validés sur une RC (ticket **WX-636**). |
