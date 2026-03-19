# Findings Evidence

Date: 2026-03-19

## 1) CLI options vs effective behavior

- `--segment_resolution` is declared but no consumption found:
  - `whisperx/__main__.py:73`
- `--fp16` is declared but no consumption found:
  - `whisperx/__main__.py:63`
- `--best_of` declared in CLI but not wired in `transcribe_task` options map:
  - declaration: `whisperx/__main__.py:52`
  - default ASR option exists in model loader: `whisperx/asr.py:373`
- `--condition_on_previous_text` declared in CLI but hard-forced to `False` downstream:
  - declaration: `whisperx/__main__.py:62`
  - forced values: `whisperx/transcribe.py:107`, `whisperx/asr.py:382`

## 2) Language overwrite at output stage

- `align_language` variable and final overwrite:
  - `whisperx/transcribe.py:84`
  - `whisperx/transcribe.py:237` (`result["language"] = align_language`)

Implication: detected language can be replaced by default/initial language.

## 3) CI quality gates

- Current compatibility workflow runs install + import smoke test only:
  - `.github/workflows/python-compatibility.yml:30`
  - `.github/workflows/python-compatibility.yml:32`
  - `.github/workflows/python-compatibility.yml:34`

No pytest/mypy/ruff execution in provided workflows.

## 4) Packaging mismatch

- `MANIFEST.in` references a missing file:
  - `MANIFEST.in:3` contains `include requirements.txt`
  - `requirements.txt` absent at repo root (checked during audit)
