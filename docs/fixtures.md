# Fixtures de test (audio / scénarios)

## WX-610 — scénario « sport » (deux locuteurs + overlap)

- **Synthétique (défaut)** : `tests/test_wx610_integration_sport.py` construit une timeline sans fichier WAV (commentateurs `C_A` / `C_B`, chevauchement de tours). Aucun binaire lourd dans le dépôt.
- **Audio réel (optionnel)** : aligné sur `tests/test_pipeline_e2e_real_audio.py` — définir `WHISPERX_RUN_AUDIO_E2E=1` et éventuellement `WHISPERX_E2E_AUDIO_URL` pour une URL de téléchargement (voir en-tête du fichier E2E).

### Sport vs interview

| Aspect | Style « sport » (fixture WX-610) | Style « interview » typique |
|--------|-----------------------------------|-----------------------------|
| Tours locuteurs | Chevauchements fréquents, transitions rapides | Moins d’overlap, tours plus longs |
| Pauses / IPU | Pauses courtes entre mots denses, IPU nombreux | Pauses plus longues, IPU plus stables |
| Métriques | `stats` vs `stats_clean` écartées si overlap | Souvent plus proches si peu d’overlap |

Les invariants vérifiés (effectifs `stats_clean` ≤ `stats` sur pauses/IPU/mots, présence d’overlap) sont documentés dans le fichier de test.

### Téléchargement léger (sans commit)

Exemple avec l’URL par défaut du test E2E PyTorch (voir `WHISPERX_E2E_AUDIO_URL` dans `test_pipeline_e2e_real_audio.py`) :

```bash
curl -L -o /tmp/sample_e2e.wav \
  "https://download.pytorch.org/torchaudio/tutorial-assets/Lab41-SRI-VOiCES-src-sp0307-ch127535-sg0042.wav"
```

Ne pas versionner de fichiers WAV volumineux ; utiliser une URL interne en CI si besoin.
