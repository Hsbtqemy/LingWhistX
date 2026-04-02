import { PLAYBACK_RATE_STEP } from "../../hooks/usePlayerPlayback";

export type PlayerMediaTransportProps = {
  disabled: boolean;
  playing: boolean;
  onTogglePlayPause: () => void | Promise<void>;
  onStop: () => void;
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
  onPrevSegment?: () => void;
  onNextSegment?: () => void;
  activeSpeaker?: string | null;
  fullscreenMode?: boolean;
  onToggleFullscreen?: () => void;
};

/* SVG icon helpers – 16×16 viewBox, stroke-based */
const I = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

const IconPlay = () => <I d="M4.5 2.5 L13 8 L4.5 13.5 Z" fill />;
const IconPause = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
    <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
  </svg>
);
const IconStop = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <rect x="3" y="3" width="10" height="10" rx="1.5" />
  </svg>
);
const IconSkipBack = () => <I d="M12 3 L6 8 L12 13 M4 3 L4 13" />;
const IconSkipFwd = () => <I d="M4 3 L10 8 L4 13 M12 3 L12 13" />;
const IconRewind = () => <I d="M13 3 L7.5 8 L13 13 M8.5 3 L3 8 L8.5 13" />;
const IconFastFwd = () => <I d="M3 3 L8.5 8 L3 13 M7.5 3 L13 8 L7.5 13" />;
const IconVolume = () => <I d="M2 6 L5 6 L9 2.5 L9 13.5 L5 10 L2 10 Z M11.5 5.5 Q14 8 11.5 10.5" />;
const IconMute = () => (
  <I d="M2 6 L5 6 L9 2.5 L9 13.5 L5 10 L2 10 Z M12 5.5 L14 10.5 M14 5.5 L12 10.5" />
);
const IconFollow = () => <I d="M8 2 L8 14 M4 6 L8 2 L12 6" />;
const IconPrevSeg = () => <I d="M3 3 L3 13 M5 8 L13 3 L13 13 Z" fill />;
const IconNextSeg = () => <I d="M13 3 L13 13 M11 8 L3 3 L3 13 Z" fill />;
const IconExpand = () => (
  <I d="M2 2 L6 2 M2 2 L2 6 M14 2 L10 2 M14 2 L14 6 M2 14 L6 14 M2 14 L2 10 M14 14 L10 14 M14 14 L14 10" />
);
const IconCollapse = () => (
  <I d="M6 2 L6 6 L2 6 M10 2 L10 6 L14 6 M6 14 L6 10 L2 10 M10 14 L10 10 L14 10" />
);

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
  onPrevSegment,
  onNextSegment,
  activeSpeaker,
  fullscreenMode,
  onToggleFullscreen,
}: PlayerMediaTransportProps) {
  const dur =
    durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
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
            if (Number.isFinite(v)) onSeek(v);
          }}
        />
      </div>

      <div className="player-media-transport__row">
        {/* ── Timecode + locuteur (gauche) ── */}
        <div className="player-media-transport__time mono small">
          <span
            className="player-timecode player-timecode--dblcopy"
            title="Double-clic pour copier la position"
            onDoubleClick={() => void onCopyPlayhead()}
          >
            {posLabel} / {durLabel}
          </span>
          {copyPositionHint ? (
            <span className="player-copy-hint" aria-live="polite">
              Copié
            </span>
          ) : null}
          {activeSpeaker ? (
            <span className="player-active-speaker-badge" title="Locuteur actif">
              {activeSpeaker}
            </span>
          ) : null}
        </div>

        {/* ── Seek & Play (centre) ── */}
        <div className="player-media-transport__primary">
          {onPrevSegment ? (
            <button
              type="button"
              className="player-transport-btn player-transport-btn--sm"
              onClick={onPrevSegment}
              disabled={disabled}
              title="Segment précédent ( [ )"
              aria-label="Segment précédent"
            >
              <IconPrevSeg />
            </button>
          ) : null}
          <button
            type="button"
            className="player-transport-btn"
            onClick={() => onSeekRelative(-5)}
            disabled={disabled}
            title="−5 s (Shift+←)"
            aria-label="Reculer de 5 secondes"
          >
            <IconRewind />
            <span className="player-transport-btn__label">5s</span>
          </button>
          <button
            type="button"
            className="player-transport-btn"
            onClick={() => onSeekRelative(-1)}
            disabled={disabled}
            title="−1 s (←)"
            aria-label="Reculer de 1 seconde"
          >
            <IconSkipBack />
            <span className="player-transport-btn__label">1s</span>
          </button>

          <button
            type="button"
            className={`player-transport-btn player-transport-btn--play${playing ? " player-transport-btn--active" : ""}`}
            onClick={() => void onTogglePlayPause()}
            disabled={disabled}
            title={playing ? "Pause (Espace)" : "Lecture (Espace)"}
            aria-label={playing ? "Pause" : "Lecture"}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>

          <button
            type="button"
            className="player-transport-btn"
            onClick={() => onStop()}
            disabled={disabled}
            title="Stop — retour au début (Home)"
            aria-label="Stop"
          >
            <IconStop />
          </button>

          <button
            type="button"
            className="player-transport-btn"
            onClick={() => onSeekRelative(1)}
            disabled={disabled}
            title="+1 s (→)"
            aria-label="Avancer de 1 seconde"
          >
            <IconSkipFwd />
            <span className="player-transport-btn__label">1s</span>
          </button>
          <button
            type="button"
            className="player-transport-btn"
            onClick={() => onSeekRelative(5)}
            disabled={disabled}
            title="+5 s (Shift+→)"
            aria-label="Avancer de 5 secondes"
          >
            <IconFastFwd />
            <span className="player-transport-btn__label">5s</span>
          </button>
          {onNextSegment ? (
            <button
              type="button"
              className="player-transport-btn player-transport-btn--sm"
              onClick={onNextSegment}
              disabled={disabled}
              title="Segment suivant ( ] )"
              aria-label="Segment suivant"
            >
              <IconNextSeg />
            </button>
          ) : null}
        </div>

        {/* ── Speed / Volume / Follow (droite) ── */}
        <div className="player-media-transport__secondary">
          <div className="player-speed-group" title="Vitesse de lecture (+ / −)">
            <button
              type="button"
              className="player-transport-btn player-transport-btn--sm"
              onClick={() => onNudgePlaybackRate(-PLAYBACK_RATE_STEP)}
              disabled={disabled}
              title="Ralentir (−)"
              aria-label="Ralentir"
            >
              −
            </button>
            <span className="player-speed-value mono small">{playbackRate.toFixed(2)}×</span>
            <button
              type="button"
              className="player-transport-btn player-transport-btn--sm"
              onClick={() => onNudgePlaybackRate(PLAYBACK_RATE_STEP)}
              disabled={disabled}
              title="Accélérer (+)"
              aria-label="Accélérer"
            >
              +
            </button>
          </div>

          <label className="player-volume-group">
            <button
              type="button"
              className={`player-transport-btn player-transport-btn--sm${muted ? " player-transport-btn--active" : ""}`}
              onClick={() => onToggleMute()}
              disabled={disabled}
              title={muted ? "Activer le son (M)" : "Couper le son (M)"}
              aria-label={muted ? "Activer le son" : "Couper le son"}
            >
              {muted ? <IconMute /> : <IconVolume />}
            </button>
            <input
              type="range"
              className="player-volume-range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(ev) => onVolumeChange(Number(ev.target.value))}
              disabled={disabled}
              aria-label="Volume"
            />
          </label>

          <button
            type="button"
            className={`player-transport-btn player-transport-btn--sm${followPlayhead ? " player-transport-btn--active" : ""}`}
            onClick={onToggleFollowPlayhead}
            title={followPlayhead ? "Suivre le playhead (F) — actif" : "Suivre le playhead (F)"}
            aria-label="Suivre le playhead"
          >
            <IconFollow />
          </button>

          {isVideo ? (
            <button
              type="button"
              className={`player-transport-btn player-transport-btn--sm${videoFullscreen ? " player-transport-btn--active" : ""}`}
              onClick={() => void onToggleVideoFullscreen()}
              disabled={disabled}
              title={
                videoFullscreen
                  ? "Quitter le plein écran vidéo (Alt+Entrée)"
                  : "Plein écran vidéo (Alt+Entrée)"
              }
              aria-label={videoFullscreen ? "Quitter le plein écran vidéo" : "Plein écran vidéo"}
            >
              ⛶
            </button>
          ) : null}
          {onToggleFullscreen ? (
            <button
              type="button"
              className={`player-transport-btn player-transport-btn--sm${fullscreenMode ? " player-transport-btn--active" : ""}`}
              onClick={onToggleFullscreen}
              title={fullscreenMode ? "Quitter le plein écran (F11)" : "Plein écran (F11)"}
              aria-label={fullscreenMode ? "Quitter le plein écran" : "Plein écran"}
            >
              {fullscreenMode ? <IconCollapse /> : <IconExpand />}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
