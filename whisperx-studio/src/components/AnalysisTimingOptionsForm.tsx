import type { Dispatch, SetStateAction } from "react";
import type { UiWhisperxOptions } from "../types";
import { setWhisperxOptionsDeferred } from "../whisperxOptionsTransitions";

export type AnalysisTimingOptionsFormProps = {
  whisperxOptions: UiWhisperxOptions;
  setWhisperxOptions: Dispatch<SetStateAction<UiWhisperxOptions>>;
};

export function AnalysisTimingOptionsForm({
  whisperxOptions,
  setWhisperxOptions,
}: AnalysisTimingOptionsFormProps) {
  return (
    <div className="analysis-timing-flat">
      <h4 className="whisperx-adv-section__title">Pauses & IPU</h4>
      <div className="option-grid">
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
            placeholder="vide = pas de limite"
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={whisperxOptions.analysisIncludeNonspeech}
            onChange={(e) =>
              setWhisperxOptionsDeferred(setWhisperxOptions, {
                analysisIncludeNonspeech: e.currentTarget.checked,
              })
            }
          />
          Inclure non-speech
        </label>

        <label>
          Non-speech min (s)
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
          IPU min mots
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
          IPU min durée (s)
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
          IPU bridge gaps (s)
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
          <p className="field-help">Fusionne gaps courts sous ce seuil.</p>
        </label>
      </div>

      <h4 className="whisperx-adv-section__title">Tours de parole</h4>
      <div className="option-grid">
        <label>
          Preset post-traitement
          <select
            value={whisperxOptions.analysisSpeakerTurnPostprocessPreset}
            onChange={(e) =>
              setWhisperxOptionsDeferred(setWhisperxOptions, {
                analysisSpeakerTurnPostprocessPreset: e.currentTarget.value,
              })
            }
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
            placeholder="0.08"
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
            placeholder="0.45"
          />
        </label>
      </div>

      <h4 className="whisperx-adv-section__title">Timestamps mots</h4>
      <div className="option-grid">
        <label>
          Stabilisation
          <select
            value={whisperxOptions.analysisWordTimestampStabilizeMode}
            onChange={(e) =>
              setWhisperxOptionsDeferred(setWhisperxOptions, {
                analysisWordTimestampStabilizeMode: e.currentTarget
                  .value as UiWhisperxOptions["analysisWordTimestampStabilizeMode"],
              })
            }
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
            placeholder="0.25"
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
            placeholder="4"
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
            placeholder="0.02"
          />
        </label>
      </div>
    </div>
  );
}
