import type React from "react";
import type { UsePlayerPlaybackResult } from "../../hooks/usePlayerPlayback";
import type { WaveformWorkspace } from "../../hooks/useWaveformWorkspace";

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

      {(playback.mediaLoadError || playback.manifestError) && (
        <p className="editor-mini-player__media-error small">
          {playback.mediaLoadError || playback.manifestError}
        </p>
      )}
    </div>
  );
}
