import { useCallback, useEffect, useRef, useState } from "react";
import { formatClockSeconds } from "../../appUtils";
import type { QueryWindowResult, EditableSegment } from "../../types";
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

export type PlayerFullscreenViewProps = {
  onExit: () => void;
  // Playback
  playing: boolean;
  currentTimeSec: number;
  durationSec: number | null | undefined;
  playbackRate: number;
  volume: number;
  muted: boolean;
  onTogglePlayPause: () => void | Promise<void>;
  onSeek: (sec: number) => void;
  onSeekRelative: (deltaSec: number) => void;
  onNudgePlaybackRate: (delta: number) => void;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  // View
  viewportMode: PlayerViewportMode;
  onSetViewportMode: (mode: PlayerViewportMode) => void;
  // Data (pass-through to PlayerRunWindowViews)
  slice: QueryWindowResult | null;
  playheadMs: number;
  loading: boolean;
  queryError: string | null;
  wordsLayerActive: boolean;
  followPlayhead: boolean;
  loopAsec?: number | null;
  loopBsec?: number | null;
  onSetLoopRange?: (aSec: number, bSec: number) => void;
  // Editor (pass-through)
  editMode: boolean;
  editorSegments: EditableSegment[];
  activeSegmentIndex: number | null;
  setActiveSegmentIndex: (i: number | null) => void;
  updateEditorSegmentText: (index: number, text: string) => void;
  updateEditorSegmentBoundary: (index: number, edge: "start" | "end", value: number) => void;
  focusSegment: (index: number) => void;
  // Speakers
  runSpeakerIds: string[];
  speakerSolo: string | null;
  onSetSpeakerSolo: (id: string | null) => void;
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
  onNudgePlaybackRate,
  onVolumeChange,
  onToggleMute,
  viewportMode,
  onSetViewportMode,
  slice,
  playheadMs,
  loading,
  queryError,
  wordsLayerActive,
  followPlayhead,
  loopAsec,
  loopBsec,
  onSetLoopRange,
  editMode,
  editorSegments,
  activeSegmentIndex,
  setActiveSegmentIndex,
  updateEditorSegmentText,
  updateEditorSegmentBoundary,
  focusSegment,
  runSpeakerIds,
  speakerSolo,
  onSetSpeakerSolo,
}: PlayerFullscreenViewProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [localMode, setLocalMode] = useState<PlayerViewportMode>(viewportMode);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  useEffect(() => {
    setLocalMode(viewportMode);
  }, [viewportMode]);

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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.code === "Escape" || e.code === "F11") {
        e.preventDefault();
        onExit();
        return;
      }
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onExit();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        void onTogglePlayPause();
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
      // Ctrl+1-7: switch view
      if ((e.ctrlKey || e.metaKey) && e.code.startsWith("Digit")) {
        const n = Number.parseInt(e.code.replace("Digit", ""), 10);
        if (n >= 1 && n <= VIEW_LABELS.length) {
          e.preventDefault();
          handleSetMode(VIEW_LABELS[n - 1].mode);
          return;
        }
      }
      // 0-9 without modifier: speaker solo
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
    [onExit, onTogglePlayPause, onSeekRelative, onNudgePlaybackRate, onToggleMute, onSetSpeakerSolo, runSpeakerIds, speakerSolo, handleSetMode],
  );

  return (
    <div
      ref={overlayRef}
      className="player-fs-overlay"
      tabIndex={0}
      role="application"
      aria-label="Mode immersif"
      onKeyDown={onKeyDown}
    >
      {/* Barre de contrôles */}
      <div className="player-fs-controls">
        <button type="button" className="player-fs-exit-btn" onClick={onExit} title="Quitter (Échap)">
          Quitter
        </button>

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

        <div className="player-fs-transport">
          <button
            type="button"
            className="player-fs-ctrl-btn"
            onClick={() => onSeekRelative(-5)}
            title="-5s"
          >
            -5s
          </button>
          <button
            type="button"
            className="player-fs-ctrl-btn player-fs-play-btn"
            onClick={() => void onTogglePlayPause()}
            title={playing ? "Pause" : "Lecture"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            className="player-fs-ctrl-btn"
            onClick={() => onSeekRelative(5)}
            title="+5s"
          >
            +5s
          </button>

          <span className="player-fs-timecode mono">
            {formatClockSeconds(currentTimeSec)} / {formatClockSeconds(durSec)}
          </span>
        </div>

        <input
          type="range"
          className="player-fs-scrub"
          min={0}
          max={durSec || 1}
          step={0.1}
          value={currentTimeSec}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Position de lecture"
        />

        <div className="player-fs-extras">
          <button
            type="button"
            className="player-fs-ctrl-btn"
            onClick={() => onNudgePlaybackRate(-0.25)}
            title="Ralentir"
          >
            -
          </button>
          <span className="player-fs-rate mono" title="Vitesse">
            {playbackRate.toFixed(2)}x
          </span>
          <button
            type="button"
            className="player-fs-ctrl-btn"
            onClick={() => onNudgePlaybackRate(0.25)}
            title="Accélérer"
          >
            +
          </button>

          <button
            type="button"
            className="player-fs-ctrl-btn"
            onClick={onToggleMute}
            title={muted ? "Activer le son" : "Couper le son"}
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
              onChange={(e) => onSetSpeakerSolo(e.target.value === "__all__" ? null : e.target.value)}
              aria-label="Filtre locuteur"
            >
              <option value="__all__">Tous</option>
              {runSpeakerIds.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {/* Contenu principal — vues player */}
      <div className="player-fs-content">
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
          editMode={editMode}
          editorSegments={editorSegments}
          activeSegmentIndex={activeSegmentIndex}
          setActiveSegmentIndex={setActiveSegmentIndex}
          updateEditorSegmentText={updateEditorSegmentText}
          updateEditorSegmentBoundary={updateEditorSegmentBoundary}
          focusSegment={focusSegment}
        />
      </div>
    </div>
  );
}
