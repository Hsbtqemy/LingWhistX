# Dataset Open Science (WX-608)

Exports produced alongside canonical data-science CSV/JSON:

- **`<basename>.words.ctm`** — NIST-style **word-level CTM** (one token per line: utterance id, channel, start, duration, word, confidence). Enabled by default with `--export_data_science True` and `--export_word_ctm True`. Complements **RTTM** (`--export_annotation_rttm`), which remains speaker-turn level (WX-311).

- **`dataset/`** — when `--export_parquet_dataset True`:
  - `README.md` — layout and `pandas` one-liner
  - `words.parquet`, `pauses.parquet`, `ipus.parquet` — optional mirrors of the CSV tables (**requires `pandas` + `pyarrow`**; if missing, README still documents the intent).

Typical CLI:

```bash
whisperx run audio.wav -o ./out --export_data_science True --export_word_ctm True --export_parquet_dataset True
```

Read Parquet in Python:

```python
import pandas as pd
words = pd.read_parquet("out/dataset/words.parquet")
```
