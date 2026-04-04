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
import type { WaveformOverlayData } from "../../types";
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
  /** Mode compact — canvas réduit, contrôles détaillés masqués. */
  compact?: boolean;
  onToggleCompact?: () => void;
  /** WX-726/727 — données événements pour marqueurs, lanes et sélection d'analyse. */
  waveformOverlay?: WaveformOverlayData | null;
};

/**
 * Ondeforme + overview + outils Studio (zoom, snap, Web Audio, plage WX-622, pauses CSV) pour le Player.
 */
export function PlayerWaveformPanel({
  wf,
  mediaPath,
  pauseCsvPaths,
  isVideo,
  compact,
  onToggleCompact,
  waveformOverlay,
}: PlayerWaveformPanelProps) {
  const [wx623Hint, setWx623Hint] = useState<string | null>(null);
  const [selectedPauseCsvPath, setSelectedPauseCsvPath] = useState("");
  // WX-726 — tooltip marqueur survolé
  const [markerTooltip, setMarkerTooltip] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);

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
    wf.rangeDragStartSec !== null || wf.analysisSelDragStart !== null ? "col-resize" : "crosshair";

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
      if (seconds === null) return;
      if (wf.analysisSelectionMode) {
        wf.beginAnalysisDrag(seconds);
        wf.setWaveformCursorSec(seconds);
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

  const onWaveformDblClick = useCallback(() => {
    if (wf.analysisSelectionMode) {
      wf.clearAnalysisSelection();
    }
  }, [wf]);

  // WX-726 — détection de survol des marqueurs pour le tooltip
  const onWaveformMouseMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      if (!waveformOverlay || !wf.waveform) {
        setMarkerTooltip((prev) => (prev !== null ? null : prev));
        return;
      }
      const seconds = secondsFromWaveformPointer(waveformPointerCtx, event);
      if (seconds === null) {
        setMarkerTooltip((prev) => (prev !== null ? null : prev));
        return;
      }
      const ms = seconds * 1000;
      const { pauses, turns, words, longPauseMs } = waveformOverlay;

      // Tolérance en secondes selon le zoom
      const tolSec = Math.max(0.1, wf.waveformVisibleDurationSec * 0.005);
      const tolMs = tolSec * 1000;

      // Long pause proche ?
      if (wf.markerToggles.longPauses) {
        const pause = pauses.find(
          (p) =>
            p.durMs >= longPauseMs &&
            Math.abs(p.startMs - ms) < tolMs * 3,
        );
        if (pause) {
          const speaker = pause.speaker ? ` (${pause.speaker})` : "";
          setMarkerTooltip({
            label: `Pause ${(pause.durMs / 1000).toFixed(2)} s${speaker}`,
            x: event.nativeEvent.offsetX,
            y: event.nativeEvent.offsetY,
          });
          return;
        }
      }

      // Chevauchement au curseur ?
      if (wf.markerToggles.overlaps) {
        const sorted = [...turns].sort((a, b) => a.startMs - b.startMs);
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i];
          for (let j = i + 1; j < sorted.length; j++) {
            const b = sorted[j];
            if (b.startMs >= a.endMs) break;
            if (a.speaker === b.speaker) continue;
            const olStart = Math.max(a.startMs, b.startMs);
            const olEnd = Math.min(a.endMs, b.endMs);
            if (ms >= olStart - tolMs && ms <= olEnd + tolMs) {
              setMarkerTooltip({
                label: `Chevauch. ${a.speaker}/${b.speaker} — ${((olEnd - olStart) / 1000).toFixed(2)} s`,
                x: event.nativeEvent.offsetX,
                y: event.nativeEvent.offsetY,
              });
              return;
            }
          }
        }
      }

      // Mot à faible confiance proche ?
      if (wf.markerToggles.lowConfWords) {
        const word = words.find(
          (w) =>
            (w.confidence ?? 1) < 0.65 &&
            Math.abs((w.startMs + w.endMs) / 2 - ms) < tolMs * 2,
        );
        if (word) {
          setMarkerTooltip({
            label: `"${word.token ?? "?"}" — conf. ${((word.confidence ?? 0) * 100).toFixed(0)}%`,
            x: event.nativeEvent.offsetX,
            y: event.nativeEvent.offsetY,
          });
          return;
        }
      }

      setMarkerTooltip((prev) => (prev !== null ? null : prev));
    },
    [waveformOverlay, waveformPointerCtx, wf],
  );

  const onWaveformMouseUp = useCallback(() => undefined, []);

  const onWaveformMouseLeave = useCallback(() => {
    setMarkerTooltip(null);
  }, []);

  // WX-727 — stats scopées pour la sélection active
  const scopedStats = useMemo(() => {
    const sel = wf.analysisSelection;
    if (!sel || !waveformOverlay) return null;
    const selStartMs = sel.start * 1000;
    const selEndMs = sel.end * 1000;
    const durMs = selEndMs - selStartMs;
    if (durMs <= 0) return null;

    const turns = waveformOverlay.turns.filter(
      (t) => t.endMs > selStartMs && t.startMs < selEndMs,
    );
    const pauses = waveformOverlay.pauses.filter(
      (p) => p.endMs > selStartMs && p.startMs < selEndMs,
    );
    const words = waveformOverlay.words.filter(
      (w) => w.endMs > selStartMs && w.startMs < selEndMs,
    );

    const speechMs = turns.reduce((sum, t) => {
      const ol = Math.max(0, Math.min(t.endMs, selEndMs) - Math.max(t.startMs, selStartMs));
      return sum + ol;
    }, 0);

    const speakers = [...new Set(turns.map((t) => t.speaker))];

    return {
      durSec: durMs / 1000,
      nTurns: turns.length,
      nPauses: pauses.length,
      nWords: words.length,
      speechRatio: speechMs / durMs,
      speakers,
    };
  }, [wf.analysisSelection, waveformOverlay]);

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
    <section
      className={`player-waveform-panel alignment-panel${compact ? " player-waveform-panel--compact" : ""}`}
      aria-label="Ondeforme et outils"
    >
      <div className="player-waveform-panel__header">
        <h4 className="player-panel-title player-waveform-panel__title">Ondeforme</h4>
        {/* WX-726 — Marqueurs rapides (compact) */}
        {waveformOverlay ? (
          <div className="player-waveform-marker-toggles">
            {(
              [
                { key: "longPauses", icon: "⏸", title: "Pauses longues" },
                { key: "overlaps", icon: "⇔", title: "Chevauchements" },
                { key: "speakerChanges", icon: "↕", title: "Changements de locuteur" },
                { key: "lowConfWords", icon: "⚠", title: "Mots à faible confiance" },
              ] as const
            ).map(({ key, icon, title }) => (
              <button
                key={key}
                type="button"
                className={`ghost small player-waveform-marker-btn${wf.markerToggles[key] ? " is-active" : ""}`}
                title={title}
                onClick={() => wf.setMarkerToggles({ ...wf.markerToggles, [key]: !wf.markerToggles[key] })}
              >
                {icon}
              </button>
            ))}
            <span className="player-waveform-marker-sep" aria-hidden />
            {/* WX-727 — Mode sélection analyse */}
            <button
              type="button"
              className={`ghost small player-waveform-marker-btn${wf.analysisSelectionMode ? " is-active" : ""}`}
              title={wf.analysisSelectionMode ? "Sélection analyse active — double-clic pour effacer" : "Activer la sélection de région"}
              onClick={() => {
                wf.setAnalysisSelectionMode(!wf.analysisSelectionMode);
                if (wf.analysisSelectionMode) wf.clearAnalysisSelection();
              }}
            >
              ▣
            </button>
          </div>
        ) : null}
        {onToggleCompact ? (
          <button
            type="button"
            className="ghost small player-waveform-compact-toggle"
            onClick={onToggleCompact}
            title={compact ? "Étendre l’ondeforme" : "Réduire l’ondeforme"}
          >
            {compact ? "↕ Étendre" : "↕ Réduire"}
          </button>
        ) : null}
      </div>
      {!compact ? (
        <p className="small player-waveform-panel__lead">
          Même outils que l’alignement Studio : zoom (molette + <kbd>Ctrl</kbd>/<kbd>⌘</kbd>),
          overview, snap, lecture Web Audio (audio), plage d’écoute, pauses CSV.
        </p>
      ) : null}

      {!compact && !isVideo ? (
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
      {!compact && !isVideo && wf.webAudioError ? (
        <ErrorBanner>
          <p className="error-banner-text">{wf.webAudioError}</p>
        </ErrorBanner>
      ) : null}
      {!compact && !isVideo && wf.webAudioMode ? (
        <div className="web-audio-actions">
          <button type="button" className="ghost" onClick={() => void wf.toggleMediaPlayback()}>
            Play / Pause (Web Audio)
          </button>
          <span className="small">
            Le transport principal reste disponible ; en Web Audio le son sort via la préécoute.
          </span>
        </div>
      ) : null}

      {!compact ? (
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
      ) : null}

      {!compact && wf.isWaveformLoading ? (
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

      {!compact ? (
        <>
          <p className="small">
            <kbd>Ctrl</kbd> ou <kbd>⌘</kbd> + molette sur la courbe : zoom horizontal. Clic : seek
            (aligné sur le transport).
          </p>
          <p className="small mono">{mediaPath}</p>
        </>
      ) : null}

      {!compact ? (
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
      ) : null}

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

      {!compact ? (
        <div className="alignment-pause-csv">
          <p className="small">
            <strong>Pauses CSV</strong> — bandes violettes (<code>*.pauses.csv</code> du run).
            Premier fichier chargé automatiquement si présent.
          </p>
          {pauseCsvPaths.length === 0 ? (
            <p className="small">
              Aucun <code>*.pauses.csv</code> dans le manifest du run.
            </p>
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
      ) : null}

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
          {/* WX-726 — lanes toggles (mode étendu) */}
          {!compact && waveformOverlay ? (
            <div className="player-waveform-lane-toggles small">
              <span className="player-waveform-lane-toggles-label">Lanes :</span>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wf.laneToggles.density}
                  onChange={(e) => wf.setLaneToggles({ ...wf.laneToggles, density: e.target.checked })}
                />
                Densité
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wf.laneToggles.speechRate}
                  onChange={(e) => wf.setLaneToggles({ ...wf.laneToggles, speechRate: e.target.checked })}
                />
                Débit
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={wf.laneToggles.confidence}
                  onChange={(e) => wf.setLaneToggles({ ...wf.laneToggles, confidence: e.target.checked })}
                />
                Confiance
              </label>
            </div>
          ) : null}
          <div className="player-waveform-canvas-wrap">
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
              onDoubleClick={onWaveformDblClick}
              onWheel={wf.onWaveformWheel}
              onKeyDown={onWaveformKeyDown}
            />
            {/* WX-726 — Tooltip marqueur */}
            {markerTooltip ? (
              <div
                className="player-waveform-tooltip small"
                style={{ left: markerTooltip.x + 12, top: markerTooltip.y - 8 }}
                aria-live="polite"
              >
                {markerTooltip.label}
              </div>
            ) : null}
          </div>
          {/* WX-727 — Panneau stats scopées */}
          {scopedStats && wf.analysisSelection ? (
            <div className="player-waveform-analysis-stats small">
              <span className="player-waveform-analysis-stats-title">
                Sélection {formatClockSeconds(wf.analysisSelection.start)}–
                {formatClockSeconds(wf.analysisSelection.end)} (
                {formatClockSeconds(scopedStats.durSec)})
              </span>
              <span>{scopedStats.nTurns} tours</span>
              <span>{scopedStats.nPauses} pauses</span>
              <span>{(scopedStats.speechRatio * 100).toFixed(0)}% parole</span>
              {scopedStats.nWords > 0 ? <span>{scopedStats.nWords} mots</span> : null}
              {scopedStats.speakers.length > 0 ? (
                <span>{scopedStats.speakers.join(", ")}</span>
              ) : null}
              <button
                type="button"
                className="ghost small"
                onClick={wf.clearAnalysisSelection}
                title="Effacer la sélection"
              >
                ✕
              </button>
            </div>
          ) : null}
          {!compact ? (
            <p className="small">
              Durée : {formatClockSeconds(wf.waveform.durationSec)} | Lecture :{" "}
              {formatClockSeconds(wf.mediaCurrentSec)} | Curseur :{" "}
              {formatClockSeconds(wf.waveformCursorSec ?? wf.mediaCurrentSec)} | Zoom : ×
              {wf.waveformZoom.toFixed(2)} | Fenêtre : {formatClockSeconds(wf.waveformViewStartSec)}
              -{formatClockSeconds(Math.min(wf.waveformViewEndSec, wf.waveform.durationSec))} | Snap
              : {wf.snapEnabled ? `${wf.snapStepMs} ms` : "désactivé"} | Cache :{" "}
              {wf.waveform.cached ? "oui" : "non"} | Segments overlay :{" "}
              {wf.waveformVisibleDurationSec <= 60 ? "oui (≤60s)" : "non (>60s)"} | Mots timeline :{" "}
              {wf.waveformVisibleDurationSec > 60
                ? "masqués (>60s)"
                : wordLabelsLimitedToDenseView(wf.waveformVisibleDurationSec)
                  ? "≤30s (limite future)"
                  : "31–60s"}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
