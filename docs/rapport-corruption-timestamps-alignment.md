# Rapport : Corruption des timestamps d'alignement mot-à-mot

**Date** : 30 mars 2026
**Composant** : `whisperx/alignment.py` — alignement forcé wav2vec2
**Commit fautif** : `f5973a9` (refactor WX-625)
**Sévérité** : Critique — tous les timestamps mot/segment/pause/IPU sont inutilisables

---

## 1. Symptômes observés

### 1.1 Constat initial (côté UI)

Dans le Player de WhisperX Studio, plusieurs anomalies ont été constatées :

- **Vue Karaoké** : les mots s'affichent correctement mais le surlignement ne suit pas la lecture audio — aucun mot n'est jamais « actif » au bon moment.
- **Vue Mots** : même constat, pas de synchronisation playhead ↔ mot.
- **Vue Chat / Rythmo** : les segments s'affichent mais le défilement automatique est erratique.
- **Diarisation** : les locuteurs semblent tous identiques (le speaker assignment échoue silencieusement).

### 1.2 Premières observations quantitatives

L'inspection du fichier `BobHoskins.timeline.json` (audio de ~509 secondes) révèle :

| Champ | Plage observée | Plage attendue |
|---|---|---|
| `segments[].start` | 84 — 13 312 745 s | 0 — 509 s |
| `segments[].end` | 480 769 — 13 707 047 s | 0 — 509 s |
| `words[].start` | 84 — 13 949 471 s | 0 — 509 s |
| `words[].end` | 45 379 — 14 083 325 s | 0 — 509 s |
| `speaker_turns[].start` | 0.689 — 504.188 s | 0 — 509 s **OK** |
| `speaker_turns[].end` | 4.216 — 509.251 s | 0 — 509 s **OK** |
| `pauses[].start/end` | 154 026 — 13 949 471 s | Dérivé des mots — **corrompu** |

Les timestamps des `speaker_turns` (produits par pyannote) sont **sains**. Seuls les champs issus de l'alignement wav2vec2 sont corrompus.

---

## 2. Cheminement de l'investigation

### 2.1 Élimination des pistes frontend

Le frontend React utilise un matching temporel pour surligner le mot actif :

```typescript
for (let i = 0; i < words.length; i++) {
  if (playheadMs >= words[i].startMs && playheadMs < words[i].endMs) return i;
}
```

Avec un `playheadMs` variant de 0 à 509 000 ms et des `startMs` allant jusqu'à 14 milliards de ms, aucun mot n'est jamais matché. Le frontend n'est pas en cause — il reçoit des données corrompues.

### 2.2 Isolation du périmètre de corruption

En comparant les différentes sections du JSON de sortie :

| Source des données | Module producteur | État |
|---|---|---|
| `speaker_turns` | `whisperx/diarize.py` (pyannote) | Sain |
| `transitions`, `overlaps` | Dérivés des `speaker_turns` | Sain |
| `words` (timestamps) | `whisperx/alignment.py` (wav2vec2) | **Corrompu** |
| `segments` (start/end) | Recalculés depuis min/max des `words` | **Corrompu** (par propagation) |
| `pauses`, `ipus` | Calculés depuis les gaps entre `words` | **Corrompu** (par propagation) |

La corruption provient exclusivement de l'étape d'alignement.

### 2.3 Analyse du code d'alignement

Le module `alignment.py` effectue un alignement forcé CTC (Connectionist Temporal Classification) entre le texte transcrit et le signal audio via un modèle wav2vec2.

Le mécanisme clé est le calcul d'un **ratio de conversion** qui transforme un indice de frame dans le trellis CTC en un décalage temporel en secondes :

```python
# Ligne 286-288 de alignment.py (version buggée)
duration = t2 - t1
wave_samples = int(waveform_segment.shape[-1])
ratio = duration * wave_samples / (trellis.size(0) - 1)
```

Ce ratio est ensuite utilisé pour assigner un timestamp à chaque caractère aligné :

```python
start = round(char_seg.start * ratio + t1, 3)
end = round(char_seg.end * ratio + t1, 3)
```

### 2.4 Identification de la régression

En consultant l'historique Git, le commit `f5973a9` (refactor WX-625) a modifié cette ligne. Avant ce commit, le code était :

```python
ratio = duration * waveform_segment.size(0) / (trellis.size(0) - 1)
```

La variable `waveform_segment` a la forme `[1, N]` (batch × samples). Donc :
- **`.size(0)`** = dimension batch = **1** (toujours)
- **`.shape[-1]`** = dernière dimension = **N** = nombre d'échantillons audio

Le refactor a remplacé `.size(0)` par `.shape[-1]`, pensant qu'il s'agissait de la même chose. Ce n'est pas le cas.

---

