# Sécurité IPC (chemins et processus) — WhisperX Studio

Ce document décrit la surface d’attaque des commandes Tauri exposées au frontend et les garde-fous en place (revue WX-407, cartographie IPC).

## Modèle de menace

- Le frontend (WebView) invoque le backend via IPC. Un script injecté dans l’UI pourrait tenter d’appeler `invoke` avec des chemins arbitraires.
- Le backend s’exécute avec les **droits de l’utilisateur OS** : lecture/écriture des fichiers accessibles à cet utilisateur, comme tout éditeur local.

## Primitives `path_guard.rs`

| Primitive | Rôle |
|-----------|------|
| **`validate_path_string`** | Chaîne non vide (après trim), longueur ≤ 8192 octets, pas d’octet NUL. |
| **`resolve_existing_file_path`** | `validate_path_string` + chemin existant + fichier + **`canonicalize()`**. |
| **`resolve_existing_path_for_open`** | `validate_path_string` + chemin existant (fichier ou dossier) + **`canonicalize()`** — utilisé avant ouverture shell (`open` / `xdg-open` / `explorer`). |
| **`validate_custom_output_dir`** | Chemin **absolu**, création du dossier si besoin, **`canonicalize()`**, puis doit rester sous des racines autorisées (données app, Documents, Downloads, home, temp, volumes amovibles macOS/Linux, ou chemins non système Windows hors zones sensibles). |
| **`validate_delete_allowed_directory`** | Répertoire existant + **`canonicalize()`** + **mêmes racines** que `validate_custom_output_dir` — suppression récursive ou listage ciblé. |

Comportement volontairement **non** restreint au seul répertoire de l’app : l’utilisateur peut ouvrir et traiter des fichiers ailleurs sur la machine (cas nominal).

**Liens symboliques** : `canonicalize()` résout la cible réelle ; le comportement suit le système de fichiers.

---

## Tableau commande → validation de chemin

Chaque ligne correspond à une commande enregistrée dans `src/lib.rs` (`invoke_handler`). Les commandes **sans paramètre chemin** sont listées pour exhaustivité. **53** commandes au total — toutes couvertes par les tableaux ci-dessous.

### Audio / waveform / cache

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `extract_audio_wav_window` | `input_path` | **`resolve_existing_file_path`** ; sortie uniquement sous `cache_dir/audio_wav_windows/…` (UUID). |
| `read_extracted_wav_bytes_b64` | `path` | Chemin **absolu** + **`canonicalize()`** + doit être **sous** `cache_dir/audio_wav_windows` (WAV généré par l’app). |
| `export_audio_wav_segment` | `input_path`, `output_path` | Entrée : **`resolve_existing_file_path`** ; sortie : absolue + répertoire parent validé via **`validate_custom_output_dir`**. |
| `generate_preprocessed_audio_preview` | `input_path` | **`resolve_existing_file_path`** ; scripts Python résolus en interne (`embedded_resources`). |
| `build_waveform_peaks` | `path` | **`validate_path_string`** + média existant + **fichier** (pas de `canonicalize` explicite sur la source — cohérent avec ffmpeg sur chemin utilisateur). |
| `start_waveform_generation` | `path` | Même logique que `build_waveform_peaks` via `build_waveform_peaks_internal`. |
| `cancel_waveform_generation` | — | Identifiants de tâche uniquement (`task_id`). |
| `build_waveform_pyramid` | `path` | **`validate_path_string`** + fichier existant (`build_waveform_pyramid_internal`). |
| `read_wxenv_meta` | `path` | **`validate_path_string`** + fichier existant (`read_wxenv_meta_from_path`). |
| `read_wxenv_slice` | `path` | Idem lecture WXENV. |

### Jobs pipeline

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `create_job` | `input_path`, `output_dir` optionnel | `input_path` : **`validate_path_string`** + existe + **fichier**. `output_dir` : **`validate_custom_output_dir`** si renseigné, sinon défaut sous `app_local_data_dir/runs/<jobId>`. Limite : au plus 4 jobs `queued`/`running`. |
| `list_jobs` / `get_job` / `get_jobs_pagination_info` / `load_more_jobs_from_db` | — | Pas de chemin utilisateur (état mémoire / SQLite interne). |
| `cancel_job` / `delete_job` / `set_job_priority` / `reorder_jobs` | — | Identifiants de job uniquement. |

### Système de fichiers local (UI)

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `open_local_path` | `path` | **`resolve_existing_path_for_open`**. |
| `read_text_preview` | `path` | **`resolve_existing_file_path`** + lecture plafonnée (`max_bytes` clamp 1 KiB–2 MiB). |
| `list_directory_files` | `dir_path` | **`validate_delete_allowed_directory`** (même périmètre qu’un dossier de sortie autorisé). |

