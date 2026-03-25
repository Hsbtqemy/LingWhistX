import type { Dispatch, SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { profilePresets } from "../constants";
import type { ProfilePreset, UiWhisperxOptions } from "../types";

export type WhisperxOptionsFormProps = {
  whisperxOptions: UiWhisperxOptions;
  setWhisperxOptions: Dispatch<SetStateAction<UiWhisperxOptions>>;
  selectedProfileId: string;
  onProfileChange: (profileId: string) => void;
  selectedProfile: ProfilePreset | undefined;
};

export function WhisperxOptionsForm({
  whisperxOptions,
  setWhisperxOptions,
  selectedProfileId,
  onProfileChange,
  selectedProfile,
}: WhisperxOptionsFormProps) {
  async function pickExternalWordTimingsJson() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Fichier JSON timings mots (WX-607)",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof selected === "string") {
      setWhisperxOptions((prev) => ({ ...prev, externalWordTimingsJson: selected }));
    }
  }

  return (
    <>
      <label>
        Profil rapide
        <select value={selectedProfileId} onChange={(e) => onProfileChange(e.currentTarget.value)}>
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
          <input
            value={whisperxOptions.model}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({ ...prev, model: e.currentTarget.value }))
            }
            placeholder="small / medium / large-v3"
          />
          <p className="field-help">Plus le modele est grand, plus la precision augmente.</p>
        </label>

        <label>
          Langue
          <input
            value={whisperxOptions.language}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({ ...prev, language: e.currentTarget.value }))
            }
            placeholder="fr, en... (vide = autodetection)"
          />
          <p className="field-help">Laisser vide pour autodetection (plus lent).</p>
        </label>
      </div>

      <details className="advanced-job-panel job-form-whisperx-advanced">
        <summary className="advanced-job-summary">
          Options WhisperX avancées (device, chunks, diarize, alignement…)
        </summary>
        <div className="advanced-job-body">
          <p className="small job-form-advanced-lead">
            Device, découpage média, diarization et exports détaillés — les valeurs restent celles du
            profil tant que tu ne modifies pas ces champs.
          </p>
          <div className="option-grid">
        <label>
          Device
          <select
            value={whisperxOptions.device}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                device: e.currentTarget.value as UiWhisperxOptions["device"],
              }))
            }
          >
            <option value="auto">auto</option>
            <option value="cuda">cuda (GPU)</option>
            <option value="cpu">cpu</option>
          </select>
          <p className="field-help">`cuda` si carte NVIDIA disponible, sinon `cpu`.</p>
        </label>

        <label>
          Compute Type
          <select
            value={whisperxOptions.computeType}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                computeType: e.currentTarget.value as UiWhisperxOptions["computeType"],
              }))
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
            onChange={(e) =>
              setWhisperxOptions((prev) => ({ ...prev, batchSize: e.currentTarget.value }))
            }
            placeholder="8"
          />
          <p className="field-help">Plus haut = plus rapide, mais plus de VRAM/RAM.</p>
        </label>

        <label>
          Chunk media (s)
          <input
            value={whisperxOptions.pipelineChunkSeconds}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                pipelineChunkSeconds: e.currentTarget.value,
              }))
            }
            placeholder="vide = desactive"
          />
          <p className="field-help">
            Decoupe les medias longs en fenetres globales (ex: 600 pour 10 min).
          </p>
        </label>

        <label>
          Overlap chunk (s)
          <input
            value={whisperxOptions.pipelineChunkOverlapSeconds}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                pipelineChunkOverlapSeconds: e.currentTarget.value,
              }))
            }
            placeholder="0"
          />
          <p className="field-help">
            Recouvrement entre chunks (doit rester inferieur a Chunk media).
          </p>
        </label>

        <label>
          Output Format
          <select
            value={whisperxOptions.outputFormat}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                outputFormat: e.currentTarget.value as UiWhisperxOptions["outputFormat"],
              }))
            }
          >
            <option value="all">all</option>
            <option value="json">json</option>
            <option value="srt">srt</option>
            <option value="vtt">vtt</option>
            <option value="txt">txt</option>
            <option value="tsv">tsv</option>
            <option value="aud">aud</option>
          </select>
          <p className="field-help">
            `all` exporte tous les formats utiles. Pour garder l'editeur transcript actif, Studio
            conserve toujours un JSON (meme si tu choisis `srt`/`vtt`/`txt`).
          </p>
        </label>

        <label>
          VAD Method
          <select
            value={whisperxOptions.vadMethod}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                vadMethod: e.currentTarget.value as UiWhisperxOptions["vadMethod"],
              }))
            }
          >
            <option value="pyannote">pyannote (precision)</option>
            <option value="silero">silero (leger/rapide)</option>
          </select>
          <p className="field-help">Decoupe les zones de parole avant transcription.</p>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={whisperxOptions.diarize}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({ ...prev, diarize: e.currentTarget.checked }))
            }
          />
          Diarization (qui parle ?)
        </label>

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
          <p className="field-help">Optionnel: borne basse pour diarization.</p>
        </label>

        <label>
          Max speakers
          <input
            value={whisperxOptions.maxSpeakers}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                maxSpeakers: e.currentTarget.value,
              }))
            }
            placeholder="vide = auto"
            disabled={!whisperxOptions.diarize}
          />
          <p className="field-help">Optionnel: borne haute pour diarization.</p>
        </label>

        <label>
          Force N speakers
          <input
            value={whisperxOptions.forceNSpeakers}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                forceNSpeakers: e.currentTarget.value,
              }))
            }
            placeholder="vide = desactive"
            disabled={!whisperxOptions.diarize}
          />
          <p className="field-help">Exact speaker count. Exclusif avec Min/Max speakers.</p>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={whisperxOptions.noAlign}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({ ...prev, noAlign: e.currentTarget.checked }))
            }
          />
          No Align (plus rapide, horodatage moins fin)
        </label>

        <label className="full-width">
          <div className="actions" style={{ marginBottom: 6 }}>
            <span style={{ flex: 1, minWidth: 0 }}>Timings mots externes (JSON v1, WX-607)</span>
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
              setWhisperxOptions((prev) => ({
                ...prev,
                externalWordTimingsJson: e.currentTarget.value,
              }))
            }
            placeholder="Chemin absolu vers le JSON (vide = desactive)"
          />
          <p className="field-help">
            Remplace les start/end des mots apres alignement WhisperX (meme ordre et nombre de mots
            que la transcription). Un seul fichier media en entree. Incompatible avec No Align.
          </p>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={whisperxOptions.externalWordTimingsStrict}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                externalWordTimingsStrict: e.currentTarget.checked,
              }))
            }
          />
          Strict: verifier la correspondance des tokens avec le JSON
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={whisperxOptions.printProgress}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                printProgress: e.currentTarget.checked,
              }))
            }
          />
          Print Progress (logs plus verbeux)
        </label>

        <label className="full-width">
          Modules pipeline audio (JSON optionnel)
          <textarea
            rows={4}
            value={whisperxOptions.audioPipelineModulesJson}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                audioPipelineModulesJson: e.currentTarget.value,
              }))
            }
            placeholder='{"preNormalize": true, "vadEnergy": true}'
            spellCheck={false}
            autoComplete="off"
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: "0.9em" }}
          />
          <p className="field-help">
            Objet JSON avec les clés canoniques (voir audit/pipeline-modules-multi-speaker.md). Si ce
            champ est rempli avec un JSON valide non vide, il remplace tout objet
            `audioPipelineModules` injecté ailleurs. Laisser vide pour désactiver.
          </p>
        </label>

        <label className="full-width">
          Plages pipeline (JSON, WX-623)
          <textarea
            rows={5}
            value={whisperxOptions.audioPipelineSegmentsJson}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({
                ...prev,
                audioPipelineSegmentsJson: e.currentTarget.value,
              }))
            }
            placeholder={`[\n  { "startSec": 0, "endSec": 12.5, "audioPipelineModules": { "preNormalize": true } }\n]`}
            spellCheck={false}
            autoComplete="off"
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: "0.9em" }}
          />
          <p className="field-help">
            Tableau non vide de plages <code>startSec</code>/<code>endSec</code> (secondes), modules
            optionnels par plage via <code>audioPipelineModules</code> (sinon repli sur le champ
            « Modules pipeline » ci-dessus). Depuis l’Alignment, « Injecter plage » peut préremplir ce
            champ. Laisser vide pour désactiver le mode par plages.
          </p>
        </label>

        <label className="full-width">
          HF Token (optionnel, requis si diarization)
          <input
            value={whisperxOptions.hfToken}
            onChange={(e) =>
              setWhisperxOptions((prev) => ({ ...prev, hfToken: e.currentTarget.value }))
            }
            placeholder="hf_xxx"
          />
          <p className="field-help">Token Hugging Face lecture pour modeles pyannote.</p>
        </label>
          </div>
        </div>
      </details>
    </>
  );
}
