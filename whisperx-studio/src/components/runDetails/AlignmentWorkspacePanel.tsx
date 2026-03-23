import type { MouseEvent, RefObject, WheelEvent } from "react";
import { MAX_WAVEFORM_ZOOM, MIN_WAVEFORM_ZOOM } from "../../constants";
import { formatClockSeconds, parseFiniteNumberInput } from "../../appUtils";
import type { FocusedSegmentInfo, Job, WaveformOverviewEnvelope, WaveformPeaks } from "../../types";
import { wordLabelsLimitedToDenseView } from "../../waveformWxenv";
import { ErrorBanner } from "../ErrorBanner";
import { WaveformOverviewStrip } from "./WaveformOverviewStrip";

export type AlignmentWorkspacePanelProps = {
  selectedJob: Job;
  selectedIsVideo: boolean;
  selectedMediaSrc: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  waveformCanvasRef: RefObject<HTMLCanvasElement | null>;
  waveformBinsPerSecond: string;
  setWaveformBinsPerSecond: (v: string) => void;
  loadWaveformForSelectedJob: () => void;
  isWaveformLoading: boolean;
  requestCancelWaveformGeneration: () => void;
  waveformTaskId: string;
  zoomWaveform: (factor: number) => void;
  resetWaveformZoom: () => void;
  waveform: WaveformPeaks | null;
  waveformZoom: number;
  waveformCursorSec: number | null;
  mediaCurrentSec: number;
  setMediaCurrentSec: (sec: number) => void;
  waveformViewStartSec: number;
  waveformViewEndSec: number;
  waveformMaxViewStartSec: number;
  setWaveformZoomAround: (zoom: number, anchorSec: number, anchorRatio?: number) => void;
  setWaveformViewStart: (sec: number) => void;
  snapEnabled: boolean;
  setSnapEnabled: (v: boolean) => void;
  snapStepMs: "10" | "20" | "40";
  setSnapStepMs: (v: "10" | "20" | "40") => void;
  waveformProgress: number;
  waveformProgressMessage: string;
  waveformError: string;
  waveformCursorStyle: string;
  onWaveformMouseDown: (e: MouseEvent<HTMLCanvasElement>) => void;
  onWaveformMouseMove: (e: MouseEvent<HTMLCanvasElement>) => void;
  onWaveformMouseUp: (e: MouseEvent<HTMLCanvasElement>) => void;
  onWaveformMouseLeave: (e: MouseEvent<HTMLCanvasElement>) => void;
  onWaveformWheel: (e: WheelEvent<HTMLCanvasElement>) => void;
  focusedSegment: FocusedSegmentInfo | null;
  activeSegmentIndex: number | null;
  setActiveSegmentIndex: (n: number | null) => void;
  splitActiveSegmentAtCursor: () => void;
  canSplitActiveSegment: boolean;
  mergeActiveSegment: (dir: "prev" | "next") => void;
  canMergePrev: boolean;
  canMergeNext: boolean;
  seekMedia: (sec: number) => void;
  buildWaveformPyramid: () => void;
  isPyramidBuilding: boolean;
  pyramidError: string;
  overviewEnvelope: WaveformOverviewEnvelope | null;
  isOverviewLoading: boolean;
  visibleDurationSec: number;
  webAudioMode: boolean;
  setWebAudioMode: (v: boolean) => void;
  webAudioError: string;
  toggleMediaPlayback: () => Promise<void>;
};

