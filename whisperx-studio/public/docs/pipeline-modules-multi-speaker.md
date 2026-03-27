# Modules pipeline audio / multi-locuteurs (sans preset)

> **Emplacement dans le dépôt Git** : `audit/pipeline-modules-multi-speaker.md` (copie servie ici pour l’app à l’URL `/docs/pipeline-modules-multi-speaker.md`).

Document de référence pour des **étapes optionnelles et combinables** autour de WhisperX : prétraitement, VAD, aides diarisation, QC fréquentiel, analytique. Les noms de clés JSON côté Studio sont listés dans `whisperx-studio/python/studio_audio_modules.py` (`CANONICAL_KEYS`).

Voir aussi `audit/wrapper-feasibility.md` (stades 0–6) pour une vue ingestion → export.

## A — Prétraitement audio (avant ASR / diarisation)

| #   | Rôle                                                                              | Clés JSON (exemple) | Sortie typique                                                      |
| --- | --------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------- |
| 1   | Normalisation (resample mono 16 kHz, loudness ffmpeg `loudnorm`) — **implémenté** | `preNormalize`      | `studio_audio_pipeline/normalized.wav` + `normalized_meta.json`     |
| 2   | Band-limiting (HPF / LPF, encoche 50/60 Hz optionnelle) — **implémenté**          | `bandLimit`         | `studio_audio_pipeline/band_limited.wav` + `band_limit_meta.json`   |
| 3   | Réduction de bruit légère (ffmpeg `afftdn`) — **implémenté**                      | `spectralDenoise`   | `studio_audio_pipeline/denoised.wav` + `spectral_denoise_meta.json` |
| 4   | Stéréo → mono (mid / L / R) — **implémenté**                                      | `stereoMidSide`     | `studio_audio_pipeline/stereo_mix.wav` + `stereo_mix_meta.json`     |
| 4b  | Choix canal L/R (niveau moyen) — **implémenté** (2.0 seulement)                   | `bestChannel`       | `best_channel.wav` + `best_channel_meta.json`                       |

## B — Segmentation parole / non-parole (VAD)

| #   | Rôle                                                                     | Clés JSON   | Usage                                            |
| --- | ------------------------------------------------------------------------ | ----------- | ------------------------------------------------ |
| 5   | VAD énergie / heuristique — **implémenté** (silences, pas les locuteurs) | `vadEnergy` | `vad_energy.json` (média inchangé pour WhisperX) |
| 6   | VAD modèle — **implémenté** (Silero via WhisperX ; `pyannote` réservé)   | `vadModel`  | `vad_model.json` (média inchangé)                |

## C — Aides diarisation (sans remplacer pyannote)

| #   | Rôle                                                                                             | Clés JSON                | Sortie typique                                   |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------ |
| 7   | Chunking aligné sur frontières VAD — **implémenté**                                              | `vadAlignedChunking`     | `vad_aligned_chunking.json` (média inchangé)     |
| 8   | Post-traitement tours (fusion de segments VAD, analogue merge WX-605) — **implémenté** (pré-ASR) | `speakerTurnPostprocess` | `speaker_turn_postprocess.json` (média inchangé) |
| 9   | Recoupements entre segments VAD / tours fusionnés — **implémenté**                               | `overlapDetection`       | `overlap_detection.json` (média inchangé)        |

## D — Features QC / diagnostic

| #   | Rôle                                                 | Clés JSON                                | Sortie typique                      |
| --- | ---------------------------------------------------- | ---------------------------------------- | ----------------------------------- |
| 10  | Pitch / F0 (QC global, fenêtres) — **implémenté**    | `qcPitch`                                | `qc_pitch.json` (média inchangé)    |
| 11  | QC stats globales (ffmpeg `astats`) — **implémenté** | `qcSpectral`                             | `qc_spectral.json` (média inchangé) |
| 12  | Sélection automatique de canal « speechiness »       | `bestChannel` (voir ligne A4 du tableau) | (voir A)                            |

## E — Analytique (déjà en grande partie dans le pipeline mots / IPU)

| #   | Rôle                                                                                    | Remarque                                                                        |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 13  | Pauses / IPU / transitions / overlap (mots alignés + speaker)                           | Cœur métier existant                                                            |
| 14  | Pauses « acoustiques » (VAD) — **implémenté** (`silencedetect`, défauts -45 dB / 1,0 s) | Complément pour silences longs / pubs ; `acoustic_pauses.json` (média inchangé) |

