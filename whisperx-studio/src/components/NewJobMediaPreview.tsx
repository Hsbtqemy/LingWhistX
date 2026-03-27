import type { MouseEvent } from "react";
import { memo, useCallback, useMemo } from "react";
import { runInTransition } from "../whisperxOptionsTransitions";
import { convertFileSrc } from "@tauri-apps/api/core";
import { MAX_WAVEFORM_ZOOM, MIN_WAVEFORM_ZOOM } from "../constants";
import { formatClockSeconds, isVideoFile, parseFiniteNumberInput } from "../appUtils";
import { useWaveformWorkspace } from "../hooks/useWaveformWorkspace";
import { useWaveformCanvas } from "../hooks/useWaveformCanvas";
import type { WaveformPointerContext } from "../hooks/transcript/waveformPointer";
import { secondsFromWaveformPointer } from "../hooks/transcript/waveformPointer";
import { wordLabelsLimitedToDenseView } from "../waveformWxenv";
import { ErrorBanner } from "./ErrorBanner";
import { WaveformOverviewStrip } from "./runDetails/WaveformOverviewStrip";

export type NewJobMediaPreviewProps = {
  inputPath: string;
};

/**
 * Aperçu média + ondeforme (WX-621) sur le formulaire « Nouveau job », avant création du job.
 * `memo` : ne pas re-rendre quand seules les options WhisperX changent (le parent refait un
 * nouvel objet `jobForm` à chaque mise à jour d’état).
 */