export function AlignmentWorkspacePanel(props: AlignmentWorkspacePanelProps) {
  const {
    selectedJob,
    selectedIsVideo,
    selectedMediaSrc,
    audioRef,
    videoRef,
    waveformCanvasRef,
    waveformBinsPerSecond,
    setWaveformBinsPerSecond,
    loadWaveformForSelectedJob,
    isWaveformLoading,
    requestCancelWaveformGeneration,
    waveformTaskId,
    zoomWaveform,
    resetWaveformZoom,
    waveform,
    waveformZoom,
    waveformCursorSec,
    mediaCurrentSec,
    setMediaCurrentSec,
    waveformViewStartSec,
    waveformViewEndSec,
    waveformMaxViewStartSec,
    setWaveformZoomAround,
    setWaveformViewStart,
    snapEnabled,
    setSnapEnabled,
    snapStepMs,
    setSnapStepMs,
    waveformProgress,
    waveformProgressMessage,
    waveformError,
    waveformCursorStyle,
    onWaveformMouseDown,
    onWaveformMouseMove,
    onWaveformMouseUp,
    onWaveformMouseLeave,
    onWaveformWheel,
    focusedSegment,
    activeSegmentIndex,
    setActiveSegmentIndex,
    splitActiveSegmentAtCursor,
    canSplitActiveSegment,
    mergeActiveSegment,
    canMergePrev,
    canMergeNext,
    seekMedia,
    buildWaveformPyramid,
    isPyramidBuilding,
    pyramidError,
    overviewEnvelope,
    isOverviewLoading,
    visibleDurationSec,
    webAudioMode,
    setWebAudioMode,
    webAudioError,
    toggleMediaPlayback,
  } = props;

  return (
    <>
      <h3>Alignment Workspace</h3>
      <div className="alignment-panel">
        <div className="alignment-toolbar">
          <label>
            Resolution waveform (bins/s)
            <select
              value={waveformBinsPerSecond}
              onChange={(e) => setWaveformBinsPerSecond(e.currentTarget.value)}
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
            onClick={loadWaveformForSelectedJob}
            disabled={isWaveformLoading}
          >
            {isWaveformLoading ? "Generation waveform..." : "Charger waveform"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void buildWaveformPyramid()}
            disabled={isPyramidBuilding}
            title="Génère les enveloppes WXENV (L0–L4) pour overview + détail multi-résolution"
          >
            {isPyramidBuilding ? "Pyramide WXENV…" : "Pyramide WXENV"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void requestCancelWaveformGeneration()}
            disabled={!isWaveformLoading || !waveformTaskId}
          >
            Annuler waveform
          </button>
          <label>
            Zoom timeline
            <div className="waveform-inline-controls">
              <button
                type="button"
                className="ghost"
                onClick={() => zoomWaveform(1 / 1.25)}
                disabled={!waveform}
              >
                -
              </button>
              <input
                className="waveform-zoom-range"
                type="range"
                min={MIN_WAVEFORM_ZOOM}
                max={MAX_WAVEFORM_ZOOM}
                step="0.1"
                value={waveformZoom}
                onChange={(e) => {
                  const nextZoom = parseFiniteNumberInput(e.currentTarget.value);
                  if (nextZoom !== null) {
                    setWaveformZoomAround(nextZoom, waveformCursorSec ?? mediaCurrentSec, 0.5);
                  }
                }}
                disabled={!waveform}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => zoomWaveform(1.25)}
                disabled={!waveform}
              >
                +
              </button>
              <button
                type="button"
                className="ghost"
                onClick={resetWaveformZoom}
                disabled={!waveform}
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
              max={waveformMaxViewStartSec}
              step="0.02"
              value={Math.min(waveformViewStartSec, waveformMaxViewStartSec)}
              onChange={(e) => {
                const nextStart = parseFiniteNumberInput(e.currentTarget.value);
                if (nextStart !== null) {
                  setWaveformViewStart(nextStart);
                }
              }}
              disabled={!waveform || waveformMaxViewStartSec <= 0}
            />
          </label>
          <label className="checkbox-row waveform-snap-toggle">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(e) => setSnapEnabled(e.currentTarget.checked)}
            />
            Snap
          </label>
          <label>
            Pas snap
            <select
              value={snapStepMs}
              onChange={(e) => setSnapStepMs(e.currentTarget.value as "10" | "20" | "40")}
              disabled={!snapEnabled}
            >
              <option value="10">10 ms</option>
              <option value="20">20 ms</option>
              <option value="40">40 ms</option>
            </select>
          </label>
        </div>
        {isWaveformLoading ? (
          <div>
            <div className="progress-track">
              <div
                className="progress-value"
                style={{ width: `${Math.max(2, waveformProgress)}%` }}
              />
            </div>
            <p className="small">
              Waveform: {waveformProgress}% {waveformProgressMessage}
            </p>
          </div>
        ) : null}
        <p className="small">
          Raccourcis: <code>Alt+J</code>/<code>Alt+L</code> seek +/-1s, <code>Alt+K</code>{" "}
          play/pause, <code>Alt+Shift+J</code>/<code>Alt+Shift+L</code> segment precedent/suivant.
        </p>

        <p className="small mono">{selectedJob.inputPath}</p>
        {!selectedIsVideo ? (
          <label className="checkbox-row web-audio-toggle">
            <input
              type="checkbox"
              checked={webAudioMode}
              onChange={(e) => setWebAudioMode(e.currentTarget.checked)}
            />
            Lecture Web Audio (WX-619) — fenêtre WAV dérivée (ffmpeg), ±10 s autour du playhead
          </label>
        ) : null}
        {webAudioError && !selectedIsVideo ? (
          <ErrorBanner>
            <p className="error-banner-text">{webAudioError}</p>
          </ErrorBanner>
        ) : null}
        {!selectedIsVideo && webAudioMode ? (
          <div className="web-audio-actions">
            <button type="button" className="ghost" onClick={() => void toggleMediaPlayback()}>
              Play / Pause
            </button>
            <span className="small">
              Raccourci <kbd>Alt</kbd>+<kbd>K</kbd> — le lecteur natif est muet ; le son sort via
              Web Audio.
            </span>
          </div>
        ) : null}
        {selectedIsVideo ? (
          <video
            ref={videoRef}
            className="media-player"
            src={selectedMediaSrc}
            controls
            preload="metadata"
            onTimeUpdate={(e) => setMediaCurrentSec(e.currentTarget.currentTime)}
            onSeeked={(e) => setMediaCurrentSec(e.currentTarget.currentTime)}
          />
        ) : (
          <audio
            ref={audioRef}
            className="media-player"
            src={selectedMediaSrc}
            controls={!webAudioMode}
            muted={webAudioMode}
            preload="metadata"
            onTimeUpdate={
              webAudioMode ? undefined : (e) => setMediaCurrentSec(e.currentTarget.currentTime)
            }
            onSeeked={
              webAudioMode ? undefined : (e) => setMediaCurrentSec(e.currentTarget.currentTime)
            }
          />
        )}

        {waveformError ? (
          <ErrorBanner>
            <p className="error-banner-text">{waveformError}</p>
          </ErrorBanner>
        ) : null}
        {pyramidError ? (
          <ErrorBanner>
            <p className="error-banner-text">{pyramidError}</p>
          </ErrorBanner>
        ) : null}
        {!waveform ? (
          <p className="small">Charge le waveform pour activer le seek précis sur la timeline.</p>
        ) : (
          <>
            <WaveformOverviewStrip
              durationSec={waveform.durationSec}
              viewStartSec={waveformViewStartSec}
              viewEndSec={waveformViewEndSec}
              maxViewStartSec={waveformMaxViewStartSec}
              overview={overviewEnvelope}
              isLoading={isOverviewLoading}
              setViewStartSec={setWaveformViewStart}
            />
            <canvas
              ref={waveformCanvasRef}
              className="waveform-canvas"
              style={{ cursor: waveformCursorStyle }}
              onMouseDown={onWaveformMouseDown}
              onMouseMove={onWaveformMouseMove}
              onMouseUp={onWaveformMouseUp}
              onMouseLeave={onWaveformMouseLeave}
              onWheel={onWaveformWheel}
            />
            <p className="small">
              Durée : {formatClockSeconds(waveform.durationSec)} | Lecture :{" "}
              {formatClockSeconds(mediaCurrentSec)} | Curseur :{" "}
              {formatClockSeconds(waveformCursorSec ?? mediaCurrentSec)} | Zoom : ×
              {waveformZoom.toFixed(2)} | Fenêtre : {formatClockSeconds(waveformViewStartSec)}-
              {formatClockSeconds(Math.min(waveformViewEndSec, waveform.durationSec))} | Snap :{" "}
              {snapEnabled ? `${snapStepMs} ms` : "désactivé"} | Cache :{" "}
              {waveform.cached ? "oui" : "non"} | Segments overlay :{" "}
              {visibleDurationSec <= 60 ? "oui (≤60s)" : "non (>60s)"} | Mots timeline :{" "}
              {visibleDurationSec > 60
                ? "masqués (>60s)"
                : wordLabelsLimitedToDenseView(visibleDurationSec)
                  ? "≤30s (limite future)"
                  : "31–60s"}
            </p>
          </>
        )}

        {focusedSegment ? (
          <div className="focus-segment">
            <p className="small">
              Segment {activeSegmentIndex === focusedSegment.index ? "actif" : "proche"} #
              {focusedSegment.index + 1} ({formatClockSeconds(focusedSegment.segment.start)} -{" "}
              {formatClockSeconds(focusedSegment.segment.end)}) | distance:{" "}
              {focusedSegment.distanceSec.toFixed(3)}s
            </p>
            <p className="mono">{focusedSegment.segment.text}</p>
            <div className="file-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setActiveSegmentIndex(focusedSegment.index)}
              >
                Definir segment actif
              </button>
              <button
                type="button"
                className="ghost"
                onClick={splitActiveSegmentAtCursor}
                disabled={!canSplitActiveSegment}
              >
                Split au curseur
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => mergeActiveSegment("prev")}
                disabled={!canMergePrev}
              >
                Fusionner precedent
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => mergeActiveSegment("next")}
                disabled={!canMergeNext}
              >
                Fusionner suivant
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => seekMedia(focusedSegment.segment.start)}
              >
                Aller debut segment
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => seekMedia(focusedSegment.segment.end)}
              >
                Aller fin segment
              </button>
            </div>
          </div>
        ) : (
          <p className="small">
            Pour lier waveform et texte, charge un transcript JSON dans "Transcript Editor".
          </p>
        )}
      </div>
    </>
  );
}
