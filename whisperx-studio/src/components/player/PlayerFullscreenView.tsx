import { useCallback, useEffect, useRef, useState } from "react";
import { formatClockSeconds } from "../../appUtils";
import type { QueryWindowResult } from "../../types";
import { PlayerRunWindowViews, type PlayerViewportMode } from "./PlayerRunWindowViews";

const VIEW_LABELS: { mode: PlayerViewportMode; label: string; key: string }[] = [
  { mode: "lanes", label: "Lanes", key: "1" },
  { mode: "chat", label: "Chat", key: "2" },
  { mode: "words", label: "Mots", key: "3" },
  { mode: "columns", label: "Colonnes", key: "4" },
  { mode: "rythmo", label: "Rythmo", key: "5" },
  { mode: "karaoke", label: "Karaoké", key: "6" },
  { mode: "stats", label: "Stats", key: "7" },
];

const IDLE_HIDE_DELAY_MS = 3000;

export type PlayerFullscreenViewProps = {
  onExit: () => void;
  playing: boolean;
  currentTimeSec: number;
  durationSec: number | null | undefined;
  playbackRate: number;
  volume: number;
  muted: boolean;
  onTogglePlayPause: () => void | Promise<void>;
  onSeek: (sec: number) => void;
  onSeekRelative: (deltaSec: number) => void;
  onStop: () => void;
  onNudgePlaybackRate: (delta: number) => void;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  onMarkLoopA?: () => void;
  onMarkLoopB?: () => void;
  onClearLoop?: () => void;
  onPrevSegment?: () => void;
  onNextSegment?: () => void;
  activeSpeaker?: string | null;
  viewportMode: PlayerViewportMode;
  onSetViewportMode: (mode: PlayerViewportMode) => void;
  slice: QueryWindowResult | null;
  playheadMs: number;
  loading: boolean;
  queryError: string | null;
  wordsLayerActive: boolean;
  followPlayhead: boolean;
  onToggleFollowPlayhead: () => void;
  loopAsec?: number | null;
  loopBsec?: number | null;
  onSetLoopRange?: (aSec: number, bSec: number) => void;
  runSpeakerIds: string[];
  speakerSolo: string | null;
  onSetSpeakerSolo: (id: string | null) => void;
  longPauseMs?: number;
};