## Composition recommandée (logique, pas un preset produit)

1. Si stéréo : mid-side et/ou meilleur canal (A4 / D12) — **dans le worker**, `stereoMidSide` est exécuté **avant** `preNormalize` pour éviter un downmix mono générique qui détruirait l’intérêt du mid.
2. Normalisation (A1)
3. Band-limiting (A2) et/ou débruitage spectral (A3) selon besoin
4. VAD modèle (B6, Silero) pour métadonnées / QC (optionnel)  
   4b. Chunking indicatif aligné VAD (C7) après `vadModel` / `vadEnergy` (optionnel)
5. WhisperX (ASR + align + diarize)
6. Post-traitement tours + overlap (C8–C9)
7. Pauses / IPU sur mots (E13), VAD acoustique en option (E14)
8. Features QC pitch / spectral en option (D10–D11)

## Intégration technique (Studio)

- Champ optionnel **`audioPipelineModules`** dans `WhisperxOptions` (objet JSON arbitraire ; clés booléennes ou sous-objets de paramètres).
- **`preNormalize`** : exécuté dans `studio_audio_modules.run_pre_normalize` (ffmpeg : mono 16 kHz, filtre `loudnorm`). Paramètres optionnels dans l’objet : `integratedLufs` (défaut -16), `truePeakDb` (défaut -1.5), `lra` (défaut 11).
- **`bandLimit`** : `run_band_limit` — `highpass` / `lowpass` (défaut 80 Hz / 7600 Hz, bornés), encoche optionnelle `notchHz=50|60` via `equalizer`, paramètres `highpassHz`, `lowpassHz`, `notchGainDb` (défaut -28).
- **`stereoMidSide`** : `run_stereo_mid_side` — si ≥ 2 canaux audio : mixage mono via `pan` (`mode` / `mix` : `mid` défaut, `left`, `right`). Si 1 canal : fichier inchangé (journal).
- **`spectralDenoise`** : `run_spectral_denoise` — filtre `afftdn` (`noiseReduction` / `nr` défaut 12, `noiseFloor` / `nf` défaut -25), sortie mono 16 kHz.
- **`vadModel`** : `run_vad_model` — VAD **Silero** (torch.hub, comme WhisperX) sur audio **16 kHz** via `whisperx.audio.load_audio` ; paramètres optionnels : `threshold` / `vadOnset`, `maxSpeechDurationSec` / `chunkSize` ; écrit **`vad_model.json`** (`speechSegments`), média inchangé. Backend **`pyannote`** : non branché (erreur explicite).
- **`bestChannel`** : `run_best_channel` — deux passes `volumedetect` sur `pan` L et R (stéréo 2.0) ; le canal au **mean_volume** le plus élevé (dB) est conservé en mono.
- **`vadEnergy`** : `run_vad_energy` — `silencedetect` (`noiseDb` / `noise_db`, `minSilenceDurationSec` / `min_silence_sec`) ; écrit **`vad_energy.json`** uniquement, **ne change pas** le fichier d’entrée pour WhisperX.
- **`vadAlignedChunking`** : `run_vad_aligned_chunking` — lit **`vad_model.json`** (priorité) ou **`vad_energy.json`** (intervalles silence → complément) ; regroupe la parole en **chunks** d’étendue ≤ `maxChunkSec` (défaut 30) ; `preferSource` : `auto` `| vad_model | vad_energy` ; écrit **`vad_aligned_chunking.json`** (`suggestedChunks`, indicatif) ; média inchangé — **WhisperX n’applique pas ce JSON automatiquement** (voir `pipelineChunkSeconds`).
- **`speakerTurnPostprocess`** : `run_speaker_turn_postprocess` — lit **`vad_model.json`** ; fusionne les segments parole consécutifs si l’écart ≤ `mergeGapSecMax` (défaut 0,35 s) ; `splitWordGapSec` documenté mais **ignoré** sans mots alignés ; écrit **`speaker_turn_postprocess.json`** (`turns`, locuteur fictif `SPEECH_VAD`) ; média inchangé.
- **`overlapDetection`** : `run_overlap_detection` — paires d’intervalles dont l’intersection temporelle est non vide ; source : **`speaker_turn_postprocess.json`** (`preferSource`: `auto` par défaut) ou **`vad_model.json`** ; écrit **`overlap_detection.json`** ; média inchangé (l’overlap **multi-locuteurs** reste côté timeline post-ASR).
- **`qcSpectral`** : `run_qc_spectral` — `astats=metadata=1:reset=N` (défaut `reset=0` = mesure sur tout le fichier ; option `astatsResetFrames` / `resetFrames`) ; parse le bloc **Overall** (RMS, pic, etc.) dans **`qc_spectral.json`**, média inchangé.
- **`qcPitch`** (D10) : `run_qc_pitch` — décodage mono via ffmpeg, F0 approximatif par autocorrélation sur fenêtres glissantes (numpy requis) ; paramètres optionnels : `sampleRateHz`, `maxDurationSec`, `frameMs`, `hopMs`, `f0MinHz`, `f0MaxHz`, `minCorrelation`, `maxFrames` ; écrit **`qc_pitch.json`**, média inchangé.
- **`acousticPauses`** (E14) : `run_acoustic_pauses` — même mécanisme que `vadEnergy` avec défauts plus « pauses longues » (`noiseDb` / `minSilenceDurationSec`) ; écrit **`acoustic_pauses.json`**, média inchangé.
- **Ordre d’exécution dans le worker** : `bestChannel` → `stereoMidSide` → `preNormalize` → `bandLimit` → `spectralDenoise` → `vadModel` → `vadEnergy` → `vadAlignedChunking` → `speakerTurnPostprocess` → `overlapDetection` → `qcSpectral` → `qcPitch` → `acousticPauses` (chaque étape activable seule ; certaines exigent des JSON produits en amont, voir ci-dessus).
- Toutes les **clés canoniques** listées dans `studio_audio_modules.CANONICAL_KEYS` ont une implémentation ; les erreurs à l’exécution concernent surtout des **prérequis** (ex. `vadModel` avant `speakerTurnPostprocess`).

