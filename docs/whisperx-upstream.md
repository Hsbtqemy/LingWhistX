# WhisperX amont — stratégie pour LingWhistX

Ce dépôt **embarque** le package Python WhisperX (`whisperx/`, voir `pyproject.toml` à la racine pour la version déclarée), et y ajoute Whisper Studio, des adaptations CLI, et parfois des correctifs ciblés. On ne « suit » pas le dépôt officiel en temps réel : il faut une **politique explicite** de traçabilité et de resynchronisation.

Référence amont : [m-bain/whisperx](https://github.com/m-bain/whisperx) (indiquée aussi dans `pyproject.toml`).

### État actuel (retrouvé par Git, vérifié 2026-04-03)

| Repère | Valeur |
|--------|--------|
| Version dans `pyproject.toml` | **3.8.2** |
| Dernier **ancêtre commun** avec `m-bain/whisperx` `main` | **`646f511e6bb47f8d2f0687e9976f8e7035b1e18d`** — *fix: remove dead model_bytes read that leaked file handle* (2026-03-17) |
| Tag amont le plus proche **en dessous** | **`v3.8.2`** (`6d3edb1`) ; `646f511` est **2 commits après** ce tag sur la ligne officielle (`d00ec69` *progress_callback*, puis `646f511`). |
| Commits sur `main` amont **après** cet ancêtre (à merger pour rattraper) | Jusqu’au tag **`v3.8.5`** (`4a6477e`) : correctifs timestamps mots (#1372), pytest en CI, bumps 3.8.3–3.8.5, contraintes torch/torchvision/torchcodec, etc. *(nombre exact : `git log --oneline 646f511..FETCH_HEAD` après `git fetch`)* |

Commande pour **recalculer** après un `git fetch` du dépôt amont :

```bash
git fetch https://github.com/m-bain/whisperx.git main
git merge-base HEAD FETCH_HEAD
git log --oneline "$(git merge-base HEAD FETCH_HEAD)..FETCH_HEAD"
```

L’historique Git de LingWhistX **contient** la chaîne amont jusqu’à `646f511` ; les commits suivants sont surtout **Studio, Tauri, worker et adaptations** (plus de 70 commits après cet ancêtre au moment de la vérification).

---

## 1. Modèle à admettre

- **Version supportée** : celle du graphe résolu (`uv.lock`) + version sémantique dans `pyproject.toml`, pas seulement un numéro isolé.
- **Écart assumé** : toute modification sous `whisperx/` crée une **divergence** par rapport au tag/commit upstream correspondant. C’est normal ; il faut la **documenter** (voir ci-dessous).

---

## 2. Traçabilité (indispensable)

Mettre à jour la section **État actuel** en haut de ce fichier à chaque resynchronisation majeure, et compléter si besoin :

| Élément | Exemple |
|--------|---------|
| Dernier tag ou commit **upstream** | Voir le tableau « État actuel » (`646f511`, proche de `v3.8.2`) |
| Date de la dernière **resynchronisation** | À noter quand vous fusionnez `main` amont |
| Fichiers ou zones **LingWhistX-specific** | ex. `whisperx/cli.py`, `whisperx/utils.py`, worker Studio |

Sans ces repères, une mise à jour amont devient un exercice de mémoire fragile.

---

## 3. Réduire la surface de divergence

Objectif : que le prochain merge upstream soit **faisable** en quelques heures, pas en semaines.

- Préférer des **modules propres** au projet (appelés depuis la CLI ou le worker) plutôt que d’étaler des patchs dans tout le cœur de WhisperX.
- Lorsqu’un changement doit vivre **dans** `whisperx/*`, le limiter à quelques fichiers et le **signaler** (commentaire court `LingWhistX:` ou fichier dédié `whisperx/lingwhistx_*.py` importé depuis un point d’entrée stable).
- Éviter les refactorings « cosmétiques » dans le code amont copié : ils masquent les vrais écarts fonctionnels au diff suivant.

---

## 4. Resynchronisation par vagues (pas en continu)

On ne rebase pas sur chaque commit upstream. Cycle typique :

1. **Surveiller** les releases et le changelog du dépôt officiel (et les issues qui touchent alignement, diarisation, dépendances lourdes).
2. Ajouter un **remote** `upstream` pointant vers `m-bain/whisperx` (ou récupérer une archive du tag cible).
3. Travailler dans une **branche dédiée** (ex. `upstream/whisperx-AAAA-MM`), merger ou cherry-pick entre l’ancienne base et la nouvelle, en résolvant les conflits surtout dans les fichiers **déjà modifiés localement**.
4. Exécuter :
   - `uv sync` / résolution des conflits de lock si besoin ;
   - `pytest` sur `tests/` ;
   - la CI pertinente (ex. workflows touchant `whisperx/` et WhisperX Studio).
5. Faire un **smoke** manuel ou scripté : transcription courte, alignement, export — selon ce que le produit garantit.
6. Ne fusionner dans `main` qu’après **liste des régressions connues** (CLI, structure JSON, chemins de modèles).

Fréquence suggérée : **trimestrielle** ou à chaque **release majeure** upstream qui apporte correctifs de sécurité ou de compatibilité Torch.

---

## 5. Détection précoce : CI « canary » (optionnel)

Un job **planifié** (hebdomadaire ou à chaque release PyPI) peut :

- installer WhisperX depuis **PyPI** ou la branche `main` dans un environnement **isolé** ;
- lancer un sous-ensemble de tests ou un script minimal (CLI, import, pipeline réduit).

But : signaler tôt qu’**upstream a bougé** (API, dépendances), sans obliger à merger immédiatement. Le vendoring dans LingWhistX reste la source de vérité pour les builds utilisateur.

---

## 6. Contribuer en amont

Si un correctif est **générique** (bug d’alignement, option CLI propre, doc), l’ouvrir sur le dépôt officiel réduit la dette : au prochain cycle de fusion, le patch peut **disparaître** de votre diff local.

---

## 7. Zones sensibles lors d’une montée de version

| Zone | Risque |
|------|--------|
| **CLI** (`whisperx/cli.py`, sous-commandes) | Le worker Studio et les scripts invoquent la même interface ; tout renommage ou changement de défauts d’options casse l’IPC ou les jobs. |
| **Sorties JSON / schémas de segments** | L’UI et le Rust s’attendent à des clés et structures stables ; comparer avec des **fixtures** ou golden files minimaux. |
| **Alignement / diarisation** | Fortement liés aux versions **torch**, **pyannote**, **faster-whisper** ; lire les release notes upstream et les contraintes `uv`. |
| **Fichiers déjà produits** | Un changement de format peut invalider d’anciens runs ; prévoir migration ou message utilisateur (comme pour les timestamps documentés ailleurs dans `docs/`). |

---

## 8. Checklist rapide avant de merger une resynchronisation

- [ ] Tag/commit upstream de référence noté en tête de ce document (ou journal).
- [ ] `uv lock` cohérent, pas de dépendances cassées sur les OS cibles.
- [ ] Tests Python et CI verts sur la branche de fusion.
- [ ] Smoke pipeline (court) sur au moins un fichier audio de référence.
- [ ] Liste des **fichiers `whisperx/` modifiés côté LingWhistX** revue pour conflits futurs.

---

## Voir aussi

- `CLAUDE.md` — structure du monorepo et commandes.
- `docs/rapport-corruption-timestamps-alignment.md` — exemple de sensibilité des sorties temporelles à la chaîne ASR/alignement.
