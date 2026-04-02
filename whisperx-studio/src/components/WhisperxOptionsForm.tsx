import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { profilePresets as defaultProfilePresets, WHISPER_MODEL_CHOICES } from "../constants";
import { PIPELINE_MODULES_DOC_URL } from "../docUrls";
import type { ProfilePreset, UiWhisperxOptions } from "../types";
import { runInTransition, setWhisperxOptionsDeferred } from "../whisperxOptionsTransitions";
import { HfScopeBadge } from "./HfScopeBadge";

const OUTPUT_FORMAT_ORDER = ["json", "srt", "vtt", "txt", "tsv", "aud"] as const;

function parseCustomOutputFormats(s: string): Set<string> {
  if (s === "all") {
    return new Set(OUTPUT_FORMAT_ORDER);
  }
  const parts = s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const set = new Set<string>();
  for (const p of parts) {
    if ((OUTPUT_FORMAT_ORDER as readonly string[]).includes(p)) {
      set.add(p);
    }
  }
  set.add("json");
  return set;
}

function joinCustomOutputFormats(set: Set<string>): string {
  return OUTPUT_FORMAT_ORDER.filter((f) => set.has(f)).join(",");
}

export type WhisperxOptionsFormProps = {
  whisperxOptions: UiWhisperxOptions;
  setWhisperxOptions: Dispatch<SetStateAction<UiWhisperxOptions>>;
  selectedProfileId: string;
  onProfileChange: (profileId: string) => void;
  selectedProfile: ProfilePreset | undefined;
  /** Préréglages (souvent adaptés au runtime détecté). */
  profilePresets?: ProfilePreset[];
};

