import { fileBasename } from "../../appUtils";
import { PLAYBACK_RATE_STEP } from "../../hooks/usePlayerPlayback";

export type PlayerTopBarProps = {
  onBack: () => void;
  runLabel: string;
  runDir: string | null;
  mediaPath: string | null;
  shortcutsHelpOpen: boolean;
  onToggleShortcutsHelp: () => void;
  transportDisabled: boolean;
  playing: boolean;
  onTogglePlayPause: () => void;
  onStop: () => void;
  onSeekRelative: (delta: number) => void;
  posLabel: string;
  durLabel: string;
  copyPositionHint: boolean;
  onCopyPlayhead: () => void;
  playbackRate: number;
  onNudgePlaybackRate: (delta: number) => void;
  volume: number;
  muted: boolean;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  isVideo: boolean;
  videoFullscreen: boolean;
  onToggleVideoFullscreen: () => void;
  followPlayhead: boolean;
  onToggleFollowPlayhead: () => void;
  loopHint: string;
  onMarkLoopA: () => void;
  onMarkLoopB: () => void;
  onClearLoop: () => void;
  loopAsec: number | null;
  loopBsec: number | null;
  qcSummary: string;
  exportFolderError: string;
  exportPackError: string;
  exportPackHint: string;
  exportPackBusy: boolean;
  onOpenRunFolder: () => void;
  onExportRunTimingPack: () => void;
};

/**
 * Barre supérieure transport + export (Player WX-624).
 */
export function PlayerTopBar({
  onBack,
  runLabel,
  runDir,
  mediaPath,
  shortcutsHelpOpen,
  onToggleShortcutsHelp,
  transportDisabled,
  playing,
  onTogglePlayPause,
  onStop,
  onSeekRelative,
  posLabel,
  durLabel,
  copyPositionHint,
  onCopyPlayhead,
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
  loopHint,
  onMarkLoopA,
  onMarkLoopB,
  onClearLoop,
  loopAsec,
  loopBsec,
  qcSummary,
  exportFolderError,
  exportPackError,
  exportPackHint,
  exportPackBusy,
  onOpenRunFolder,
  onExportRunTimingPack,
}: PlayerTopBarProps) {
  return (
    <header className="player-topbar">
      <div className="player-topbar-left">
        <button type="button" className="ghost" onClick={onBack}>
          ← Retour
        </button>
        <span className="player-run-label mono" title={runDir ?? ""}>
          {runLabel}
        </span>
        {mediaPath ? (
          <span className="player-media-hint small mono" title={mediaPath}>
            {fileBasename(mediaPath)}
          </span>
        ) : null}
        <button
          type="button"
          className="ghost small"
          onClick={onToggleShortcutsHelp}
          title="Raccourcis clavier (?)"
          aria-expanded={shortcutsHelpOpen}
          aria-controls="player-shortcuts-help-dialog"
        >
          Aide (?)
        </button>
      </div>
      <div className="player-topbar-transport" aria-label="Transport">
        <button
          type="button"
          className="ghost"
          onClick={() => void onTogglePlayPause()}
          disabled={transportDisabled}
          title="Lecture / pause (Espace)"
        >
          {playing ? "Pause" : "Lecture"}
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => onStop()}
          disabled={transportDisabled}
          title="Arrêt et retour au début (Home)"
        >
          Stop
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => onSeekRelative(-1)}
          disabled={transportDisabled}
          title="−1 s (←)"
        >
          −1s
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => onSeekRelative(1)}
          disabled={transportDisabled}
          title="+1 s (→)"
        >
          +1s
        </button>
        <div className="player-timecode-group">
          <span
            className="player-timecode small mono player-timecode--dblcopy"
            title="Position / durée — double-clic pour copier"
            onDoubleClick={() => void onCopyPlayhead()}
          >
            {posLabel} / {durLabel}
          </span>
          {copyPositionHint ? (
            <span className="player-copy-hint small" aria-live="polite">
              Copié
            </span>
          ) : null}
          <button
            type="button"
            className="ghost small"
            onClick={() => void onCopyPlayhead()}
            disabled={transportDisabled}
            title="Copier la position (⌃⇧C / ⌘⇧C)"
          >
            Copier
          </button>
        </div>
        <button
          type="button"
          className="ghost small"
          onClick={() => onNudgePlaybackRate(-PLAYBACK_RATE_STEP)}
          disabled={transportDisabled}
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
          disabled={transportDisabled}
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
            disabled={transportDisabled}
            aria-label="Volume"
          />
        </label>
        <button
          type="button"
          className={`ghost small ${muted ? "player-mute-on" : ""}`}
          onClick={() => onToggleMute()}
          disabled={transportDisabled}
          title="Muet (M)"
        >
          {muted ? "Muet" : "Son"}
        </button>
        {isVideo ? (
          <button
            type="button"
            className={`ghost small ${videoFullscreen ? "player-video-fs-on" : ""}`}
            onClick={() => void onToggleVideoFullscreen()}
            disabled={transportDisabled}
            title={
              videoFullscreen ? "Quitter le plein écran (Alt+Entrée)" : "Plein écran vidéo (Alt+Entrée)"
            }
          >
            {videoFullscreen ? "Quit. plein écran" : "Plein écran"}
          </button>
        ) : null}
        <button
          type="button"
          className={`ghost small ${followPlayhead ? "player-follow-on" : ""}`}
          onClick={onToggleFollowPlayhead}
          title="Suivre la tête dans le viewport (F) — désactivé si tu fais défiler le panneau"
        >
          {followPlayhead ? "Suivi" : "Suivi off"}
        </button>
      </div>
      <div className="player-topbar-right">
        <span className="player-loop-hint small mono" title="Boucle A–B">
          {loopHint}
        </span>
        <button type="button" className="ghost small" onClick={onMarkLoopA} disabled={transportDisabled}>
          Marquer A
        </button>
        <button type="button" className="ghost small" onClick={onMarkLoopB} disabled={transportDisabled}>
          Marquer B
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={onClearLoop}
          disabled={transportDisabled || (!loopAsec && !loopBsec)}
        >
          Effacer boucle
        </button>
        <span className="player-qc-badge small" title="Heuristiques fenêtre + manifest">
          QC : {qcSummary}
        </span>
        <button
          type="button"
          className="ghost"
          disabled={!runDir}
          title="Ouvre le dossier du run (⌃⇧O / ⌘⇧O)"
          onClick={() => void onOpenRunFolder()}
        >
          Dossier run
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!runDir || exportPackBusy}
          title="JSON + SRT + CSV (⌃⇧E / ⌘⇧E) — comme l’Explorer"
          onClick={() => void onExportRunTimingPack()}
        >
          {exportPackBusy ? "Export…" : "Export pack timing"}
        </button>
        {exportFolderError ? (
          <span className="player-export-error small" role="alert">
            {exportFolderError}
          </span>
        ) : null}
        {exportPackError ? (
          <span className="player-export-error small" role="alert">
            {exportPackError}
          </span>
        ) : null}
        {exportPackHint ? (
          <span className="player-export-hint small mono" title={exportPackHint}>
            {exportPackHint.length > 96 ? `${exportPackHint.slice(0, 96)}…` : exportPackHint}
          </span>
        ) : null}
      </div>
    </header>
  );
}
