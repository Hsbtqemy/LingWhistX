import { defaultWhisperxOptions } from "../constants";
import type { NewJobFormApi } from "../hooks/useNewJobForm";

export type StudioAdvancedJobSectionProps = {
  jobForm: NewJobFormApi;
};

/**
 * WX-618 — Actions lourdes explicites (préréglages) + lecture debug options d'analyse.
 * La confirmation finale avant lancement reste sur « Lancer le job » (useNewJobForm).
 */
export function StudioAdvancedJobSection({ jobForm }: StudioAdvancedJobSectionProps) {
  const { whisperxOptions, applyAdvancedPreset, mode } = jobForm;

  const def = defaultWhisperxOptions;
  const nonspeechMin = (whisperxOptions.analysisNonspeechMinDuration ?? "").trim();
  const nonspeechMinDefault = def.analysisNonspeechMinDuration.trim();
  const ipuBridge = (whisperxOptions.analysisIpuBridgeShortGapsUnder ?? "").trim();
  const ipuBridgeDefault = def.analysisIpuBridgeShortGapsUnder.trim();

  const hasDebugOverlayHints =
    whisperxOptions.analysisIncludeNonspeech !== def.analysisIncludeNonspeech ||
    (Boolean(nonspeechMin) && nonspeechMin !== nonspeechMinDefault) ||
    Boolean(whisperxOptions.analysisPauseMax?.trim()) ||
    (Boolean(ipuBridge) && ipuBridge !== ipuBridgeDefault);

  return (
    <details className="advanced-job-panel">
      <summary className="advanced-job-summary">Avancé — préréglages lourds &amp; debug</summary>
      <div className="advanced-job-body">
        <p className="small advanced-job-lead">
          Les réglages d&apos;analyse (pauses, IPU, non-speech) ne lancent <strong>aucun</strong>{" "}
          worker WhisperX. Seul le bouton <strong>Lancer le job</strong> démarre le sidecar Python
          (après confirmation si le mode est lourd).
        </p>
        <p className="small">
          Progression : lignes JSON sur stdout (<code>__WXLOG__</code>), comme documenté dans le
          worker.
        </p>

        <div className="advanced-job-presets">
          <span className="advanced-job-presets-label">
            Préréglages (configure l&apos;étape 2) :
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => applyAdvancedPreset("whisperx_no_diarize")}
          >
            WhisperX sans diarization
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => applyAdvancedPreset("whisperx_diarize")}
          >
            WhisperX + diarization
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => applyAdvancedPreset("analyze_only")}
          >
            Analyze-only
          </button>
        </div>

        {hasDebugOverlayHints || mode === "whisperx" || mode === "analyze_only" ? (
          <div className="advanced-job-debug" aria-label="Options analyse (debug)">
            <h4 className="advanced-job-debug-title">Debug — overlays analyse</h4>
            <ul className="advanced-job-debug-list small">
              <li>
                Non-speech : {whisperxOptions.analysisIncludeNonspeech ? "inclus" : "exclu"}
                {whisperxOptions.analysisNonspeechMinDuration?.trim()
                  ? ` (min ${whisperxOptions.analysisNonspeechMinDuration}s)`
                  : null}
              </li>
              <li>
                Pause max :{" "}
                {whisperxOptions.analysisPauseMax?.trim()
                  ? `${whisperxOptions.analysisPauseMax}s`
                  : "—"}
              </li>
              <li>
                Pont IPU (gaps courts) :{" "}
                {whisperxOptions.analysisIpuBridgeShortGapsUnder?.trim()
                  ? `${whisperxOptions.analysisIpuBridgeShortGapsUnder}s`
                  : "—"}
              </li>
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