export function WhisperxOptionsForm({
  whisperxOptions,
  setWhisperxOptions,
  selectedProfileId,
  onProfileChange,
  selectedProfile,
  profilePresets = defaultProfilePresets,
}: WhisperxOptionsFormProps) {
  const useAllOutputFormats = whisperxOptions.outputFormat === "all";
  const customOutputFormats = useMemo(
    () => parseCustomOutputFormats(whisperxOptions.outputFormat),
    [whisperxOptions.outputFormat],
  );

  const modelValue = whisperxOptions.model.trim() || "small";
  const modelIsListed = useMemo(
    () => WHISPER_MODEL_CHOICES.some((c) => c.value === modelValue),
    [modelValue],
  );

  /** WX-666 — avertissement coût compute si sourceSeparate est activé dans le JSON pipeline. */
  const hasSourceSeparate = useMemo(() => {
    const raw = whisperxOptions.audioPipelineModulesJson.trim();
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return (
        typeof parsed === "object" &&
        parsed !== null &&
        "sourceSeparate" in parsed &&
        parsed.sourceSeparate !== false &&
        parsed.sourceSeparate !== null
      );
    } catch {
      return false;
    }
  }, [whisperxOptions.audioPipelineModulesJson]);

  const patchWhisperx = useCallback(
    (partial: Partial<UiWhisperxOptions>) => {
      setWhisperxOptions((prev) => ({ ...prev, ...partial }));
    },
    [setWhisperxOptions],
  );

  async function pickExternalWordTimingsJson() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Fichier JSON timings mots (WX-607)",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof selected === "string") {
      setWhisperxOptionsDeferred(setWhisperxOptions, { externalWordTimingsJson: selected });
    }
  }

  return (
    <>
      <label>
        Profil rapide
        <select
          value={selectedProfileId}
          onChange={(e) => runInTransition(() => onProfileChange(e.currentTarget.value))}
        >
          {profilePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="field-help">{selectedProfile?.description}</p>
      </label>

      <div className="option-grid job-form-whisperx-basic">
        <label>
          Modele Whisper
          <select
            value={modelValue}
            onChange={(e) => patchWhisperx({ model: e.currentTarget.value })}
          >
            {!modelIsListed ? (
              <option value={modelValue}>{modelValue} (valeur actuelle, hors liste)</option>
            ) : null}
            {WHISPER_MODEL_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <p className="field-help">
            Liste des noms faster-whisper acceptés par WhisperX. Plus le modèle est grand, plus la
            précision augmente (temps et mémoire aussi).
          </p>
        </label>

        <label>
          Langue
          <input
            value={whisperxOptions.language}
            onChange={(e) => patchWhisperx({ language: e.currentTarget.value })}
            placeholder="fr, en... (vide = autodetection)"
          />
          <p className="field-help">Laisser vide pour autodetection (plus lent).</p>
        </label>
      </div>

      <details className="advanced-job-panel job-form-whisperx-advanced">
        <summary className="advanced-job-summary">
          Options WhisperX avancées
          <span className="advanced-job-summary__hint">
            Regroupées par thème : calcul, découpage média, VAD, locuteurs, alignement, exports,
            pipeline JSON.
          </span>
        </summary>
        <div className="advanced-job-body advanced-job-body--whisperx-sections">
          <p className="small job-form-advanced-lead">
            Les valeurs suivent le profil tant que tu ne modifies pas ces champs. Le token Hugging
            Face n’est demandé dans l’interface que si la <strong>diarization</strong> est activée.
          </p>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-compute-title">
            <h4 id="whisperx-adv-compute-title" className="whisperx-adv-section__title">
              Calcul & mémoire
            </h4>
            <div className="option-grid">
              <label>
                Device
                <select
                  value={whisperxOptions.device}
                  onChange={(e) =>
                    setWhisperxOptionsDeferred(setWhisperxOptions, {
                      device: e.currentTarget.value as UiWhisperxOptions["device"],
                    })
                  }
                >
                  <option value="auto">auto</option>
                  <option value="cuda">cuda (GPU)</option>
                  <option value="cpu">cpu</option>
                </select>
                <p className="field-help">
                  <code>cuda</code> si GPU NVIDIA (CUDA). <code>auto</code> : défaut WhisperX (CUDA
                  si dispo, sinon CPU). Sur <strong>macOS</strong> sans NVIDIA, <code>auto</code>{" "}
                  équivaut en pratique à <strong>cpu</strong> pour transcription <em>et</em>{" "}
                  diarisation — le moteur faster-whisper ne pilote pas le GPU Apple (MPS) ; la
                  diarisation peut donc être longue même sur des fichiers courts.
                </p>
              </label>

              <label>
                Compute Type
                <select
                  value={whisperxOptions.computeType}
                  onChange={(e) =>
                    setWhisperxOptionsDeferred(setWhisperxOptions, {
                      computeType: e.currentTarget.value as UiWhisperxOptions["computeType"],
                    })
                  }
                >
                  <option value="default">default</option>
                  <option value="float16">float16 (GPU rapide)</option>
                  <option value="float32">float32 (precision)</option>
                  <option value="int8">int8 (memoire reduite)</option>
                </select>
              </label>

              <label>
                Batch Size
                <input
                  value={whisperxOptions.batchSize}
                  onChange={(e) => patchWhisperx({ batchSize: e.currentTarget.value })}
                  placeholder="8"
                />
                <p className="field-help">Plus haut = plus rapide, mais plus de VRAM/RAM.</p>
              </label>
            </div>
          </section>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-chunk-title">
            <h4 id="whisperx-adv-chunk-title" className="whisperx-adv-section__title">
              Longs médias (fenêtres pipeline)
            </h4>
            <div className="option-grid">
              <label>
                Chunk media (s)
                <input
                  value={whisperxOptions.pipelineChunkSeconds}
                  onChange={(e) =>
                    patchWhisperx({
                      pipelineChunkSeconds: e.currentTarget.value,
                    })
                  }
                  placeholder="vide = desactive"
                />
                <p className="field-help">
                  Découpe les médias longs en fenêtres globales (ex. 600 pour 10 min).
                </p>
              </label>

              <label>
                Overlap chunk (s)
                <input
                  value={whisperxOptions.pipelineChunkOverlapSeconds}
                  onChange={(e) =>
                    patchWhisperx({
                      pipelineChunkOverlapSeconds: e.currentTarget.value,
                    })
                  }
                  placeholder="0"
                />
                <p className="field-help">
                  Recouvrement entre chunks (doit rester inférieur à Chunk média).
                </p>
              </label>
            </div>
          </section>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-vad-title">
            <h4 id="whisperx-adv-vad-title" className="whisperx-adv-section__title">
              Détection de parole (VAD)
            </h4>
            <div className="option-grid">
              <label className="full-width">
                VAD Method
                <select
                  value={whisperxOptions.vadMethod}
                  onChange={(e) =>
                    setWhisperxOptionsDeferred(setWhisperxOptions, {
                      vadMethod: e.currentTarget.value as UiWhisperxOptions["vadMethod"],
                    })
                  }
                >
                  <option value="pyannote">pyannote (precision)</option>
                  <option value="silero">silero (leger/rapide)</option>
                </select>
                <p className="field-help">
                  Découpe les zones de parole avant transcription. <strong>Silero</strong> évite en
                  pratique le Hub. <strong>Pyannote</strong> charge des modèles depuis Hugging Face
                  : le même mécanisme que la diarization (variable <code>HF_TOKEN</code> côté
                  worker) peut être nécessaire au <strong>premier</strong> téléchargement si le
                  modèle est restreint — l’app n’exige le token dans l’UI que pour la{" "}
                  <strong>diarization</strong> ; en cas d’erreur 401 sur le VAD pyannote, renseigne
                  aussi un token (stocké localement) ou accepte le modèle sur huggingface.co.
                </p>
              </label>
            </div>
          </section>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-diar-title">
            <h4 id="whisperx-adv-diar-title" className="whisperx-adv-section__title">
              Diarization (locuteurs)
            </h4>
            <div className="option-grid">
              <label className="checkbox-row checkbox-row--diarize full-width">
                <input
                  type="checkbox"
                  checked={whisperxOptions.diarize}
                  onChange={(e) =>
                    setWhisperxOptionsDeferred(setWhisperxOptions, {
                      diarize: e.currentTarget.checked,
                    })
                  }
                />
                <span className="checkbox-row__label-with-badge">
                  Activer la diarization (qui parle ?)
                  <HfScopeBadge variant="hf_required" />
                </span>
              </label>
              <p className="field-help full-width">
                Modèles <strong>pyannote</strong> sur Hugging Face : un token de lecture valide est
                <strong> obligatoire</strong> quand cette case est cochée — la carte « Token Hugging
                Face » apparaît alors sous ces options (accords des modèles sur huggingface.co).
              </p>

              <label>
                Min speakers
                <input
                  value={whisperxOptions.minSpeakers}
                  onChange={(e) =>
                    setWhisperxOptions((prev) => ({
                      ...prev,
                      minSpeakers: e.currentTarget.value,
                    }))
                  }
                  placeholder="vide = auto"
                  disabled={!whisperxOptions.diarize}
                />
                <p className="field-help">Optionnel : borne basse pour diarization.</p>
              </label>

              <label>
                Max speakers
                <input
                  value={whisperxOptions.maxSpeakers}
                  onChange={(e) =>
                    patchWhisperx({
                      maxSpeakers: e.currentTarget.value,
                    })
                  }
                  placeholder="vide = auto"
                  disabled={!whisperxOptions.diarize}
                />
                <p className="field-help">Optionnel : borne haute pour diarization.</p>
              </label>

              <label>
                Force N speakers
                <input
                  value={whisperxOptions.forceNSpeakers}
                  onChange={(e) =>
                    patchWhisperx({
                      forceNSpeakers: e.currentTarget.value,
                    })
                  }
                  placeholder="vide = desactive"
                  disabled={!whisperxOptions.diarize}
                />
                <p className="field-help">Nombre exact de locuteurs. Exclusif avec Min/Max.</p>
              </label>
            </div>
          </section>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-align-title">
            <h4 id="whisperx-adv-align-title" className="whisperx-adv-section__title">
              Alignement & horodatage des mots
            </h4>
            <div className="option-grid">
              <label className="checkbox-row full-width">
                <input
                  type="checkbox"
                  checked={whisperxOptions.noAlign}
                  onChange={(e) =>
                    setWhisperxOptionsDeferred(setWhisperxOptions, {
                      noAlign: e.currentTarget.checked,
                    })
                  }
                />
                No Align (plus rapide, horodatage moins fin)
              </label>

              <label className="full-width">
                <div className="actions" style={{ marginBottom: 6 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    Timings mots externes (JSON v1, WX-607)
                  </span>
                  <button
                    type="button"
                    className="ghost inline"
                    onClick={() => void pickExternalWordTimingsJson()}
                  >
                    Parcourir…
                  </button>
                </div>
                <input
                  value={whisperxOptions.externalWordTimingsJson}
                  onChange={(e) =>
                    patchWhisperx({
                      externalWordTimingsJson: e.currentTarget.value,
                    })
                  }
                  placeholder="Chemin absolu vers le JSON (vide = desactive)"
                />
                <p className="field-help">
                  Remplace les start/end des mots après alignement WhisperX (même ordre et nombre de
                  mots que la transcription). Un seul fichier média en entrée. Incompatible avec No
                  Align.
                </p>
              </label>

              <label className="checkbox-row full-width">
                <input
                  type="checkbox"
                  checked={whisperxOptions.externalWordTimingsStrict}
                  onChange={(e) =>
                    setWhisperxOptionsDeferred(setWhisperxOptions, {
                      externalWordTimingsStrict: e.currentTarget.checked,
                    })
                  }
                />
                Strict : vérifier la correspondance des tokens avec le JSON
              </label>
            </div>
          </section>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-out-title">
            <h4 id="whisperx-adv-out-title" className="whisperx-adv-section__title">
              Formats de sortie
            </h4>
            <div className="option-grid">
              <fieldset
                className="full-width output-format-fieldset"
                aria-label="Formats d'export WhisperX"
              >
                <label className="radio-row full-width">
                  <input
                    type="radio"
                    name="lx-output-format-mode"
                    checked={useAllOutputFormats}
                    onChange={() =>
                      setWhisperxOptionsDeferred(setWhisperxOptions, { outputFormat: "all" })
                    }
                  />
                  Tous les formats (équivalent CLI <code className="mono">--output_format all</code>
                  )
                </label>
                <label className="radio-row full-width">
                  <input
                    type="radio"
                    name="lx-output-format-mode"
                    checked={!useAllOutputFormats}
                    onChange={() =>
                      setWhisperxOptionsDeferred(setWhisperxOptions, {
                        outputFormat: "json,srt,vtt",
                      })
                    }
                  />
                  Choisir plusieurs formats
                </label>
                {!useAllOutputFormats ? (
                  <div
                    className="output-format-checkboxes"
                    role="group"
                    aria-label="Formats sélectionnés"
                  >
                    {OUTPUT_FORMAT_ORDER.map((fmt) => (
                      <label key={fmt} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={customOutputFormats.has(fmt)}
                          disabled={fmt === "json"}
                          onChange={(e) => {
                            const next = new Set(customOutputFormats);
                            if (e.currentTarget.checked) {
                              next.add(fmt);
                            } else if (fmt !== "json") {
                              next.delete(fmt);
                            }
                            setWhisperxOptionsDeferred(setWhisperxOptions, {
                              outputFormat: joinCustomOutputFormats(next),
                            });
                          }}
                        />
                        <span className="mono">{fmt}</span>
                        {fmt === "json" ? (
                          <span className="field-help"> (toujours inclus pour Studio)</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                ) : null}
                <p className="field-help">
                  En mode sélection, tu peux combiner plusieurs extensions ; le JSON transcript est
                  toujours demandé côté Studio (ajouté automatiquement côté worker si besoin).
                </p>
              </fieldset>
            </div>
          </section>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-pipe-title">
            <h4 id="whisperx-adv-pipe-title" className="whisperx-adv-section__title">
              Pipeline audio (JSON)
            </h4>
            <div className="option-grid">
              <label className="full-width">
                Modules pipeline audio (JSON optionnel)
                <textarea
                  rows={4}
                  value={whisperxOptions.audioPipelineModulesJson}
                  onChange={(e) =>
                    patchWhisperx({
                      audioPipelineModulesJson: e.currentTarget.value,
                    })
                  }
                  placeholder='{"preNormalize": true, "vadEnergy": true}'
                  spellCheck={false}
                  autoComplete="off"
                  style={{
                    width: "100%",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "0.9em",
                  }}
                />
                <p className="field-help">
                  Objet JSON avec les clés canoniques (
                  <a href={PIPELINE_MODULES_DOC_URL} target="_blank" rel="noreferrer">
                    documentation modules pipeline
                  </a>
                  ). Si ce champ est rempli avec un JSON valide non vide, il remplace tout objet
                  `audioPipelineModules` injecté ailleurs. Laisser vide pour désactiver.
                </p>
                {hasSourceSeparate && (
                  <p className="field-help pipeline-source-separate-warn">
                    ⚠ <strong>sourceSeparate (WX-666)</strong> — séparation Demucs activée. Coût
                    estimé : ~3× temps réel sur CPU. GPU (CUDA) fortement recommandé. Nécessite{" "}
                    <code>pip install demucs</code>.
                  </p>
                )}
              </label>

              <label className="full-width">
                Plages pipeline (JSON, WX-623)
                <textarea
                  rows={5}
                  value={whisperxOptions.audioPipelineSegmentsJson}
                  onChange={(e) =>
                    patchWhisperx({
                      audioPipelineSegmentsJson: e.currentTarget.value,
                    })
                  }
                  placeholder={`[\n  { "startSec": 0, "endSec": 12.5, "audioPipelineModules": { "preNormalize": true } }\n]`}
                  spellCheck={false}
                  autoComplete="off"
                  style={{
                    width: "100%",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "0.9em",
                  }}
                />
                <p className="field-help">
                  Tableau non vide de plages <code>startSec</code>/<code>endSec</code> (secondes),
                  modules optionnels par plage via <code>audioPipelineModules</code> (sinon repli
                  sur le champ « Modules pipeline » ci-dessus) — détail{" "}
                  <a href={PIPELINE_MODULES_DOC_URL} target="_blank" rel="noreferrer">
                    WX-623 dans la même doc
                  </a>
                  . Depuis l&apos;Alignment, « Injecter plage » peut préremplir ce champ. Laisser
                  vide pour désactiver le mode par plages.
                </p>
              </label>
            </div>
          </section>

          <section className="whisperx-adv-section" aria-labelledby="whisperx-adv-log-title">
            <h4 id="whisperx-adv-log-title" className="whisperx-adv-section__title">
              Journaux
            </h4>
            <div className="option-grid">
              <label className="checkbox-row full-width">
                <input
                  type="checkbox"
                  checked={whisperxOptions.printProgress}
                  onChange={(e) =>
                    setWhisperxOptionsDeferred(setWhisperxOptions, {
                      printProgress: e.currentTarget.checked,
                    })
                  }
                />
                Print Progress (logs plus verbeux)
              </label>
            </div>
          </section>
        </div>
      </details>
    </>
  );
}
