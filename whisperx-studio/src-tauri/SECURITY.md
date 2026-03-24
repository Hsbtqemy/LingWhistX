# Securite IPC (chemins et processus) — WhisperX Studio

Ce document decrit la surface d’attaque des commandes Tauri exposees au frontend et les garde-fous en place apres la revue WX-407.

## Modele de menace

- Le frontend (WebView) invoque le backend via IPC. Un script malveillant injecte dans l’UI pourrait tenter d’appeler `invoke` avec des chemins arbitraires.
- Le backend s’execute avec les **droits de l’utilisateur OS** : lecture/ecriture des fichiers accessibles a cet utilisateur, comme tout editeur local.

## Commandes acceptant des chemins (strings)

| Commande | Role | Garde-fous |
|----------|------|------------|
| `open_local_path` | Ouvre un fichier/dossier dans l’explorateur | Chemin non vide, longueur max, pas de `NUL`, existence, **canonicalisation** avant `open`/`xdg-open`/`explorer`. |
| `read_text_preview` | Apercu texte | Idem fichier existant + **limite de taille** lue (clamp 1 KiB–2 MiB par requete). |
| `load_transcript_document` | Charge un JSON transcript | Idem fichier + canonicalisation pour la lecture. |
| `load_transcript_draft` | Brouillon | Validation du chemin source (longueur, NUL). |
| `save_transcript_draft` / `delete_transcript_draft` / `save_transcript_json` / `export_transcript` | Ecriture / export | Validation du chemin source avant derivation des chemins cibles. |
| `create_job` | Job audio | `input_path` : fichier existant. `output_dir` optionnel : chemin **absolu**, creation puis **canonicalisation** ; doit rester sous des racines autorisees (donnees app, Documents, Downloads, home, temp, volumes amovibles, ou hors chemins systeme Windows). Sinon defaut sous `app_local_data_dir/runs/<jobId>`. **Limite** : au plus 4 jobs `queued`/`running` simultanes. |
| `get_jobs_pagination_info` | Pagination historique | Pas de chemin utilisateur ; lit l’etat interne (`has_more`, `total_in_db`, offset). |
| `load_more_jobs_from_db` | Charger une page de jobs anciens | Pas de chemin ; lecture SQLite paginee, fusion dans le store memoire. |
| `build_waveform_peaks` / `start_waveform_generation` | Waveform | Validation du chemin media avant traitement. |

## Comportement volontairement non sandboxe

- Les chemins **ne sont pas** restreints au seul repertoire du projet ou a `app_local_data_dir` : l’utilisateur peut ouvrir et editer des fichiers n’importe ou sur sa machine (cas nominal).
- `std::fs::canonicalize` **suit les liens symboliques** : la cible reelle est utilisee pour la lecture et l’ouverture shell. Un chemin utilisateur vers un symlink est donc resolu comme le FS le permet.

## Cas abusif documente (rejete)

- **Octet NUL** dans la chaine chemin : rejet avec `path contains invalid characters`.
- **Chemin trop long** (> 8192 octets apres trim) : rejet avec `path exceeds maximum length`.
- **Apercu** : lecture tronquee selon `max_bytes` (plafond 2 MiB) pour limiter la charge memoire.

## Processus externes

- Worker Python, ffmpeg/ffprobe, PowerShell (Windows) ou `node` + `setup-local-runtime.mjs` (macOS/Linux) pour le setup runtime : voir `ffmpeg_tools`, `jobs`, `embedded_resources`. L’installation guidée de ffmpeg lance **uniquement** `brew install ffmpeg`, **winget** (Gyan.FFmpeg) ou **choco install ffmpeg** si l’outil est présent sur la machine (pas de téléchargement arbitraire depuis Internet). Aucun chemin utilisateur brut n’est passe comme nom de binaire ; les binaires sont resolus par l’application.

## Suivi

- `cargo audit` / `cargo clippy` : a lancer en CI ou avant release ; les alertes dependances sont hors scope de ce document.
- Ameliorations possibles : journaliser les invocations avec chemins en mode debug ; politique optionnelle « chemins sous le repertoire du job uniquement » (breaking change, ticket separe).