export function PlayerFullscreenView({
  onExit,
  playing,
  currentTimeSec,
  durationSec,
  playbackRate,
  volume,
  muted,
  onTogglePlayPause,
  onSeek,
  onSeekRelative,
  onStop,
  onNudgePlaybackRate,
  onVolumeChange,
  onToggleMute,
  onMarkLoopA,
  onMarkLoopB,
  onClearLoop,
  onPrevSegment,
  onNextSegment,
  activeSpeaker,
  viewportMode,
  onSetViewportMode,
  slice,
  playheadMs,
  loading,
  queryError,
  wordsLayerActive,
  followPlayhead,
  onToggleFollowPlayhead,
  loopAsec,
  loopBsec,
  onSetLoopRange,
  runSpeakerIds,
  speakerSolo,
  onSetSpeakerSolo,
  longPauseMs = 300,
}: PlayerFullscreenViewProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [localMode, setLocalMode] = useState<PlayerViewportMode>(viewportMode);
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  useEffect(() => {
    setLocalMode(viewportMode);
  }, [viewportMode]);

  // Auto-scroll: keep active element visible in fullscreen content
  const followScrollKey = Math.floor(playheadMs / 250);
  useEffect(() => {
    if (!followPlayhead) return;
    const root = contentRef.current;
    if (!root) return;
    const target = root.querySelector(".is-active");
    if (!target || !(target instanceof HTMLElement)) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [followPlayhead, followScrollKey]);

  // Idle-hide: hide controls after inactivity
  const resetIdleTimer = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setControlsVisible(false), IDLE_HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  const handleSetMode = useCallback(
    (mode: PlayerViewportMode) => {
      setLocalMode(mode);
      onSetViewportMode(mode);
    },
    [onSetViewportMode],
  );

  const durSec = durationSec != null && Number.isFinite(durationSec) ? durationSec : 0;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      resetIdleTimer();
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.code === "Escape" || e.code === "F11") {
        e.preventDefault();
        onExit();
        return;
      }
      // F = toggle follow playhead (not exit)
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        onToggleFollowPlayhead();
        return;
      }
      // Cmd/Ctrl+Shift+F = exit fullscreen
      if (e.code === "KeyF" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        onExit();
        return;
      }
      if (e.code === "Space" || e.code === "KeyK") {
        e.preventDefault();
        void onTogglePlayPause();
        return;
      }
      // J = rewind 10s
      if (e.code === "KeyJ" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onSeekRelative(-10);
        return;
      }
      if (e.code === "Home" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onStop();
        return;
      }
      if (e.code === "End" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (durSec > 0) onSeek(durSec);
        return;
      }
      if (e.code === "KeyL" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (loopAsec == null && onMarkLoopA) {
          onMarkLoopA();
        } else if (loopBsec == null && onMarkLoopB) {
          onMarkLoopB();
        } else if (onClearLoop) {
          onClearLoop();
        }
        return;
      }
      if (e.code === "BracketLeft" && !e.ctrlKey && !e.metaKey && onPrevSegment) {
        e.preventDefault();
        onPrevSegment();
        return;
      }
      if (e.code === "BracketRight" && !e.ctrlKey && !e.metaKey && onNextSegment) {
        e.preventDefault();
        onNextSegment();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        onSeekRelative(e.shiftKey ? -5 : e.altKey ? -0.1 : -1);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        onSeekRelative(e.shiftKey ? 5 : e.altKey ? 0.1 : 1);
        return;
      }
      if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        onNudgePlaybackRate(-0.25);
        return;
      }
      if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        onNudgePlaybackRate(0.25);
        return;
      }
      if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onToggleMute();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code.startsWith("Digit")) {
        const n = Number.parseInt(e.code.replace("Digit", ""), 10);
        if (n >= 1 && n <= VIEW_LABELS.length) {
          e.preventDefault();
          handleSetMode(VIEW_LABELS[n - 1].mode);
          return;
        }
      }
      if (e.code === "Digit0" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onSetSpeakerSolo(null);
        return;
      }
      if (e.code.startsWith("Digit") && e.code !== "Digit0" && !e.ctrlKey && !e.metaKey) {
        const n = Number.parseInt(e.code.replace("Digit", ""), 10);
        if (n >= 1 && n <= 9) {
          e.preventDefault();
          const id = runSpeakerIds[n - 1];
          if (id) onSetSpeakerSolo(speakerSolo === id ? null : id);
        }
        return;
      }
    },
    [
      onExit,
      onTogglePlayPause,
      onToggleFollowPlayhead,
      onSeekRelative,
      onStop,
      onSeek,
      durSec,
      onNudgePlaybackRate,
      onToggleMute,
      onSetSpeakerSolo,
      runSpeakerIds,
      speakerSolo,
      handleSetMode,
      loopAsec,
      loopBsec,
      onMarkLoopA,
      onMarkLoopB,
      onClearLoop,
      onPrevSegment,
      onNextSegment,
      resetIdleTimer,
    ],
  );

  return (
    <div
      ref={overlayRef}
      className={`player-fs-overlay${controlsVisible ? "" : " player-fs-controls-hidden"}`}
      tabIndex={0}
      role="application"
      aria-label="Plein écran"
      onKeyDown={onKeyDown}
      onMouseMove={resetIdleTimer}
    >
      <div className="player-fs-topbar">
        <div className="player-fs-view-tabs" role="tablist" aria-label="Vue">
          {VIEW_LABELS.map((v) => (
            <button
              key={v.mode}
              type="button"
              role="tab"
              aria-selected={localMode === v.mode}
              className={`player-fs-view-tab${localMode === v.mode ? " is-active" : ""}`}
              onClick={() => handleSetMode(v.mode)}
              title={`${v.label} (⌃${v.key})`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="player-fs-exit-btn"
          onClick={onExit}
          title="Quitter le plein écran (Échap / F11)"
        >
          ✕
        </button>
      </div>

      <div ref={contentRef} className={`player-fs-content player-fs-content--${localMode}`}>
        <PlayerRunWindowViews
          mode={localMode}
          slice={slice}
          playheadMs={playheadMs}
          loading={loading}
          queryError={queryError}
          wordsLayerActive={wordsLayerActive}
          followPlayhead={followPlayhead}
          onSeekToMs={(ms) => onSeek(ms / 1000)}
          durationSec={durationSec}
          loopAsec={loopAsec}
          loopBsec={loopBsec}
          onSetLoopRange={onSetLoopRange}
          runSpeakerIds={runSpeakerIds}
          longPauseMs={longPauseMs}
        />
      </div>

      {/* Barre bas : scrubber + transport */}
      <div className="player-fs-bottombar">
        <input
          type="range"
          className="player-fs-scrub"
          min={0}
          max={durSec || 1}
          step={0.05}
          value={Math.min(currentTimeSec, durSec || 0)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Position de lecture"
        />
        <div className="player-fs-controls">
          {/* Gauche : timecode + locuteur */}
          <div className="player-fs-left">
            <span className="player-fs-timecode mono">
              {formatClockSeconds(currentTimeSec)} / {formatClockSeconds(durSec)}
            </span>
            {activeSpeaker ? (
              <span className="player-fs-speaker-badge">{activeSpeaker}</span>
            ) : null}
          </div>

          {/* Centre : transport */}
          <div className="player-fs-transport">
            {onPrevSegment ? (
              <button
                type="button"
                className="player-fs-ctrl-btn"
                onClick={onPrevSegment}
                title="Segment préc. ( [ )"
              >
                ⏮
              </button>
            ) : null}
            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={() => onSeekRelative(-5)}
              title="−5 s (Shift+←)"
            >
              −5s
            </button>
            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={() => onSeekRelative(-1)}
              title="−1 s (←)"
            >
              −1s
            </button>
            <button
              type="button"
              className="player-fs-ctrl-btn player-fs-play-btn"
              onClick={() => void onTogglePlayPause()}
              title={playing ? "Pause (Espace)" : "Lecture (Espace)"}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={onStop}
              title="Stop (Home)"
            >
              ⏹
            </button>
            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={() => onSeekRelative(1)}
              title="+1 s (→)"
            >
              +1s
            </button>
            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={() => onSeekRelative(5)}
              title="+5 s (Shift+→)"
            >
              +5s
            </button>
            {onNextSegment ? (
              <button
                type="button"
                className="player-fs-ctrl-btn"
                onClick={onNextSegment}
                title="Segment suiv. ( ] )"
              >
                ⏭
              </button>
            ) : null}
          </div>

          {/* Droite : vitesse + volume + locuteur solo */}
          <div className="player-fs-right">
            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={() => onNudgePlaybackRate(-0.25)}
              title="Ralentir (−)"
            >
              −
            </button>
            <span className="player-fs-rate mono">{playbackRate.toFixed(2)}×</span>
            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={() => onNudgePlaybackRate(0.25)}
              title="Accélérer (+)"
            >
              +
            </button>

            <button
              type="button"
              className="player-fs-ctrl-btn"
              onClick={onToggleMute}
              title={muted ? "Activer le son (M)" : "Couper le son (M)"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <input
              type="range"
              className="player-fs-volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              aria-label="Volume"
            />

            {runSpeakerIds.length > 1 ? (
              <select
                className="player-fs-speaker-select"
                value={speakerSolo ?? "__all__"}
                onChange={(e) =>
                  onSetSpeakerSolo(e.target.value === "__all__" ? null : e.target.value)
                }
                aria-label="Filtre locuteur"
              >
                <option value="__all__">Tous</option>
                {runSpeakerIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
