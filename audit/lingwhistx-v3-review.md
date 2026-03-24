# Audit & review LingWhistX v3 (synthèse exécutable)

Périmètre : `whisperx/`, `whisperx-studio/src-tauri/`, `whisperx-studio/src/`, `whisperx-studio/python/worker.py`, CI, tests, doc Player.

**Dernière passe code : 2025-03-22**

## Correctifs appliqués dans le dépôt (cette session)

| Id | Sujet | Fichiers / changement |
|----|--------|------------------------|
| B-02 | `analyze_only` : plus de JSON passé comme argument « audio » positionnel | `whisperx/cli.py` : `audio` en `nargs='*'` + validation ; `whisperx/transcribe.py` : garde si pas d’audio hors `--analyze_only_from` ; `worker.py` : `whisperx analyze … --analyze_only_from` sans doublon |
| B-04 | Ratio alignement : longueur waveform en samples | `whisperx/alignment.py` : `waveform_segment.shape[-1]` au lieu de `size(0)` |
| B-05 | `probe_audio_duration` ignorait `FFPROBE_BINARY` | `whisperx/audio.py` : utilise `_FFPROBE_CMD` (déjà aligné env / `load_audio` utilisait `_FFMPEG_CMD`) |
| B-07 | Panic `expect` sur export pack | `transcript_commands.rs` : `ok_or_else` → `Err` contrôlé |
| B-08 | Stderr runtime setup tronquée à une ligne | `embedded_resources.rs` : jointure des lignes stderr (cap ~8k caractères) |
| S-01 / B-06 | Token HF dans argv | **Déjà traité** : `jobs.rs` retire `hf_token` avant sérialisation JSON et injecte les variables d’environnement ; commentaire explicite ajouté |
| S-02 | Brouillons transcript sans canonique | `save_transcript_draft` / `load_transcript_draft` / `delete_transcript_draft` : `resolve_existing_file_path` (fichier existant + chemin canonique) |

### CI Clippy (`-D warnings`)

Corrections pour que `cargo clippy -- -D warnings` passe (aligné sur `studio-ci.yml`) : casts `sec_to_ms` redondants, `needless_borrow` sur lignes SQLite (`run_events.rs`), alias `PauseInsertRow` / `IpuInsertRow` (`run_events_recalc.rs`), boucle pyramidale `levels.iter_mut().skip(1)` (`wxenv.rs`).

### Lot suivant (session « Allons-y »)

| Id | Sujet | Changement |
|----|--------|------------|
| P-01 | `get_runtime_status` bloquant | `async` + `tokio::task::spawn_blocking` (`runtime_status.rs`), dépendance `tokio` avec `rt-multi-thread` |
| P-03 | Cache waveform instable | FNV-1a 64-bit (`waveform.rs`) à la place de `DefaultHasher` |
| T-03 | `formatTimestamp(0)` → `-` | `Number.isFinite(ms)` dans `appUtils.ts` + tests Vitest |
| T-04 / T-05 | QA + `closestSegmentIndex` | `QA_SPEECH_RATE_LOW_MIN_WORDS` ; tolérance `< 1e-6` sur distance |
| CI-02 | Pas de macOS | `studio-ci.yml` : `macos-latest` dans la matrice (Prettier était déjà en place → CI-03 OK) |

### Lot « On fait tout »

| Id | Sujet | Changement |
|----|--------|------------|
| T-02 | `Job.mode` trop large | `types.ts` : `"mock" \| "whisperx" \| "analyze_only"` |
| T-06 | Erreur globale unique | `App.tsx` : jusqu’à **5** messages ; `StudioNewJobSection` liste les lignes ; `setError("")` vide la pile |
| P-05 | Chevauchements tours | `timeline.py` : `_derive_overlap_events` en balayage (tri + liste active) |
| D-08 | Export transcript répétitif | `write_export_sidecar_file` dans `transcript_commands.rs` |
| D-13 | count + load redondants | **Non** : `load_jobs` = première page ; commentaire dans `app_setup.rs` |

## Déjà conformes au moment de la revue (pas de changement requis)

| Id | Note |
|----|------|
| B-01 | Chunking : `transcribe.py` utilise déjà `continue` sur chunk audio vide (`chunk_audio.size == 0`), pas `break` sur la boucle des specs. |
| B-03 | `worker.py` : sorties listées avec `out_dir.rglob("*")` (récursif). |
| S-03 | `create_job` : `input_path.is_file()` déjà présent. |

## Pistes restantes (non implémentées ici)

- ~~**P-01** `get_runtime_status` synchrone → `async` + `spawn_blocking`.~~ **Fait** : `runtime_status.rs` + `tokio::task::spawn_blocking`.
- ~~**P-03** cache waveform : `DefaultHasher` → hash stable~~ **Fait** : FNV-1a 64-bit dans `waveform.rs`.
- **T-01** champs UI vs `UiWhisperxOptions` : déjà alignés (incl. `audioPipelineModulesJson` / `audioPipelineSegmentsJson`).
- **D-03** / **D-04** / **D-06** Python, **A-02** alertes SQLite globales Player, **useTranscriptEditor** scindé : backlog / refactors plus longs.
- **B-06** variante défense en profondeur : passer `--options-json` via fichier temporaire + `--options-json-path` si la taille argv ou d’autres champs sensibles deviennent un sujet.

## Références code clés

- Options worker + env HF : `whisperx-studio/src-tauri/src/jobs.rs` (`hf_token.take()`).
- Analyse seule : `whisperx/transcribe.py` → `_run_analyze_only` avant la boucle audio.
