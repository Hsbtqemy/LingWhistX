# Confidentialité des logs & IPC — périmètre et limites

Ce document fixe **ce qui est réduit volontairement**, **ce qui reste en clair pour le produit**, et **où la protection s’arrête** (revue interne, pas une certification).

## Liste de contrôle — réduction active

| Zone                    | Mécanisme                                                                                                                | Fichiers / entrées typiques                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Backend Rust**        | `redact_user_home_in_text` (`src-tauri/src/log_redaction.rs`)                                                            | Erreurs `Result` exposées aux commandes Tauri, logs runtime, FFmpeg, DB, `events.sqlite`, chemins dans messages d’échec processus. |
| **Worker & CLI Python** | `log_sanitize.py` : `sanitize_log_line`, `sanitize_path_for_log`, `sanitize_exception_message`, `format_command_for_log` | `worker.py`, `studio_audio_modules.py`, `preview_preprocess.py` (stdout chemins), lignes JSON vers stdout/stderr.                  |
| **Bundle embarqué**     | `log_sanitize.py` copié à côté du worker (`embedded_resources` + `tauri.conf.json`)                                      | Même comportement en build packagé.                                                                                                |
| **Console dev front**   | `src/dev/ipcPerf.ts` : `redactHomeLikeInString` + `sanitizeMetaForDevLog`                                                | Uniquement si `import.meta.env.DEV` ; erreurs IPC et chaînes dans les métadonnées de succès.                                       |

**Variables d’environnement prises en compte côté Rust** (`log_redaction.rs`) : `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA` (Roaming Windows), et si définis `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` (placeholders `~…`).

**Côté Python** (`sanitize_log_line`) : même logique étendue — `Path.home()`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`, clés `XDG_*` ci-dessus.

**Côté front dev** (`ipcPerf.ts`) : d’abord remplacements **triés par longueur de valeur** (`LOCALAPPDATA`, `APPDATA`, `XDG_*`), puis regex de secours (`/Users/…`, `/home/…`, `C:\\Users\\…`). **Contrairement à Rust et Python**, le front **ne lit pas** `HOME` ni `USERPROFILE` pour les substituer explicitement : c’est un **périmètre dev volontairement léger** ; les chemins « home » hors ces motifs (home exotique, autre schéma de message) peuvent encore apparaître dans la console de développement.

**Ordre des remplacements** : dans Rust et Python, les chemins issus des variables d’environnement sont **triés du plus long au plus court** et **dédupliqués** avant substitution, pour limiter les effets de bord entre préfixes (ex. `HOME` vs `XDG_CONFIG_HOME` sous le même arbre).

**Ligne de commande worker** : masquage des arguments après `--hf_token` et de la forme `--hf_token=...` via `format_command_for_log`.

---

## Ce qui reste volontairement exposé (ou hors périmètre)

| Élément                                                                                      | Raison                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Champs métier JSON** (`output_path`, `output_dir`, `run_dir`, chemins de transcript, etc.) | Nécessaires au fonctionnement de l’UI (ouverture de fichiers, affichage).                                    |
| **Erreurs « mutex »** (`Failed to lock …`)                                                   | Pas de chemin dans le message.                                                                               |
| **Smoke Puppeteer**                                                                          | Vérifie le **bundle web** (`vite preview`), pas l’app Tauri ni `invoke` réel — voir `strategy-e2e-smoke.md`. |
| **Release Windows**                                                                          | `smoke:e2e` / PS1 : installateur et artefacts ; contrôle séparé de la smoke navigateur.                      |

---

## Limites connues (à ne pas sur-interpréter)

1. **Heuristique, pas anonymisation complète**  
   Les chemins hors préfixes home / profils Windows courants peuvent rester visibles (autres lecteurs, chemins UNC, noms de machine, fragments de chemin dans du texte libre).

2. **Deux implémentations** (Rust + Python + regex front)  
   Pas de spécification unique partagée ; les variables listées ci-dessus doivent être **alignées** dans les trois couches lorsqu’on en ajoute. Ce document et les tests Python (`test_log_sanitize.py`) servent de garde-fou.

3. **Front dev**  
   `redactHomeLikeInString` n’aligne pas la liste Rust/Python : pas de substitution explicite via `HOME` / `USERPROFILE` (seulement `LOCALAPPDATA`, `APPDATA`, `XDG_*` + regex `/Users/…`, `/home/…`, `C:\Users\…`). Les chemins absolus issus d’un répertoire personnel atypique peuvent donc rester visibles dans la console dev. Ne couvre pas tous les OS ni tous les formats de message d’erreur Tauri.

4. **Pas d’E2E Tauri automatisé dans le flux principal**  
   Aucun test CI ne lance l’app desktop et ne parcourt les IPC réels de bout en bout ; la stratégie smoke reste documentée dans `strategy-e2e-smoke.md`.

5. **Tokens & secrets**  
   Le masquage HF est centré sur **ligne de commande** et logs Python ; d’autres canaux (mémoire, captures d’écran utilisateur, extensions) ne sont pas couverts par ce mécanisme.

---

## Vérification rapide (maintenance)

- [ ] `cargo test` / `cargo clippy` (backend) après changement dans `log_redaction.rs` ou usages massifs de `map_err`.
- [ ] `python -m unittest discover -s python -p 'test_*.py'` après changement de `log_sanitize.py`.
- [ ] `npm run smoke:web` si le shell ou le dialogue d’aide change (`scripts/smoke-browser.mjs`).
- [ ] CI : `studio-ci.yml` (smoke navigateur **Linux** uniquement) ; workflow manuel `studio-browser-smoke-manual.yml` si doute multi-OS.

---

## Références

- `whisperx-studio/src-tauri/src/log_redaction.rs`
- `whisperx-studio/python/log_sanitize.py` — tests : `python/test_log_sanitize.py`
- `whisperx-studio/audit/strategy-e2e-smoke.md` — smoke E2E / navigateur / release
