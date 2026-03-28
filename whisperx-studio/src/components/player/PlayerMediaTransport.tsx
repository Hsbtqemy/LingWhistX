import { PLAYBACK_RATE_STEP } from "../../hooks/usePlayerPlayback";

export type PlayerMediaTransportProps = {
  disabled: boolean;
  playing: boolean;
  onTogglePlayPause: () => void | Promise<void>;
  onStop: () => void;
  /** Décalage en secondes (ex. −5 / +5). */
  onSeekRelative: (deltaSec: number) => void;
  currentTimeSec: number;
  durationSec: number | null;
  onSeek: (sec: number) => void;
  playbackRate: number;
  onNudgePlaybackRate: (delta: number) => void;
  volume: number;
  muted: boolean;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  isVideo: boolean;
  videoFullscreen: boolean;
  onToggleVideoFullscreen: () => void | Promise<void>;
  followPlayhead: boolean;
  onToggleFollowPlayhead: () => void;
  posLabel: string;
  durLabel: string;
  copyPositionHint: boolean;
  onCopyPlayhead: () => void | Promise<void>;
};

/**
 * Contrôles de transport liés à la zone média (lecture, saut, progression, volume).
 */
export function PlayerMediaTransport({
  disabled,
  playing,
  onTogglePlayPause,
  onStop,
  onSeekRelative,
  currentTimeSec,
  durationSec,
  onSeek,
  playbackRate,
  onNudgePlaybackRate,
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
  isVideo,
  videoFullscreen,
  onToggleVideoFullscreen,
  followPlayhead,
  onToggleFollowPlayhead,
  posLabel,
  durLabel,
  copyPositionHint,
  onCopyPlayhead,
}: PlayerMediaTransportProps) {
  const dur = durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const scrubMax = dur > 0 ? dur : 1;
  const scrubValue = dur > 0 ? Math.min(currentTimeSec, dur) : 0;

  return (
    <div
      className="player-media-transport"
      role="group"
      aria-label="Contrôles de lecture"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="player-media-transport__progress">
        <input
          type="range"
          className="player-media-transport__scrub"
          min={0}
          max={scrubMax}
          step={dur > 0 ? 0.02 : 1}
          value={scrubValue}
          disabled={disabled || dur <= 0}
          aria-label="Position dans le média"
          onChange={(ev) => {
            const v = Number(ev.target.value);
            if (Number.isFinite(v)) {
              onSeek(v);
            }
          }}
        />
      </div>
      <div className="player-media-transport__row">
        <div className="player-media-transport__primary">
          <button
            type="button"
            className={`ghost player-media-transport__play ${playing ? "player-media-transport__play--on" : ""}`}
            onClick={() => void onTogglePlayPause()}
            disabled={disabled}
            title="Lecture / pause (Espace)"
            aria-label={playing ? "Pause" : "Lecture"}
          >
            {playing ? "Pause" : "Lecture"}
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={() => onStop()}
            disabled={disabled}
            title="Arrêt et retour au début (Home)"
          >
            Stop
          </button>
          <span className="player-media-transport__seek-group" aria-label="Sauts">
            <button
              type="button"
              className="ghost small"
              onClick={() => onSeekRelative(-5)}
              disabled={disabled}
              title="Reculer de 5 s (Shift+←)"
            >
              −5 s
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => onSeekRelative(-1)}
              disabled={disabled}
              title="Reculer de 1 s (←)"
            >
              −1 s
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => onSeekRelative(1)}
              disabled={disabled}
              title="Avancer de 1 s (→)"
            >
              +1 s
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => onSeekRelative(5)}
              disabled={disabled}
              title="Avancer de 5 s (Shift+→)"
            >
              +5 s
            </button>
          </span>
        </div>
        <div className="player-media-transport__time mono small" aria-live="polite">
          <span
            className="player-timecode player-timecode--dblcopy"
            title="Position / durée — double-clic pour copier"
            onDoubleClick={() => void onCopyPlayhead()}
          >
            {posLabel} / {durLabel}
          </span>
          {copyPositionHint ? (
            <span className="player-copy-hint" aria-live="polite">
              Copié
            </span>
          ) : null}
          <button
            type="button"
            className="ghost small"
            onClick={() => void onCopyPlayhead()}
            disabled={disabled}
            title="Copier la position (⌃⇧C)"
          >
            Copier
          </button>
        </div>
        <div className="player-media-transport__secondary">
          <button
            type="button"
            className="ghost small"
            onClick={() => onNudgePlaybackRate(-PLAYBACK_RATE_STEP)}
            disabled={disabled}
            title="Ralentir (−)"
          >
            −
          </button>
          <span className="player-speed small" title="Vitesse de lecture">
            {playbackRate.toFixed(2)}×
          </span>
          <button
            type="button"
            className="ghost small"
            onClick={() => onNudgePlaybackRate(PLAYBACK_RATE_STEP)}
            disabled={disabled}
            title="Accélérer (+)"
          >
            +
          </button>
          <label className="player-volume small">
            <span className="player-volume-label">Vol.</span>
            <input
              type="range"
              className="player-volume-range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(ev) => {
                const v = Number(ev.target.value);
                onVolumeChange(v);
              }}
              disabled={disabled}
              aria-label="Volume"
            />
          </label>
          <button
            type="button"
            className={`ghost small ${muted ? "player-mute-on" : ""}`}
            onClick={() => onToggleMute()}
            disabled={disabled}
            title="Muet (M)"
          >
            {muted ? "Muet" : "Son"}
          </button>
          {isVideo ? (
            <button
              type="button"
              className={`ghost small ${videoFullscreen ? "player-video-fs-on" : ""}`}
              onClick={() => void onToggleVideoFullscreen()}
              disabled={disabled}
              title={
                videoFullscreen
                  ? "Quitter le plein écran (Alt+Entrée)"
                  : "Plein écran vidéo (Alt+Entrée)"
              }
            >
              {videoFullscreen ? "Quit. écran" : "Plein écran"}
            </button>
          ) : null}
          <button
            type="button"
            className={`ghost small ${followPlayhead ? "player-follow-on" : ""}`}
            onClick={onToggleFollowPlayhead}
            title="Suivre la tête dans le viewport (F)"
          >
            {followPlayhead ? "Suivi" : "Suivi off"}
          </button>
        </div>
      </div>
    </div>
  );
}