### Transcripts (éditeur)

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `load_transcript_document` | `path` | **`resolve_existing_file_path`**. |
| `load_transcript_draft` | `path` | **`resolve_existing_file_path`** ; brouillon dérivé du source. |
| `save_transcript_draft` / `delete_transcript_draft` / `save_transcript_json` | `path` / `request.path` | **`resolve_existing_file_path`** sur le JSON source ; écritures à côté (draft / export) dérivées du chemin canonique. |
| `export_transcript` | `request.path` | **`resolve_existing_file_path`** ; exports sidecar à côté du source. |
| `export_run_timing_pack` | `request.run_dir` | **`validate_path_string`** + **`canonicalize()`** + `run_manifest.json` présent ; exports via `export_transcript` sur artifact résolu **sous** le dossier du run. |

### Rapports

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `export_prosody_report` | `run_dir` | **`validate_path_string`** + **`canonicalize()`** ; écriture `rapport-prosodique-*.html` **dans** ce dossier. |
| `open_html_report_for_print` | `html_path` | **`validate_path_string`** + **`canonicalize()`** + fichier existant ; chargement WebView via `asset://` (scope configuré dans `tauri.conf.json`). |

### Runs récents / manifeste

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `read_run_manifest_summary` | `input_path` | **`validate_path_string`** (`resolve_run_dir_and_manifest`) + dossier de run ou `run_manifest.json` + **canonicalisation** des chemins résolus. |
| `list_recent_runs` / `clear_recent_runs` | — | Fichier persistance interne `recent_runs.json` sous `app_local_data_dir`. |
| `remove_recent_run` | `run_dir` | **`validate_path_string`** uniquement (retire une entrée de liste, **pas d’effet disque** sur le run). |
| `delete_run_directory` | `run_dir` | **`validate_delete_allowed_directory`** puis `remove_dir_all`. |
| `find_run_transcript_json` | `run_dir` | **`validate_path_string`** + doit être un répertoire existant (lecture non récursive). |

### Événements run / SQLite

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `import_run_events` | `run_dir` | **`validate_path_string`** puis **`import_run_events_inner`** : **`canonicalize()`** sur le dossier, puis lecture timeline / écriture `events.sqlite` sous ce dossier. |
| `list_run_speakers` | `run_dir` | **`validate_path_string`** + **`canonicalize()`** + `events.sqlite` / import lazy. |
| `query_run_events_window` | `request.run_dir` | Validé dans **`run_events_query_window`** ( **`validate_path_string`** sur `run_dir` + canonisation dans la requête). |
| `recompute_player_alerts` | `request.run_dir` | Indirect via **`query_run_events_window_inner`** (même pipeline que `query_run_events_window`). |
| `recalc_pauses_ipu` | `run_dir` | **`validate_path_string`** puis **`recalc_pauses_ipu_inner`** : **`canonicalize()`**, `ensure_events_sqlite_imported`, accès SQLite. |

### Profils / annotations / divers

| Commande | Paramètres chemin | Validation |
|----------|-------------------|------------|
| `read_user_profiles` / `save_user_profile` / `delete_user_profile` | — / `id` | Pas de chemin utilisateur ; écriture sous `app_data_dir/profiles/{id}.json` avec **`id` alphanumérique + `_` + `-`**. |
| `import_annotation_file` | `path` | **`resolve_existing_file_path`** + extension **`eaf`** ou **`textgrid`** (comparaison en minuscules sur l’extension — accepte p.ex. `.TextGrid`). |
| `write_annotation_tiers_to_events` | `run_dir` | **`validate_path_string`** (voir `annotation_events_commands.rs`). |
| `validate_hf_token` | — | Token chaîne uniquement ; pas de chemin. |
| `get_runtime_status` / `get_runtime_setup_status` / `start_runtime_setup` / `get_ffmpeg_install_status` / `start_ffmpeg_install` | — | Binaires et scripts résolus en interne (`ffmpeg_tools`, `embedded_resources`, `python_runtime`). |

---

## Cas abusifs documentés (rejet)

- **Octet NUL** dans la chaîne : `path contains invalid characters`.
- **Chemin trop long** (> 8192 octets après trim) : `path exceeds maximum length`.
- **Aperçu texte** : lecture tronquée selon `max_bytes` (plafond 2 MiB) pour limiter la charge mémoire.
- **Sortie personnalisée** (`output_dir`, parent d’export WAV) : hors racines autorisées → message explicite côté `validate_custom_output_dir` / `validate_delete_allowed_directory`.

## Processus externes

Worker Python, ffmpeg/ffprobe, installation guidée ffmpeg (`brew` / `winget` / `choco` selon disponibilité), runtime Node pour le setup : voir `ffmpeg_tools`, `jobs`, `embedded_resources`. Aucun chemin utilisateur brut n’est passé comme nom de binaire.

## Suivi

- `cargo audit` / `cargo clippy` : à lancer en CI ou avant release ; les alertes dépendances sont hors scope de ce document.
- Pistes futures : journaliser les invocations avec chemins en mode debug ; politique optionnelle « chemins sous le répertoire du job uniquement » (breaking change, ticket séparé).
