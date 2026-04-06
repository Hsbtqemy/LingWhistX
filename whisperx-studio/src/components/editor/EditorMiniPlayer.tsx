import { useCallback, type KeyboardEvent, type WheelEvent } from "react";
import type React from "react";
import type { UsePlayerPlaybackResult } from "../../hooks/usePlayerPlayback";
import type { DrawRange } from "../../hooks/transcript/useTranscriptWaveformInteraction";
import type { SegmentEdge } from "../../types";
import type { WaveformWorkspace } from "../../hooks/useWaveformWorkspace";

type DivMouseHandler = React.MouseEventHandler<HTMLDivElement>;

export type EditorMiniPlayerProps = {
  playback: UsePlayerPlaybackResult;
  wf: WaveformWorkspace;
  onWaveformMouseDown: DivMouseHandler;
  onWaveformMouseMove: DivMouseHandler;
  onWaveformMouseUp: DivMouseHandler;
  onWaveformMouseLeave: DivMouseHandler;
  drawRange?: DrawRange | null;
  hoveredSegmentEdge?: SegmentEdge | null;
  onCommitDrawRange?: () => void;
  onClearDrawRange?: () => void;
  onZoomToSegment?: () => void;
  onResetZoom?: () => void;
  onPlaySegment?: () => void;
};

/**
 * Vidéo / audio + waveform uniquement. Le transport (lecture, vitesse, boucle A–B)
 * est dans le panneau bas (`EditorToolbar`) ; Fichier / sauvegarde au-dessus de la waveform.
 */
export function EditorMiniPlayer({
  playback,
  wf,
  onWaveformMouseDown,
  onWaveformMouseMove,
  onWaveformMouseUp,
  onWaveformMouseLeave,
  drawRange,
  hoveredSegmentEdge,
  onCommitDrawRange,
  onClearDrawRange,
  onZoomToSegment,
  onResetZoom,
  onPlaySegment,
}: EditorMiniPlayerProps) {
  const { mediaSrc, mediaRef, mediaHandlers, isVideo, togglePlayPause, seekRelative } = playback;

  const onWaveformKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Enter" && drawRange && onCommitDrawRange) {
        e.preventDefault();
        onCommitDrawRange();
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        if (drawRange && onClearDrawRange) {
          onClearDrawRange();
        } else if (onResetZoom) {
          onResetZoom();
        }
        return;
      }
      if (e.code === "Space" || e.code === "KeyK") {
        e.preventDefault();
        void togglePlayPause();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
        seekRelative(-step);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
        seekRelative(step);
        return;
      }
      if (e.code === "KeyZ" && !e.ctrlKey && !e.metaKey && onZoomToSegment) {
        e.preventDefault();
        onZoomToSegment();
        return;
      }
      if (e.code === "KeyD" && !e.ctrlKey && !e.metaKey && onPlaySegment) {
        e.preventDefault();
        onPlaySegment();
        return;
      }
    },
    [
      drawRange,
      onCommitDrawRange,
      onClearDrawRange,
      onResetZoom,
      onZoomToSegment,
      onPlaySegment,
      togglePlayPause,
      seekRelative,
    ],
  );

  const onEditorWaveformWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!wf.waveform || wf.waveform.durationSec <= 0) return;
      event.preventDefault();

      // Shift + wheel = scroll horizontal
      if (event.shiftKey) {
        const scrollAmount = (event.deltaY > 0 ? 1 : -1) * wf.waveformVisibleDurationSec * 0.15;
        wf.setWaveformViewStartSec((prev: number) => {
          const total = wf.waveform!.durationSec;
          const maxStart = Math.max(0, total - wf.waveformVisibleDurationSec);
          return Math.max(0, Math.min(maxStart, prev + scrollAmount));
        });
        return;
      }

      // Wheel = zoom ancré à la position du pointeur
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      const clampedRatio = Math.min(1, Math.max(0, ratio));
      const anchorSec = wf.waveformViewStartSec + clampedRatio * wf.waveformVisibleDurationSec;
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      wf.setWaveformZoomAround(wf.waveformZoom * factor, anchorSec, clampedRatio);
    },
    [wf],
  );

  return (
    <div className="editor-mini-player">
      {isVideo ? (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={mediaSrc ?? undefined}
          className="editor-mini-player__video"
          {...mediaHandlers}
        />
      ) : (
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          src={mediaSrc ?? undefined}
          {...mediaHandlers}
        />
      )}

      <div
        className="editor-mini-player__waveform"
        tabIndex={0}
        onKeyDown={onWaveformKeyDown}
        onMouseDown={onWaveformMouseDown}
        onMouseMove={onWaveformMouseMove}
        onMouseUp={onWaveformMouseUp}
        onMouseLeave={onWaveformMouseLeave}
        onWheel={onEditorWaveformWheel}
        onDoubleClick={onPlaySegment as unknown as React.MouseEventHandler<HTMLDivElement>}
      >
        <canvas
          ref={wf.waveformCanvasRef}
          className="editor-mini-player__canvas"
          style={{
            cursor: hoveredSegmentEdge ? "col-resize" : "crosshair",
            display: "block",
            width: "100%",
            height: "100%",
          }}
        />
        {wf.isWaveformLoading && (
          <span className="editor-mini-player__waveform-hint small">
            Génération waveform… {wf.waveformProgress > 0 ? `${wf.waveformProgress}%` : ""}
          </span>
        )}
        {wf.waveformError && (
          <span className="editor-mini-player__waveform-hint editor-mini-player__waveform-hint--error small">
            {wf.waveformError}
          </span>
        )}
        {drawRange && drawRange.endSec > drawRange.startSec && (
          <div className="editor-mini-player__draw-range-hint small">
            {drawRange.startSec.toFixed(2)}s → {drawRange.endSec.toFixed(2)}s{" · "}
            <kbd>Entrée</kbd> créer · <kbd>Échap</kbd> annuler
          </div>
        )}
        {!drawRange && !wf.isWaveformLoading && !wf.waveformError && wf.waveform && (
          <span className="editor-mini-player__waveform-idle-hint small">
            Glisser pour sélectionner · Clic pour positionner
          </span>
        )}
      </div>

      {(playback.mediaLoadError || playback.manifestError) && (
        <p className="editor-mini-player__media-error small">
          {playback.mediaLoadError || playback.manifestError}
        </p>
      )}
    </div>
  );
}
