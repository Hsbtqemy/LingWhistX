# Synthèse — risques et recommandations

## Matrice (domaine → risque → mitigation)

| Domaine          | Risque                                                   | Mitigation / ticket                               |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------- |
| IPC média        | `convertFileSrc` + périmètre asset ; médias hors `$HOME` | Doc + message UI — **WX-640**                     |
| IPC WAV cache    | Base64 + gros extraits                                   | Surveiller plafonds ; option binaire — **WX-642** |
| CLI WhisperX     | Régression `choices` sur `--output_format`               | Test argparse — **WX-639**                        |
| Hooks volumineux | `useTranscriptEditor` difficile à faire évoluer          | Plan de découpe — **WX-641**                      |
| Rust             | `unwrap` hors tests                                      | Passage revue ciblée — **WX-644**                 |
| CI               | Pas de garde-fou unique documenté ici                    | Pipeline npm + cargo — **WX-638**                 |
| Revue            | Inventaire obsolète après refactors                      | Rituel release — **WX-643**                       |

## Forces (à préserver)

- `path_guard` et commandes Tauri typées ; erreurs worker remontées à l’UI.
- Vitest sur utilitaires, transcript, explorer, player (partiel).
- Séparation Player / Studio / run details claire.

## Dette assumée

- Pas d’E2E Tauri automatisé dans le dépôt (smoke manuel / script PS) — **WX-645** optionnel.