## 3. Mécanisme de corruption

### 3.1 Formule correcte

```
ratio = duration × 1 / (n_frames - 1)
      = duration / (n_frames - 1)
```

Pour un segment de 26.7 secondes avec ~1335 frames CTC :

```
ratio = 26.7 / 1334 ≈ 0.02
```

Un caractère aligné au frame 50 reçoit le timestamp : `50 × 0.02 + t1 ≈ t1 + 1.0s` — correct.

### 3.2 Formule buggée

```
ratio = duration × wave_samples / (n_frames - 1)
      = duration × (duration × 16000) / (n_frames - 1)
```

Pour le même segment (26.7s à 16 kHz → 427 200 échantillons) :

```
ratio = 26.7 × 427200 / 1334 ≈ 8 548
```

Le même caractère au frame 50 reçoit : `50 × 8548 + t1 ≈ t1 + 427 400s` — soit **~5 jours** au lieu de **~1 seconde**.

### 3.3 Facteur d'inflation

Le facteur d'inflation n'est **pas constant** — il dépend de la durée de chaque segment Whisper :

```
facteur = wave_samples = duration × sample_rate = duration × 16000
```

| Durée du segment | Facteur d'inflation | Timestamp max résultant |
|---|---|---|
| 5 s | 80 000× | ~400 000 s |
| 15 s | 240 000× | ~3 600 000 s |
| 30 s | 480 000× | ~14 400 000 s |

Cela explique la distribution non-uniforme des timestamps corrompus : les segments courts produisent des timestamps « modérément » gonflés, les segments longs produisent des valeurs astronomiques.

### 3.4 Effets en cascade

```
alignment.py (ratio buggé)
    → words[].start / words[].end    CORROMPU
        → segments recalculés depuis min/max(words)    CORROMPU
            → pauses (gaps entre mots consécutifs)    CORROMPU
            → IPUs (regroupements de mots)    CORROMPU
            → assign_word_speakers() (matching temporel words ↔ turns)    ÉCHEC SILENCIEUX
                → segments sans speaker assigné
```

La fonction `assign_word_speakers` tente de matcher des mots à 14 millions de secondes avec des tours de parole entre 0 et 509 secondes. Aucun mot ne tombe dans la fenêtre temporelle d'un tour → tous les segments restent sans locuteur.

---

## 4. Correction

### 4.1 Fix appliqué

```diff
  duration = t2 - t1
- wave_samples = int(waveform_segment.shape[-1])
- ratio = duration * wave_samples / (trellis.size(0) - 1)
+ ratio = duration / (trellis.size(0) - 1)
```

La variable `wave_samples` est supprimée car elle n'est utilisée nulle part ailleurs. Le ratio retrouve sa sémantique originale : il convertit un indice de frame du trellis CTC en un décalage temporel en secondes depuis le début du segment.

### 4.2 Validation

- Les 215 tests Python existants passent après la correction (dont les tests d'alignement).
- La formule corrigée est cohérente avec le [tutoriel PyTorch de référence](https://pytorch.org/tutorials/intermediate/forced_alignment_with_torchaudio_tutorial.html) dont ce code est dérivé.

### 4.3 Actions requises

1. **Relancer les transcriptions existantes** : les fichiers JSON déjà produits contiennent des timestamps corrompus. Il faut relancer au minimum la phase d'alignement (`whisperx align`) ou une transcription complète (`whisperx run`) pour obtenir des timestamps corrects.

2. **Le frontend conserve ses fallbacks proportionnels** : les workarounds implémentés dans le Player (matching proportionnel quand les timestamps sont aberrants) restent en place comme filet de sécurité, mais ne seront plus déclenchés sur des données saines.

3. **Ajouter un test de régression** : un test unitaire vérifiant que les timestamps produits par `align()` restent dans la plage `[t1, t2]` du segment d'entrée empêcherait toute régression future de ce type.

---

## 5. Leçons

1. **Confusion dimensionnelle sur les tenseurs** : `.size(0)` et `.shape[-1]` ne sont interchangeables que pour les tenseurs 1D. Pour un tenseur `[batch, samples]`, `.size(0)` = batch et `.shape[-1]` = samples. Le refactor aurait dû vérifier la sémantique, pas seulement la syntaxe.

2. **Absence de garde-fou sur les timestamps** : une simple assertion `assert start <= t2 and end <= t2` après le calcul aurait détecté le bug immédiatement. Les valeurs à 14 millions de secondes (~162 jours) pour un audio de 8 minutes auraient été flagrantes.

3. **Échec silencieux en cascade** : la corruption des timestamps n'a produit aucune erreur ni warning. Chaque module en aval (timeline, diarize, UI) a simplement produit des résultats vides ou incohérents sans signal d'alarme.
