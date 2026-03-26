import { useState, type MouseEvent, type RefObject, type WheelEvent } from "react";
import { runInTransition } from "../../whisperxOptionsTransitions";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { MAX_WAVEFORM_ZOOM, MIN_WAVEFORM_ZOOM } from "../../constants";
import { clampNumber, formatClockSeconds, parseFiniteNumberInput } from "../../appUtils";
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
  /** WX-623 — remplit le champ JSON « Plages pipeline » du formulaire Nouveau job. */
  injectAudioPipelineSegmentsJson?: (json: string) => void;
  previewRangeSec: { start: number; end: number } | null;
  setPreviewRangeSec: (r: { start: number; end: number } | null) => void;
  rangeSelectionMode: boolean;
  setRangeSelectionMode: (v: boolean) => void;
  setPreviewRangeFromVisibleWindow: () => void;
  clearPreviewRange: () => void;
  previewWaveGainDb: number;
  setPreviewWaveGainDb: (v: number) => void;
  previewWaveEqLowDb: number;
  setPreviewWaveEqLowDb: (v: number) => void;
  previewWaveBalance: number;
  setPreviewWaveBalance: (v: number) => void;
  previewWaveBypassEffects: boolean;
  setPreviewWaveBypassEffects: (v: boolean) => void;
  resetPreviewWaveEffects: () => void;
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
    injectAudioPipelineSegmentsJson,
    previewRangeSec,
    setPreviewRangeSec,
    rangeSelectionMode,
    setRangeSelectionMode,
    setPreviewRangeFromVisibleWindow,
    clearPreviewRange,
    previewWaveGainDb,
    setPreviewWaveGainDb,
    previewWaveEqLowDb,
    setPreviewWaveEqLowDb,
    previewWaveBalance,
    setPreviewWaveBalance,
    previewWaveBypassEffects,
    setPreviewWaveBypassEffects,
    resetPreviewWaveEffects,
  } = props;

  const [wx623Hint, setWx623Hint] = useState<string | null>(null);

  function injectPipelineJsonFromRange() {
    if (!previewRangeSec || !injectAudioPipelineSegmentsJson) {
      return;
    }
    const payload = [
      {
        startSec: previewRangeSec.start,
        endSec: previewRangeSec.end,
        audioPipelineModules: { preNormalize: true },
      },
    ];
    injectAudioPipelineSegmentsJson(JSON.stringify(payload, null, 2));
    setWx623Hint(
      "JSON injecté dans « Plages pipeline » (Nouveau job). Ouvre la vue Créer pour l’éditer ou lancer un job.",
    );
  }

  async function exportSnippetWav() {
    if (!previewRangeSec) {
      return;
    }
    setWx623Hint(null);
    const outPath = await save({
      title: "Exporter extrait WAV (WX-623)",
      filters: [{ name: "WAV", extensions: ["wav"] }],
      defaultPath: "snippet.wav",
    });
    if (!outPath) {
      return;
    }
    try {
      await invoke("export_audio_wav_segment", {
        inputPath: selectedJob.inputPath,
        outputPath: outPath,
        startSec: previewRangeSec.start,
        endSec: previewRangeSec.end,
      });
      setWx623Hint(`WAV exporté : ${outPath}`);
    } catch (e) {
      setWx623Hint(`Export WAV : ${String(e)}`);
    }
  }

  return (
    <>
      <h3>Alignment Workspace</h3>
      <div className="alignment-panel">
        <div
          className={`alignment-media-split ${selectedIsVideo ? "alignment-media-split--video" : "alignment-media-split--audio"}`}
        >
          <div className="alignment-media-player-zone">
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
              <>
                <label className="checkbox-row web-audio-toggle">
                  <input
                    type="checkbox"
                    checked={webAudioMode}
                    onChange={(e) =>
                      runInTransition(() => setWebAudioMode(e.currentTarget.checked))
                    }
                  />
                  Lecture Web Audio (WX-619) — fenêtre WAV dérivée (ffmpeg), ±10 s autour du
                  playhead
                </label>
                {webAudioError ? (
                  <ErrorBanner>
                    <p className="error-banner-text">{webAudioError}</p>
                  </ErrorBanner>
                ) : null}
                {webAudioMode ? (
                  <div className="web-audio-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void toggleMediaPlayback()}
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
                  ref={audioRef}
                  className="media-player"
                  src={selectedMediaSrc}
                  controls={!webAudioMode}
                  muted={webAudioMode}
                  preload="metadata"
                  onTimeUpdate={
                    webAudioMode
                      ? undefined
                      : (e) => setMediaCurrentSec(e.currentTarget.currentTime)
                  }
                  onSeeked={
                    webAudioMode
                      ? undefined
                      : (e) => setMediaCurrentSec(e.currentTarget.currentTime)
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
                  value={waveformBinsPerSecond}
                  onChange={(e) =>
                    runInTransition(() => setWaveformBinsPerSecond(e.currentTarget.value))
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
                  onChange={(e) =>
                    runInTransition(() => setSnapEnabled(e.currentTarget.checked))
                  }
                />
                Snap
              </label>
              <label>
                Pas snap
                <select
                  value={snapStepMs}
                  onChange={(e) =>
                    runInTransition(() =>
                      setSnapStepMs(e.currentTarget.value as "10" | "20" | "40"),
                    )
                  }
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
              play/pause, <code>Alt+Shift+J</code>/<code>Alt+Shift+L</code> segment
              precedent/suivant.
            </p>

            <p className="small mono">{selectedJob.inputPath}</p>

            <div className="waveform-range-preview">
              <p className="small">
                <strong>Plage (WX-622)</strong> — lecture Web Audio uniquement sur la fenêtre WAV
                dérivée (ffmpeg) ; le fichier source sur disque n&apos;est pas modifié.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rangeSelectionMode}
                  onChange={(e) =>
                    runInTransition(() => setRangeSelectionMode(e.currentTarget.checked))
                  }
                />
                Mode sélection plage — glisser sur la waveform pour définir [t0, t1]
              </label>
              <div className="file-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={setPreviewRangeFromVisibleWindow}
                  disabled={!waveform}
                  title="Préremplit la plage avec la fenêtre zoomée actuelle"
                >
                  Plage = fenêtre visible
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={clearPreviewRange}
                  disabled={!previewRangeSec}
                >
                  Effacer plage
                </button>
                <button type="button" className="ghost" onClick={resetPreviewWaveEffects}>
                  Réinitialiser effets preview
                </button>
              </div>
              {previewRangeSec ? (
                <p className="small">
                  Plage active : {formatClockSeconds(previewRangeSec.start)} —{" "}
                  {formatClockSeconds(previewRangeSec.end)} ({" "}
                  {(previewRangeSec.end - previewRangeSec.start).toFixed(2)} s)
                </p>
              ) : (
                <p className="small">
                  Aucune plage — la lecture Web Audio utilise le playhead comme avant.
                </p>
              )}
              <div className="waveform-range-inputs">
                <label>
                  Début (s)
                  <input
                    type="number"
                    step={0.01}
                    aria-label="Plage début secondes"
                    value={previewRangeSec?.start ?? ""}
                    min={0}
                    max={waveform ? waveform.durationSec : undefined}
                    onChange={(e) => {
                      const next = parseFiniteNumberInput(e.currentTarget.value);
                      const dur = waveform?.durationSec ?? 0;
                      if (next === null || dur <= 0) {
                        return;
                      }
                      const end = previewRangeSec?.end ?? dur;
                      setPreviewRangeSec({
                        start: clampNumber(next, 0, dur),
                        end: clampNumber(Math.max(end, next + 0.05), 0, dur),
                      });
                    }}
                  />
                </label>
                <label>
                  Fin (s)
                  <input
                    type="number"
                    step={0.01}
                    aria-label="Plage fin secondes"
                    value={previewRangeSec?.end ?? ""}
                    min={0}
                    max={waveform ? waveform.durationSec : undefined}
                    onChange={(e) => {
                      const next = parseFiniteNumberInput(e.currentTarget.value);
                      const dur = waveform?.durationSec ?? 0;
                      if (next === null || dur <= 0) {
                        return;
                      }
                      const start = previewRangeSec?.start ?? 0;
                      setPreviewRangeSec({
                        start: clampNumber(Math.min(start, next - 0.05), 0, dur),
                        end: clampNumber(next, 0, dur),
                      });
                    }}
                  />
                </label>
              </div>
              <div className="waveform-range-wx623">
                <p className="small">
                  <strong>WX-623</strong> — plages pipeline (worker : extraction → modules par plage
                  → concat) ; export WAV mono 16 kHz hors job.
                </p>
                <div className="file-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={injectPipelineJsonFromRange}
                    disabled={!previewRangeSec || !injectAudioPipelineSegmentsJson}
                    title="Exemple : une plage avec preNormalize — modifiable dans Nouveau job"
                  >
                    Injecter plage → JSON pipeline
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void exportSnippetWav()}
                    disabled={!previewRangeSec}
                    title="Extrait [début, fin) du fichier média du job"
                  >
                    Exporter snippet WAV…
                  </button>
                </div>
                {wx623Hint ? <p className="small">{wx623Hint}</p> : null}
              </div>
              <p className="small">Effets preview (Web Audio uniquement, hors bypass) :</p>
              <div className="waveform-preview-effects">
                <label>
                  Gain (dB)
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={previewWaveGainDb}
                    onChange={(e) =>
                      setPreviewWaveGainDb(parseFiniteNumberInput(e.currentTarget.value) ?? 0)
                    }
                  />
                  <span className="small">{previewWaveGainDb.toFixed(1)}</span>
                </label>
                <label>
                  EQ low shelf (dB @ 320 Hz)
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={previewWaveEqLowDb}
                    onChange={(e) =>
                      setPreviewWaveEqLowDb(parseFiniteNumberInput(e.currentTarget.value) ?? 0)
                    }
                  />
                  <span className="small">{previewWaveEqLowDb.toFixed(1)}</span>
                </label>
                <label>
                  Balance
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={previewWaveBalance}
                    onChange={(e) =>
                      setPreviewWaveBalance(parseFiniteNumberInput(e.currentTarget.value) ?? 0)
                    }
                  />
                  <span className="small">{previewWaveBalance.toFixed(2)}</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={previewWaveBypassEffects}
                    onChange={(e) =>
                      runInTransition(() =>
                        setPreviewWaveBypassEffects(e.currentTarget.checked),
                      )
                    }
                  />
                  Bypass effets (chaîne neutre)
                </label>
              </div>
            </div>

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
              <p className="small">
                Charge le waveform pour activer le seek précis sur la timeline.
              </p>
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
        </div>
      </div>
    </>
  );
}