function NewJobMediaPreviewComponent({ inputPath }: NewJobMediaPreviewProps) {
  const trimmed = inputPath.trim();
  const previewScopeId = trimmed ? `preview:${trimmed}` : "preview-idle";
  const previewIsVideo = trimmed ? isVideoFile(trimmed) : false;

  const wf = useWaveformWorkspace({
    selectedJob: null,
    selectedJobId: previewScopeId,
    selectedIsVideo: previewIsVideo,
    previewMediaPath: trimmed || null,
  });

  useWaveformCanvas(wf, [], null, null, null);

  const mediaSrc = useMemo(() => (trimmed ? convertFileSrc(trimmed) : ""), [trimmed]);

  const waveformPointerCtx = useMemo(
    (): WaveformPointerContext => ({
      waveform: wf.waveform,
      waveformVisibleDurationSec: wf.waveformVisibleDurationSec,
      waveformViewStartSec: wf.waveformViewStartSec,
      applySnap: wf.applySnap,
    }),
    [wf.waveform, wf.waveformVisibleDurationSec, wf.waveformViewStartSec, wf.applySnap],
  );

  const onWaveformMouseDown = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
      if (seconds !== null) {
        wf.seekMedia(seconds);
      }
    },
    [wf, waveformPointerCtx],
  );

  const onWaveformMouseMove = useCallback(() => undefined, []);
  const onWaveformMouseUp = useCallback(() => undefined, []);
  const onWaveformMouseLeave = useCallback(() => undefined, []);

  if (!trimmed) {
    return null;
  }

  return (
    <section className="new-job-media-preview alignment-panel">
      <h3 className="new-job-media-preview-title">Aperçu média</h3>
      <div className="new-job-media-preview-inner">
        <div
          className={`alignment-media-split ${previewIsVideo ? "alignment-media-split--video" : "alignment-media-split--audio"}`}
        >
          <div className="alignment-media-player-zone">
            {previewIsVideo ? (
              <video
                ref={wf.videoRef}
                className="media-player"
                src={mediaSrc}
                controls
                preload="metadata"
                onTimeUpdate={(e) => wf.setMediaCurrentSec(e.currentTarget.currentTime)}
                onSeeked={(e) => wf.setMediaCurrentSec(e.currentTarget.currentTime)}
              />
            ) : (
              <>
                <label
                  className="checkbox-row web-audio-toggle"
                  title="Lecture via Web Audio API : extrait WAV mono 16 kHz (ffmpeg), fenêtre d’environ ±10 s autour du playhead (WX-619)."
                >
                  <input
                    type="checkbox"
                    checked={wf.webAudioMode}
                    onChange={(e) =>
                      runInTransition(() => wf.setWebAudioMode(e.currentTarget.checked))
                    }
                  />
                  Lecture Web Audio
                </label>
                {wf.webAudioError ? (
                  <ErrorBanner>
                    <p className="error-banner-text">{wf.webAudioError}</p>
                  </ErrorBanner>
                ) : null}
                {wf.webAudioMode ? (
                  <div className="web-audio-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void wf.toggleMediaPlayback()}
                    >
                      Play / Pause
                    </button>
                    <span className="small">
                      Raccourci <kbd>Alt</kbd>+<kbd>K</kbd> — le lecteur natif est muet ; le son
                      sort via Web Audio.
                    </span>
                  </div>
                ) : null}
                <audio
                  ref={wf.audioRef}
                  className="media-player"
                  src={mediaSrc}
                  controls={!wf.webAudioMode}
                  muted={wf.webAudioMode}
                  preload="metadata"
                  onTimeUpdate={
                    wf.webAudioMode
                      ? undefined
                      : (e) => wf.setMediaCurrentSec(e.currentTarget.currentTime)
                  }
                  onSeeked={
                    wf.webAudioMode
                      ? undefined
                      : (e) => wf.setMediaCurrentSec(e.currentTarget.currentTime)
                  }
                />
              </>
            )}
          </div>
          <div className="alignment-media-waveform-zone">
            <div className="alignment-toolbar">
              <label>
                Resolution waveform (bins/s)
                <select
                  value={wf.waveformBinsPerSecond}
                  onChange={(e) =>
                    runInTransition(() => wf.setWaveformBinsPerSecond(e.currentTarget.value))
                  }
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="150">150</option>
                </select>
              </label>
              <button
                type="button"
                className="ghost"
                onClick={wf.loadWaveformForSelectedJob}
                disabled={wf.isWaveformLoading}
              >
                {wf.isWaveformLoading ? "Génération de l'ondeforme…" : "Charger l'ondeforme"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void wf.buildWaveformPyramid()}
                disabled={wf.isPyramidBuilding}
                title="Génère les enveloppes WXENV (L0–L4) pour overview + détail multi-résolution"
              >
                {wf.isPyramidBuilding ? "Pyramide WXENV…" : "Pyramide WXENV"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void wf.requestCancelWaveformGeneration()}
                disabled={!wf.isWaveformLoading || !wf.waveformTaskId}
              >
                Annuler
              </button>
              <label>
                Zoom timeline
                <div className="waveform-inline-controls">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => wf.zoomWaveform(1 / 1.25)}
                    disabled={!wf.waveform}
                  >
                    -
                  </button>
                  <input
                    className="waveform-zoom-range"
                    type="range"
                    min={MIN_WAVEFORM_ZOOM}
                    max={MAX_WAVEFORM_ZOOM}
                    step="0.1"
                    value={wf.waveformZoom}
                    onChange={(e) => {
                      const nextZoom = parseFiniteNumberInput(e.currentTarget.value);
                      if (nextZoom !== null) {
                        wf.setWaveformZoomAround(
                          nextZoom,
                          wf.waveformCursorSec ?? wf.mediaCurrentSec,
                          0.5,
                        );
                      }
                    }}
                    disabled={!wf.waveform}
                  />
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => wf.zoomWaveform(1.25)}
                    disabled={!wf.waveform}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={wf.resetWaveformZoom}
                    disabled={!wf.waveform}
                  >
                    x1
                  </button>
                </div>
              </label>
              <label>
                Position fenetre
                <input
                  type="range"
                  min={0}
                  max={wf.waveformMaxViewStartSec}
                  step="0.02"
                  value={Math.min(wf.waveformViewStartSec, wf.waveformMaxViewStartSec)}
                  onChange={(e) => {
                    const nextStart = parseFiniteNumberInput(e.currentTarget.value);
                    if (nextStart !== null) {
                      wf.setWaveformViewStart(nextStart);
                    }
                  }}
                  disabled={!wf.waveform || wf.waveformMaxViewStartSec <= 0}
                />
              </label>
              <label className="checkbox-row waveform-snap-toggle">
                <input
                  type="checkbox"
                  checked={wf.snapEnabled}
                  onChange={(e) =>
                    runInTransition(() => wf.setSnapEnabled(e.currentTarget.checked))
                  }
                />
                Snap
              </label>
              <label>
                Pas snap
                <select
                  value={wf.snapStepMs}
                  onChange={(e) =>
                    runInTransition(() =>
                      wf.setSnapStepMs(e.currentTarget.value as "10" | "20" | "40"),
                    )
                  }
                  disabled={!wf.snapEnabled}
                >
                  <option value="10">10 ms</option>
                  <option value="20">20 ms</option>
                  <option value="40">40 ms</option>
                </select>
              </label>
            </div>
            {wf.isWaveformLoading ? (
              <div>
                <div className="progress-track progress-track--active">
                  <div
                    className="progress-value progress-value--active"
                    style={{ width: `${Math.max(2, wf.waveformProgress)}%` }}
                  />
                </div>
                <p className="small job-card__progress-line">
                  <span
                    className="lx-spinner lx-spinner--sm"
                    role="status"
                    aria-label="Génération de l’ondeforme en cours"
                  />
                  <span>
                    Ondeforme : {wf.waveformProgress}% — {wf.waveformProgressMessage}
                  </span>
                </p>
              </div>
            ) : null}
            <p className="small">
              Raccourcis: <code>Alt+J</code>/<code>Alt+L</code> seek +/-1s, <code>Alt+K</code>{" "}
              play/pause (workspace avec transcript: segments aussi).
            </p>
            <p className="small mono">{trimmed}</p>

            {wf.waveformError ? (
              <ErrorBanner>
                <p className="error-banner-text">{wf.waveformError}</p>
              </ErrorBanner>
            ) : null}
            {wf.pyramidError ? (
              <ErrorBanner>
                <p className="error-banner-text">{wf.pyramidError}</p>
              </ErrorBanner>
            ) : null}
            {!wf.waveform ? (
              <p className="small">
                Charge l&apos;ondeforme pour activer le seek précis sur la timeline.
              </p>
            ) : (
              <>
                <WaveformOverviewStrip
                  durationSec={wf.waveform.durationSec}
                  viewStartSec={wf.waveformViewStartSec}
                  viewEndSec={wf.waveformViewEndSec}
                  maxViewStartSec={wf.waveformMaxViewStartSec}
                  overview={wf.overviewEnvelope}
                  isLoading={wf.isOverviewLoading}
                  setViewStartSec={wf.setWaveformViewStart}
                />
                <canvas
                  ref={wf.waveformCanvasRef}
                  className="waveform-canvas"
                  style={{ cursor: "crosshair" }}
                  onMouseDown={onWaveformMouseDown}
                  onMouseMove={onWaveformMouseMove}
                  onMouseUp={onWaveformMouseUp}
                  onMouseLeave={onWaveformMouseLeave}
                  onWheel={wf.onWaveformWheel}
                />
                <p className="small">
                  Durée : {formatClockSeconds(wf.waveform.durationSec)} | Lecture :{" "}
                  {formatClockSeconds(wf.mediaCurrentSec)} | Curseur :{" "}
                  {formatClockSeconds(wf.waveformCursorSec ?? wf.mediaCurrentSec)} | Zoom : ×
                  {wf.waveformZoom.toFixed(2)} | Fenêtre :{" "}
                  {formatClockSeconds(wf.waveformViewStartSec)}-
                  {formatClockSeconds(Math.min(wf.waveformViewEndSec, wf.waveform.durationSec))} |
                  Snap : {wf.snapEnabled ? `${wf.snapStepMs} ms` : "désactivé"} | Cache :{" "}
                  {wf.waveform.cached ? "oui" : "non"} | Segments overlay :{" "}
                  {wf.waveformVisibleDurationSec <= 60 ? "oui (≤60s)" : "non (>60s)"} | Mots
                  timeline :{" "}
                  {wf.waveformVisibleDurationSec > 60
                    ? "masqués (>60s)"
                    : wordLabelsLimitedToDenseView(wf.waveformVisibleDurationSec)
                      ? "≤30s (limite future)"
                      : "31–60s"}
                </p>
              </>
            )}
            <p className="small">
              Clic sur la waveform : seek sur le même temps que le lecteur (pas de transcript sur
              cet écran).
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export const NewJobMediaPreview = memo(NewJobMediaPreviewComponent);
