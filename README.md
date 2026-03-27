# LingWhistX

**LingWhistX** est un dépôt qui combine :

1. **Un fork de [WhisperX](https://github.com/m-bain/whisperX)** — reconnaissance vocale précise dans le temps (Whisper + alignement + diarisation, etc.), avec **extensions CLI**, exports analytiques et intégrations documentées dans ce repo.
2. **[WhisperX Studio](whisperx-studio/README.md)** — application **desktop** (Tauri + React + Rust) pour lancer des jobs en local, historiser les runs, éditer les transcriptions et diagnostiquer le runtime (Python, WhisperX, ffmpeg).

Le paquet Python publié s’appelle toujours **`whisperx`** (compatibilité outils / imports) ; la distribution « produit » autour du fork est désignée ici **LingWhistX**.

<p align="center">
  <a href="https://github.com/m-bain/whisperX/blob/master/LICENSE"><img src="https://img.shields.io/github/license/m-bain/whisperX.svg" alt="Licence"></a>
  <a href="https://arxiv.org/abs/2303.00747"><img src="https://img.shields.io/badge/WhisperX-ArXiv_2303.00747-B31B1B.svg" alt="Article WhisperX"></a>
</p>

<p align="center">
  <img width="800" alt="Pipeline WhisperX (amont)" src="https://raw.githubusercontent.com/m-bain/whisperX/refs/heads/main/figures/pipeline.png">
</p>

## Table des matières

- [Ce que fait WhisperX (amont)](#ce-que-fait-whisperx-amont)
- [Structure du dépôt](#structure-du-dépôt)
- [Installation développeur (Python)](#installation-développeur-python)
- [WhisperX Studio (application desktop)](#whisperx-studio-application-desktop)
- [Extensions LingWhistX (CLI & pipeline)](#extensions-lingwhistx-cli--pipeline)
- [Utilisation CLI rapide](#utilisation-cli-rapide)
- [Utilisation Python](#utilisation-python)
- [Projet amont, citation et remerciements](#projet-amont-citation-et-remerciements)

## Ce que fait WhisperX (amont)

[WhisperX](https://github.com/m-bain/whisperX) fournit une ASR rapide avec **timestamps au mot**, **alignement forcé** (wav2vec2) et **diarisation multi-locuteurs** (pyannote), backend [faster-whisper](https://github.com/guillaumekln/faster-whisper), VAD, etc. Détails, démos Replicate et discussion technique : voir le README du [dépôt upstream](https://github.com/m-bain/whisperX).

## Structure du dépôt

| Chemin | Rôle |
|--------|------|
| `whisperx/` | Paquet Python (CLI `whisperx`, pipeline, schémas, exports) |
| `whisperx-studio/` | Application **WhisperX Studio** (Tauri) — [README dédié](whisperx-studio/README.md) |
| `tests/` | Tests pytest du paquet Python |
| `docs/` | Documentation complémentaire (datasets, fixtures, etc.) |
| `.github/workflows/` | CI (Python, Studio multi-OS, sécurité, etc.) |

## Installation développeur (Python)

Prérequis typiques : **Python 3.10+**, **ffmpeg** sur le `PATH`, GPU optionnel (CUDA selon plateforme).

Avec **[uv](https://docs.astral.sh/uv/)** (recommandé dans ce repo) :

```bash
git clone https://github.com/Hsbtqemy/LingWhistX.git
cd LingWhistX
uv sync --all-extras
uv run whisperx --help
```

Sans uv : créer un venv, puis `pip install -e .` à la racine du clone.

## WhisperX Studio (application desktop)

L’UI locale vit dans **`whisperx-studio/`** (Node, Rust, worker Python). Installation du runtime (venv + fork en éditable), modes `mock` / `whisperx` / `analyze_only`, ffmpeg, prérequis : tout est décrit ici :

→ **[whisperx-studio/README.md](whisperx-studio/README.md)**

Documentation utilisateur / flux : [whisperx-studio/docs/studio-user-flow.md](whisperx-studio/docs/studio-user-flow.md).

## Extensions LingWhistX (CLI & pipeline)

Ce fork ajoute notamment :

- Découpage média : `--pipeline_chunk_seconds`, `--pipeline_chunk_overlap_seconds` ; persistance reprise long format (`--chunk_state_dir`, `--chunk_resume`, `--chunk_jsonl_per_chunk`).
- Diarisation : `--force_n_speakers` (exclusif avec min/max).
- Réglages d’analyse timeline : `--analysis_pause_*`, `--analysis_ipu_*`, `--analysis_preset`, calibration, post-traitement locuteurs, stabilisation timestamps mots, etc.
- Exports data-science par défaut (`--export_data_science`) : `run.json`, `timeline.json`, CSV (mots, pauses, IPU), CTM (`--export_word_ctm`), option Parquet (`--export_parquet_dataset`).
- Mode **analyze-only** : `--analyze_only_from` pour recalculer les métriques sans relancer l’ASR.
- Orchestrateur : sous-commandes `run`, `transcribe`, `align`, `diarize`, `analyze`, `export` ; options `--config`, `--immutable-run`, `--runs-root`.
- Exports annotation : RTTM, TextGrid, ELAN (`--export_annotation_*`).
- Alignement externe (WX-607) : `--external_word_timings_json`, etc.

Liste détaillée des flags et scénarios E2E : voir les sections déjà maintenues dans l’historique Git ou les docstrings CLI ; les tests d’acceptation couvrent une grande partie (`tests/test_wx*.py`).

## Utilisation CLI rapide

Exemple minimal (après installation du paquet) :

```bash
whisperx chemin/vers/audio.wav
```

Modèle large, diarisation, sur CPU (ex. macOS) :

```bash
whisperx chemin/vers/audio.wav --model large-v2 --diarize --compute_type int8 --device cpu
```

Autres langues et exemples : [EXAMPLES.md](EXAMPLES.md) (hérité de l’écosystème WhisperX).

## Utilisation Python

Exemple simplifié (transcription → alignement → diarisation) :

```python
import whisperx
import gc

device = "cuda"
audio_file = "audio.mp3"
batch_size = 16
compute_type = "float16"

model = whisperx.load_model("large-v2", device, compute_type=compute_type)
audio = whisperx.load_audio(audio_file)
result = model.transcribe(audio, batch_size=batch_size)

model_a, metadata = whisperx.load_align_model(
    language_code=result["language"], device=device
)
result = whisperx.align(
    result["segments"], model_a, metadata, audio, device, return_char_alignments=False
)

from whisperx.diarize import DiarizationPipeline

diarize_model = DiarizationPipeline(token=YOUR_HF_TOKEN, device=device)
diarize_segments = diarize_model(audio)
result = whisperx.assign_word_speakers(diarize_segments, result)
```

Jeton Hugging Face et conditions d’usage des modèles pyannote : voir la documentation WhisperX amont.

## Projet amont, citation et remerciements

LingWhistX **s’appuie sur** le projet WhisperX et les travaux de Max Bain et collaborateurs (VGG, Oxford). Pour citer l’article :

```bibtex
@article{bain2022whisperx,
  title={WhisperX: Time-Accurate Speech Transcription of Long-Form Audio},
  author={Bain, Max and Huh, Jaesung and Han, Tengda and Zisserman, Andrew},
  journal={INTERSPEECH 2023},
  year={2023}
}
```

Logiciels et modèles : OpenAI Whisper, faster-whisper, CTranslate2, pyannote-audio, torchaudio, etc. — voir les remerciements du [README upstream](https://github.com/m-bain/whisperX#readme).

---

*README orienté dépôt LingWhistX. Pour le produit « WhisperX » original et ses annonces, consulter [m-bain/whisperX](https://github.com/m-bain/whisperX).*
