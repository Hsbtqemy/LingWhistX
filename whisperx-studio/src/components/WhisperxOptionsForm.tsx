import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { PIPELINE_MODULES_DOC_URL } from "../docUrls";
import type { UiWhisperxOptions } from "../types";
import { setWhisperxOptionsDeferred } from "../whisperxOptionsTransitions";

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

export type WhisperxAdvancedFormProps = {
  whisperxOptions: UiWhisperxOptions;
  setWhisperxOptions: Dispatch<SetStateAction<UiWhisperxOptions>>;
};

/**
 * Options WhisperX avancees — plat, sans `<details>` interne.
 * Les options essentielles (profil, modele, langue, diarize) sont dans StudioNewJobSection.
 */
export function WhisperxAdvancedForm({
  whisperxOptions,
  setWhisperxOptions,
}: WhisperxAdvancedFormProps) {
  const useAllOutputFormats = whisperxOptions.outputFormat === "all";
  const customOutputFormats = useMemo(
    () => parseCustomOutputFormats(whisperxOptions.outputFormat),
    [whisperxOptions.outputFormat],
  );

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
      title: "Fichier JSON timings mots",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof selected === "string") {
      setWhisperxOptionsDeferred(setWhisperxOptions, { externalWordTimingsJson: selected });
    }
  }

  return (
    <div className="whisperx-advanced-flat">
      {/* ── Calcul & mémoire ── */}
      <h4 className="whisperx-adv-section__title">Calcul & mémoire</h4>
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
          <p className="field-help">auto = CUDA si dispo, sinon CPU.</p>
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
            <option value="float32">float32 (précision)</option>
            <option value="int8">int8 (mémoire réduite)</option>
          </select>
        </label>

        <label>
          Batch Size
          <input
            value={whisperxOptions.batchSize}
            onChange={(e) => patchWhisperx({ batchSize: e.currentTarget.value })}
            placeholder="8"
          />
          <p className="field-help">Plus haut = plus rapide, plus de VRAM.</p>
        </label>
      </div>

      {/* ── Découpage longs médias ── */}
      <h4 className="whisperx-adv-section__title">Longs médias</h4>
      <div className="option-grid">
        <label>
          Chunk média (s)
          <input
            value={whisperxOptions.pipelineChunkSeconds}
            onChange={(e) => patchWhisperx({ pipelineChunkSeconds: e.currentTarget.value })}
            placeholder="vide = désactivé"
          />
          <p className="field-help">Découpe en fenêtres (ex. 600 pour 10 min).</p>
        </label>

        <label>
          Overlap (s)
          <input
            value={whisperxOptions.pipelineChunkOverlapSeconds}
            onChange={(e) => patchWhisperx({ pipelineChunkOverlapSeconds: e.currentTarget.value })}
            placeholder="0"
          />
        </label>
      </div>

      {/* ── VAD ── */}
      <h4 className="whisperx-adv-section__title">Détection de parole (VAD)</h4>
      <div className="option-grid">
        <label className="full-width">
          Méthode
          <select
            value={whisperxOptions.vadMethod}
            onChange={(e) =>
              setWhisperxOptionsDeferred(setWhisperxOptions, {
                vadMethod: e.currentTarget.value as UiWhisperxOptions["vadMethod"],
              })
            }
          >
            <option value="pyannote">pyannote (précision)</option>
            <option value="silero">silero (léger/rapide)</option>
          </select>
          <p className="field-help">Découpe les zones de parole avant transcription.</p>
        </label>
      </div>

      {/* ── Diarization avancée ── */}
      <h4 className="whisperx-adv-section__title">Diarization avancée</h4>
      <div className="option-grid">
        <label>
          Forcer N locuteurs
          <input
            value={whisperxOptions.forceNSpeakers}
            onChange={(e) => patchWhisperx({ forceNSpeakers: e.currentTarget.value })}
            placeholder="vide = désactivé"
            disabled={!whisperxOptions.diarize}
          />
          <p className="field-help">Exclusif avec Min/Max.</p>
        </label>
      </div>

      {/* ── Alignement ── */}
      <h4 className="whisperx-adv-section__title">Alignement & horodatage</h4>
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
          Timings mots externes (JSON)
          <div className="path-input-row">
            <input
              value={whisperxOptions.externalWordTimingsJson}
              onChange={(e) => patchWhisperx({ externalWordTimingsJson: e.currentTarget.value })}
              placeholder="Chemin absolu (vide = désactivé)"
            />
            <button
              type="button"
              className="ghost inline"
              onClick={() => void pickExternalWordTimingsJson()}
            >
              Parcourir
            </button>
          </div>
          <p className="field-help">Remplace les start/end mots après alignement.</p>
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
          Strict : vérifier correspondance des tokens
        </label>
      </div>

      {/* ── Formats de sortie ── */}
      <h4 className="whisperx-adv-section__title">Formats de sortie</h4>
      <div className="option-grid">
        <fieldset className="full-width output-format-fieldset" aria-label="Formats d'export">
          <label className="radio-row full-width">
            <input
              type="radio"
              name="lx-output-format-mode"
              checked={useAllOutputFormats}
              onChange={() =>
                setWhisperxOptionsDeferred(setWhisperxOptions, { outputFormat: "all" })
              }
            />
            <span>Tous les formats</span>
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
            <span>Sélectionner</span>
          </label>
          {!useAllOutputFormats && (
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
                  {fmt === "json" && <span className="field-help"> (toujours inclus)</span>}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>

      {/* ── Pipeline audio JSON ── */}
      <h4 className="whisperx-adv-section__title">Pipeline audio (JSON)</h4>
      <div className="option-grid">
        <label className="full-width">
          Modules pipeline
          <textarea
            rows={3}
            value={whisperxOptions.audioPipelineModulesJson}
            onChange={(e) => patchWhisperx({ audioPipelineModulesJson: e.currentTarget.value })}
            placeholder='{"preNormalize": true}'
            spellCheck={false}
            autoComplete="off"
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: "0.9em" }}
          />
          <p className="field-help">
            Objet JSON optionnel (
            <a href={PIPELINE_MODULES_DOC_URL} target="_blank" rel="noreferrer">
              doc
            </a>
            ). Vide = désactivé.
          </p>
          {hasSourceSeparate && (
            <p className="field-help pipeline-source-separate-warn">
              Séparation Demucs activée — coût ~3x temps réel CPU. GPU recommandé.
            </p>
          )}
        </label>

        <label className="full-width">
          Plages pipeline (JSON)
          <textarea
            rows={3}
            value={whisperxOptions.audioPipelineSegmentsJson}
            onChange={(e) => patchWhisperx({ audioPipelineSegmentsJson: e.currentTarget.value })}
            placeholder={`[{"startSec": 0, "endSec": 12.5}]`}
            spellCheck={false}
            autoComplete="off"
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: "0.9em" }}
          />
          <p className="field-help">Tableau de plages startSec/endSec. Vide = désactivé.</p>
        </label>
      </div>

      {/* ── Journaux ── */}
      <h4 className="whisperx-adv-section__title">Journaux</h4>
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
          Logs détaillés (print progress)
        </label>
      </div>
    </div>
  );
}