## Plages temporelles (WX-623)

- Option **`audioPipelineSegments`** dans `WhisperxOptions` : tableau JSON de segments
  `{ "startSec": number, "endSec": number, "audioPipelineModules"?: object }` (alias acceptés :
  `start_sec` / `end_sec`, modules sous `modules` ou `audio_pipeline_modules`). Côté worker, les
  plages sont validées (durée ≥ 50 ms, pas de chevauchement, bornes dans la durée fichier).
- Pour chaque plage : extraction ffmpeg du segment sur le fichier source → application de
  `maybe_prepare_audio_input` sur l’extrait (modules **de la plage**, ou repli sur
  `audioPipelineModules` global) → concaténation des WAV traités en
  `studio_audio_pipeline/segment_concat.wav`, avec manifeste `segment_pipeline_manifest.json`.
- Sans plages : le pipeline audio global inchangé (comportement historique avec `audioPipelineModules`
  seul).
- Studio : champ **Plages pipeline (JSON)** dans le formulaire WhisperX ; depuis l’Alignment,
  **Injecter plage → JSON pipeline** préremplit une plage exemple ; **Exporter snippet WAV** appelle
  la commande Tauri `export_audio_wav_segment` (mono 16 kHz, chemin absolu choisi par l’utilisateur).

### Validation locale (suite immédiate WX-623)

- **Automatisé** : `python3 -m unittest test_wx623_segments` — les tests d’intégration s’exécutent si
  `ffmpeg` **et** `ffprobe` sont résolus comme le worker : `PATH`, ou `FFMPEG_BINARY` /
  `FFPROBE_BINARY`, ou `ffprobe` dans le même dossier que le binaire `ffmpeg` (cas Homebrew).
  Sinon les tests sont ignorés. Vérifier aussi `python3 -m py_compile studio_audio_modules.py`.
- **Manuel UI** : deux plages dont une seule avec `preNormalize` → job WhisperX OK et
  `segment_pipeline_manifest.json` cohérent ; couper ffmpeg (ou chemin invalide) → job en erreur,
  message lisible ; sans clé `audioPipelineSegments` → même comportement qu’avant avec modules globaux
  seuls.
- **Logs** : le worker émet des lignes `__WXLOG__` avec préfixe `WX-623` et le résumé des plages
  `[t0-t1s, …]` avant concat.
