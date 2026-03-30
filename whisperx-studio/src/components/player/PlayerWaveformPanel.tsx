import type { KeyboardEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { runInTransition } from "../../whisperxOptionsTransitions";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { MAX_WAVEFORM_ZOOM, MIN_WAVEFORM_ZOOM } from "../../constants";
import {
  clampNumber,
  fileBasename,
  formatClockSeconds,
  parseFiniteNumberInput,
} from "../../appUtils";
import type { WaveformWorkspace } from "../../hooks/useWaveformWorkspace";
import {
  secondsFromWaveformPointer,
  type WaveformPointerContext,
} from "../../hooks/transcript/waveformPointer";
import { wordLabelsLimitedToDenseView } from "../../waveformWxenv";
import { ErrorBanner } from "../ErrorBanner";
import { WaveformOverviewStrip } from "../runDetails/WaveformOverviewStrip";

export type PlayerWaveformPanelProps = {
  wf: WaveformWorkspace;
  mediaPath: string;
  pauseCsvPaths: string[];
  isVideo: boolean;
};

/**
 * Ondeforme + overview + outils Studio (zoom, snap, Web Audio, plage WX-622, pauses CSV) pour le Player.
 */
export function PlayerWaveformPanel({ wf, mediaPath, pauseCsvPaths, isVideo }: PlayerWaveformPanelProps) {
  const [wx623Hint, setWx623Hint] = useState<string | null>(null);
  const [selectedPauseCsvPath, setSelectedPauseCsvPath] = useState("");

  useEffect(() => {
    setSelectedPauseCsvPath(pauseCsvPaths[0] ?? "");
  }, [pauseCsvPaths]);

  const loadPause = wf.loadPauseOverlayFromCsvPath;
  const clearPause = wf.clearPauseOverlay;
  const firstPausePath = pauseCsvPaths[0];

  useEffect(() => {
    if (!firstPausePath) {
      clearPause();
      return;
    }
    void loadPause(firstPausePath);
  }, [clearPause, loadPause, firstPausePath]);

  const waveformPointerCtx = useMemo(
    (): WaveformPointerContext => ({
      waveform: wf.waveform,
      waveformVisibleDurationSec: wf.waveformVisibleDurationSec,
      waveformViewStartSec: wf.waveformViewStartSec,
      applySnap: wf.applySnap,
    }),
    [wf.waveform, wf.waveformVisibleDurationSec, wf.waveformViewStartSec, wf.applySnap],
  );

  const waveformCursorStyle =
    wf.rangeDragStartSec !== null ? "col-resize" : ("crosshair" as const);

  const waveformAriaLabel = useMemo(() => {
    const pos = formatClockSeconds(wf.mediaCurrentSec);
    const dur = formatClockSeconds(wf.waveform?.durationSec ?? 0);
    const zoom = wf.waveformZoom.toFixed(2);
    return `Ondeforme audio — position ${pos} / ${dur}, zoom ×${zoom}. Espace : lecture/pause. Flèches : déplacer de 1s (Maj : 5s).`;
  }, [wf.mediaCurrentSec, wf.waveform, wf.waveformZoom]);

  const onWaveformKeyDown = useCallback(
    (event: KeyboardEvent<HTMLCanvasElement>) => {
      const step = event.shiftKey ? 5 : 1;
      switch (event.key) {
        case " ":
          event.preventDefault();
          void wf.toggleMediaPlayback();
          break;
        case "ArrowLeft":
          event.preventDefault();
          wf.seekMedia(Math.max(0, wf.mediaCurrentSec - step));
          break;
        case "ArrowRight": {
          const dur = wf.waveform?.durationSec ?? wf.mediaCurrentSec;
          event.preventDefault();
          wf.seekMedia(Math.min(dur, wf.mediaCurrentSec + step));
          break;
        }
        default:
          break;
      }
    },
    [wf],
  );

  const onWaveformMouseDown = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
      if (seconds === null) {
        return;
      }
      if (wf.rangeSelectionMode) {
        wf.beginRangeDrag(seconds);
        wf.setWaveformCursorSec(seconds);
        return;
      }
      wf.seekMedia(seconds);
    },
    [wf, waveformPointerCtx],
  );

  const onWaveformMouseMove = useCallback(() => undefined, []);
  const onWaveformMouseUp = useCallback(() => undefined, []);
  const onWaveformMouseLeave = useCallback(() => undefined, []);

  async function exportSnippetWav() {
    if (!wf.previewRangeSec) {
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
        inputPath: mediaPath,
        outputPath: outPath,
        startSec: wf.previewRangeSec.start,
        endSec: wf.previewRangeSec.end,
      });
      setWx623Hint(`WAV exporté : ${outPath}`);
    } catch (e) {
      setWx623Hint(`Export WAV : ${String(e)}`);
    }
  }

  return (
    <section className="player-waveform-panel alignment-panel" aria-label="Ondeforme et outils">
      <h4 className="player-panel-title player-waveform-panel__title">Ondeforme</h4>
      <p className="small player-waveform-panel__lead">
        Même outils que l’alignement Studio : zoom (molette + <kbd>Ctrl</kbd>/<kbd>⌘</kbd>), overview,
        snap, lecture Web Audio (audio), plage d’écoute, pauses CSV.
      </p>

      {!isVideo ? (
        <label
          className="checkbox-row web-audio-toggle player-waveform-panel__web-audio"
          title="Lecture via Web Audio API : extrait WAV mono 16 kHz (ffmpeg), fenêtre d’environ ±10 s autour du playhead."
        >
          <input
            type="checkbox"
            checked={wf.webAudioMode}
            onChange={(e) => runInTransition(() => wf.setWebAudioMode(e.target.checked))}
          />
          Lecture Web Audio
        </label>
      ) : null}
      {!isVideo && wf.webAudioError ? (
        <ErrorBanner>
          <p className="error-banner-text">{wf.webAudioError}</p>
        </ErrorBanner>
      ) : null}
      {!isVideo && wf.webAudioMode ? (
        <div className="web-audio-actions">
          <button type="button" className="ghost" onClick={() => void wf.toggleMediaPlayback()}>
            Play / Pause (Web Audio)
          </button>
          <span className="small">Le transport principal reste disponible ; en Web Audio le son sort via la préécoute.</span>
        </div>
      ) : null}

      <div className="alignment-toolbar">
        <label>
          Resolution waveform (bins/s)
          <select
            value={wf.waveformBinsPerSecond}
            onChange={(e) => runInTransition(() => wf.setWaveformBinsPerSecond(e.target.value))}
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
                const nextZoom = parseFiniteNumberInput(e.target.value);
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
              const nextStart = parseFiniteNumberInput(e.target.value);
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
            onChange={(e) => runInTransition(() => wf.setSnapEnabled(e.target.checked))}
          />
          Snap
        </label>
        <label>
          Pas snap
          <select
            value={wf.snapStepMs}
            onChange={(e) =>
              runInTransition(() => wf.setSnapStepMs(e.target.value as "10" | "20" | "40"))
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
        <kbd>Ctrl</kbd> ou <kbd>⌘</kbd> + molette sur la courbe : zoom horizontal. Clic : seek (aligné
        sur le transport).
      </p>
      <p className="small mono">{mediaPath}</p>

      <div className="waveform-range-preview">
        <p className="small">
          <strong>Plage (WX-622)</strong> — lecture Web Audio sur la fenêtre WAV dérivée (ffmpeg).
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={wf.rangeSelectionMode}
            onChange={(e) => runInTransition(() => wf.setRangeSelectionMode(e.target.checked))}
          />
          Mode sélection plage — glisser sur la waveform pour définir [t0, t1]
        </label>
        <div className="file-actions">
          <button
            type="button"
            className="ghost"
            onClick={wf.setPreviewRangeFromVisibleWindow}
            disabled={!wf.waveform}
            title="Préremplit la plage avec la fenêtre zoomée actuelle"
          >
            Plage = fenêtre visible
          </button>
          <button
            type="button"
            className="ghost"
            onClick={wf.clearPreviewRange}
            disabled={!wf.previewRangeSec}
          >
            Effacer plage
          </button>
          <button type="button" className="ghost" onClick={wf.resetPreviewWaveEffects}>
            Réinitialiser effets preview
          </button>
        </div>
        {wf.previewRangeSec ? (
          <p className="small">
            Plage active : {formatClockSeconds(wf.previewRangeSec.start)} —{" "}
            {formatClockSeconds(wf.previewRangeSec.end)} ({" "}
            {(wf.previewRangeSec.end - wf.previewRangeSec.start).toFixed(2)} s)
          </p>
        ) : (
          <p className="small">Aucune plage — la lecture Web Audio suit le playhead.</p>
        )}
        <div className="waveform-range-inputs">
          <label>
            Début (s)
            <input
              type="number"
              step={0.01}
              aria-label="Plage début secondes"
              value={wf.previewRangeSec?.start ?? ""}
              min={0}
              max={wf.waveform ? wf.waveform.durationSec : undefined}
              onChange={(e) => {
                const next = parseFiniteNumberInput(e.target.value);
                const dur = wf.waveform?.durationSec ?? 0;
                if (next === null || dur <= 0) {
                  return;
                }
                const end = wf.previewRangeSec?.end ?? dur;
                wf.setPreviewRangeSec({
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
              value={wf.previewRangeSec?.end ?? ""}
              min={0}
              max={wf.waveform ? wf.waveform.durationSec : undefined}
              onChange={(e) => {
                const next = parseFiniteNumberInput(e.target.value);
                const dur = wf.waveform?.durationSec ?? 0;
                if (next === null || dur <= 0) {
                  return;
                }
                const start = wf.previewRangeSec?.start ?? 0;
                wf.setPreviewRangeSec({
                  start: clampNumber(Math.min(start, next - 0.05), 0, dur),
                  end: clampNumber(next, 0, dur),
                });
              }}
            />
          </label>
        </div>
        <div className="waveform-range-wx623">
          <p className="small">
            <strong>WX-623</strong> — export WAV mono 16 kHz pour la plage sélectionnée.
          </p>
          <div className="file-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void exportSnippetWav()}
              disabled={!wf.previewRangeSec}
              title="Extrait [début, fin) du fichier média du run"
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
              value={wf.previewWaveGainDb}
              onChange={(e) =>
                wf.setPreviewWaveGainDb(parseFiniteNumberInput(e.target.value) ?? 0)
              }
            />
            <span className="small">{wf.previewWaveGainDb.toFixed(1)}</span>
          </label>
          <label>
            EQ low shelf (dB @ 320 Hz)
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={wf.previewWaveEqLowDb}
              onChange={(e) =>
                wf.setPreviewWaveEqLowDb(parseFiniteNumberInput(e.target.value) ?? 0)
              }
            />
            <span className="small">{wf.previewWaveEqLowDb.toFixed(1)}</span>
          </label>
          <label>
            Balance
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={wf.previewWaveBalance}
              onChange={(e) =>
                wf.setPreviewWaveBalance(parseFiniteNumberInput(e.target.value) ?? 0)
              }
            />
            <span className="small">{wf.previewWaveBalance.toFixed(2)}</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={wf.previewWaveBypassEffects}
              onChange={(e) =>
                runInTransition(() => wf.setPreviewWaveBypassEffects(e.target.checked))
              }
            />
            Bypass effets (chaîne neutre)
          </label>
        </div>
      </div>

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

      <div className="alignment-pause-csv">
        <p className="small">
          <strong>Pauses CSV</strong> — bandes violettes (<code>*.pauses.csv</code> du run). Premier
          fichier chargé automatiquement si présent.
        </p>
        {pauseCsvPaths.length === 0 ? (
          <p className="small">Aucun <code>*.pauses.csv</code> dans le manifest du run.</p>
        ) : (
          <div className="alignment-pause-csv__row">
            <label className="alignment-pause-csv__select">
              <span className="small">Fichier</span>
              <select
                value={selectedPauseCsvPath}
                onChange={(e) => setSelectedPauseCsvPath(e.target.value)}
              >
                {pauseCsvPaths.map((p) => (
                  <option key={p} value={p}>
                    {fileBasename(p)}
                  </option>
                ))}
              </select>
            </label>
            <div className="file-actions">
              <button
                type="button"
                className="ghost"
                disabled={!selectedPauseCsvPath}
                onClick={() => void wf.loadPauseOverlayFromCsvPath(selectedPauseCsvPath)}
              >
                Charger
              </button>
              <button type="button" className="ghost" onClick={() => wf.clearPauseOverlay()}>
                Effacer
              </button>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wf.pauseOverlayVisible}
                  onChange={(e) =>
                    runInTransition(() => wf.setPauseOverlayVisible(e.target.checked))
                  }
                />
                Afficher
              </label>
            </div>
          </div>
        )}
        {wf.pauseOverlaySourcePath ? (
          <p className="small mono" title={wf.pauseOverlaySourcePath}>
            Source : {fileBasename(wf.pauseOverlaySourcePath)} ·{" "}
            {wf.pauseOverlayVisible ? "visible" : "masqué"}
          </p>
        ) : null}
        {wf.pauseOverlayLoadError ? (
          <p className="small" role="alert">
            {wf.pauseOverlayLoadError}
          </p>
        ) : null}
      </div>

      {!wf.waveform ? (
        <p className="small">Chargement automatique de l’ondeforme à l’ouverture du run…</p>
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
            style={{ cursor: waveformCursorStyle }}
            role="img"
            aria-label={waveformAriaLabel}
            tabIndex={0}
            onMouseDown={onWaveformMouseDown}
            onMouseMove={onWaveformMouseMove}
            onMouseUp={onWaveformMouseUp}
            onMouseLeave={onWaveformMouseLeave}
            onWheel={wf.onWaveformWheel}
            onKeyDown={onWaveformKeyDown}
          />
          <p className="small">
            Durée : {formatClockSeconds(wf.waveform.durationSec)} | Lecture :{" "}
            {formatClockSeconds(wf.mediaCurrentSec)} | Curseur :{" "}
            {formatClockSeconds(wf.waveformCursorSec ?? wf.mediaCurrentSec)} | Zoom : ×
            {wf.waveformZoom.toFixed(2)} | Fenêtre : {formatClockSeconds(wf.waveformViewStartSec)}-
            {formatClockSeconds(Math.min(wf.waveformViewEndSec, wf.waveform.durationSec))} | Snap :{" "}
            {wf.snapEnabled ? `${wf.snapStepMs} ms` : "désactivé"} | Cache :{" "}
            {wf.waveform.cached ? "oui" : "non"} | Segments overlay :{" "}
            {wf.waveformVisibleDurationSec <= 60 ? "oui (≤60s)" : "non (>60s)"} | Mots timeline :{" "}
            {wf.waveformVisibleDurationSec > 60
              ? "masqués (>60s)"
              : wordLabelsLimitedToDenseView(wf.waveformVisibleDurationSec)
                ? "≤30s (limite future)"
                : "31–60s"}
          </p>
        </>
      )}
    </section>
  );
}
