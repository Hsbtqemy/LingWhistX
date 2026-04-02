import type React from "react";
import type { UsePlayerPlaybackResult } from "../../hooks/usePlayerPlayback";
import type { WaveformWorkspace } from "../../hooks/useWaveformWorkspace";
import { formatClockSeconds } from "../../appUtils";

// Les handlers waveform sont typés HTMLCanvasElement en interne — on restreint au niveau du wrapper div.
type DivMouseHandler = React.MouseEventHandler<HTMLDivElement>;

export type EditorMiniPlayerProps = {
  playback: UsePlayerPlaybackResult;
  wf: WaveformWorkspace;
  onWaveformMouseDown: DivMouseHandler;
  onWaveformMouseMove: DivMouseHandler;
  onWaveformMouseUp: DivMouseHandler;
  onWaveformMouseLeave: DivMouseHandler;
};

export function EditorMiniPlayer({
  playback,
  wf,
  onWaveformMouseDown,
  onWaveformMouseMove,
  onWaveformMouseUp,
  onWaveformMouseLeave,
}: EditorMiniPlayerProps) {
  const { mediaSrc, mediaRef, mediaHandlers, isVideo } = playback;

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
        onMouseDown={onWaveformMouseDown}
        onMouseMove={onWaveformMouseMove}
        onMouseUp={onWaveformMouseUp}
        onMouseLeave={onWaveformMouseLeave}
        onWheel={wf.onWaveformWheel as unknown as React.WheelEventHandler<HTMLDivElement>}
      >
        <canvas
          ref={wf.waveformCanvasRef}
          className="editor-mini-player__canvas"
          style={{ cursor: "crosshair", display: "block", width: "100%", height: "100%" }}
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
      </div>

      <div className="editor-mini-player__transport">
        <span className="editor-mini-player__time mono small">
          {formatClockSeconds(playback.currentTimeSec)} /{" "}
          {formatClockSeconds(playback.durationSec ?? 0)}
        </span>

        <div className="editor-mini-player__transport-btns">
          <button
            type="button"
            className="ghost small"
            onClick={() => playback.seekRelative(-5)}
            title="Reculer 5 s"
            aria-label="Reculer 5 secondes"
          >
            ◀◀
          </button>
          <button
            type="button"
            className="ghost small editor-mini-player__play-btn"
            onClick={playback.togglePlayPause}
            title={playback.playing ? "Pause" : "Lecture"}
            aria-label={playback.playing ? "Pause" : "Lecture"}
          >
            {playback.playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={() => playback.seekRelative(5)}
            title="Avancer 5 s"
            aria-label="Avancer 5 secondes"
          >
            ▶▶
          </button>
        </div>

        <div className="editor-mini-player__transport-aux">
          <button
            type="button"
            className="ghost small"
            onClick={() => playback.nudgePlaybackRate(-0.25)}
            title="Ralentir (−0,25×)"
            aria-label="Ralentir"
          >
            −
          </button>
          <span className="editor-mini-player__speed mono small" title="Vitesse de lecture">
            {playback.playbackRate.toFixed(2)}×
          </span>
          <button
            type="button"
            className="ghost small"
            onClick={() => playback.nudgePlaybackRate(0.25)}
            title="Accélérer (+0,25×)"
            aria-label="Accélérer"
          >
            +
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={playback.toggleMute}
            title={playback.muted ? "Rétablir le son" : "Couper le son"}
            aria-label={playback.muted ? "Rétablir le son" : "Couper le son"}
          >
            {playback.muted ? "🔇" : "🔊"}
          </button>
        </div>

        {(playback.mediaLoadError || playback.manifestError) && (
          <p className="editor-mini-player__media-error small">
            {playback.mediaLoadError || playback.manifestError}
          </p>
        )}
      </div>
    </div>
  );
}
