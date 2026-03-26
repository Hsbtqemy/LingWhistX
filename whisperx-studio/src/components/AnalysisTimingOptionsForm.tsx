import type { Dispatch, SetStateAction } from "react";
import { startTransition } from "react";
import type { UiWhisperxOptions } from "../types";

export type AnalysisTimingOptionsFormProps = {
  whisperxOptions: UiWhisperxOptions;
  setWhisperxOptions: Dispatch<SetStateAction<UiWhisperxOptions>>;
};

export function AnalysisTimingOptionsForm({
  whisperxOptions,
  setWhisperxOptions,
}: AnalysisTimingOptionsFormProps) {
  return (
    <div className="option-grid">
      <p className="field-help full-width">
        Ces réglages ne lancent pas WhisperX : ils sont transmis au worker uniquement lorsque tu
        cliques sur <strong>Lancer le job</strong> (avec confirmation en mode lourd).
      </p>
      <label>
        Pause min (s)
        <input
          value={whisperxOptions.analysisPauseMin}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisPauseMin: e.currentTarget.value,
            }))
          }
          placeholder="0.15"
        />
      </label>

      <label>
        Pause ignore below (s)
        <input
          value={whisperxOptions.analysisPauseIgnoreBelow}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisPauseIgnoreBelow: e.currentTarget.value,
            }))
          }
          placeholder="0.1"
        />
      </label>

      <label>
        Pause max (s)
        <input
          value={whisperxOptions.analysisPauseMax}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisPauseMax: e.currentTarget.value,
            }))
          }
          placeholder="vide = aucune limite"
        />
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={whisperxOptions.analysisIncludeNonspeech}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisIncludeNonspeech: e.currentTarget.checked,
            }))
          }
        />
        Inclure non-speech
      </label>

      <label>
        Non-speech min duration (s)
        <input
          value={whisperxOptions.analysisNonspeechMinDuration}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisNonspeechMinDuration: e.currentTarget.value,
            }))
          }
          placeholder="0.15"
        />
      </label>

      <label>
        IPU min words
        <input
          value={whisperxOptions.analysisIpuMinWords}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisIpuMinWords: e.currentTarget.value,
            }))
          }
          placeholder="1"
        />
      </label>

      <label>
        IPU min duration (s)
        <input
          value={whisperxOptions.analysisIpuMinDuration}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisIpuMinDuration: e.currentTarget.value,
            }))
          }
          placeholder="0"
        />
      </label>

      <label>
        IPU bridge short gaps under (s)
        <input
          value={whisperxOptions.analysisIpuBridgeShortGapsUnder}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisIpuBridgeShortGapsUnder: e.currentTarget.value,
            }))
          }
          placeholder="0"
        />
      </label>

      <h3 className="full-width">Tours de parole (WX-605)</h3>
      <p className="field-help full-width">
        Optionnel : fusion / scission des tours après diarization. Laisser vide pour les défauts
        CLI.
      </p>

      <label>
        Preset post-traitement
        <select
          value={whisperxOptions.analysisSpeakerTurnPostprocessPreset}
          onChange={(e) => {
            const analysisSpeakerTurnPostprocessPreset = e.currentTarget.value;
            startTransition(() => {
              setWhisperxOptions((prev) => ({ ...prev, analysisSpeakerTurnPostprocessPreset }));
            });
          }}
        >
          <option value="">(défaut)</option>
          <option value="sport_duo">sport_duo</option>
        </select>
      </label>

      <label>
        Fusion gap max (s)
        <input
          value={whisperxOptions.analysisSpeakerTurnMergeGapSecMax}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisSpeakerTurnMergeGapSecMax: e.currentTarget.value,
            }))
          }
          placeholder="ex. 0.08"
        />
      </label>

      <label>
        Scission gap mots (s)
        <input
          value={whisperxOptions.analysisSpeakerTurnSplitWordGapSec}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisSpeakerTurnSplitWordGapSec: e.currentTarget.value,
            }))
          }
          placeholder="ex. 0.45"
        />
      </label>

      <h3 className="full-width">Timestamps mots (WX-606)</h3>
      <p className="field-help full-width">
        Détection / lissage des timestamps aberrants ; laisser les champs vides pour les défauts
        pipeline.
      </p>

      <label>
        Mode stabilisation
        <select
          value={whisperxOptions.analysisWordTimestampStabilizeMode}
          onChange={(e) => {
            const analysisWordTimestampStabilizeMode = e.currentTarget
              .value as UiWhisperxOptions["analysisWordTimestampStabilizeMode"];
            startTransition(() => {
              setWhisperxOptions((prev) => ({ ...prev, analysisWordTimestampStabilizeMode }));
            });
          }}
        >
          <option value="off">off</option>
          <option value="detect">detect</option>
          <option value="smooth">smooth</option>
        </select>
      </label>

      <label>
        Ratio voisin bas
        <input
          value={whisperxOptions.analysisWordTsNeighborRatioLow}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisWordTsNeighborRatioLow: e.currentTarget.value,
            }))
          }
          placeholder="ex. 0.25"
        />
      </label>

      <label>
        Ratio voisin haut
        <input
          value={whisperxOptions.analysisWordTsNeighborRatioHigh}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisWordTsNeighborRatioHigh: e.currentTarget.value,
            }))
          }
          placeholder="ex. 4"
        />
      </label>

      <label>
        Lissage max (s)
        <input
          value={whisperxOptions.analysisWordTsSmoothMaxSec}
          onChange={(e) =>
            setWhisperxOptions((prev) => ({
              ...prev,
              analysisWordTsSmoothMaxSec: e.currentTarget.value,
            }))
          }
          placeholder="ex. 0.02"
        />
      </label>
    </div>
  );
}
