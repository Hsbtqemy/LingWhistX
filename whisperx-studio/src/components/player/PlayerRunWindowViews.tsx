import type { EditableSegment, QueryWindowResult } from "../../types";
import type { PlayerViewportMode } from "./playerViewportContract";
import { PlayerChatBody } from "./views/ChatView";
import { PlayerColumnsBody } from "./views/ColumnsView";
import { PlayerKaraokeBody } from "./views/KaraokeView";
import { PlayerLanesBody } from "./views/LanesView";
import { PlayerRythmoView } from "./views/RythmoView";
import { PlayerStatsBody } from "./views/StatsView";
import { PlayerWordsBody } from "./views/WordsView";

export type { PlayerViewportMode };

type Props = {
  mode: PlayerViewportMode;
  slice: QueryWindowResult | null;
  playheadMs: number;
  loading: boolean;
  /** Si défini, le parent affiche déjà l'erreur IPC. */
  queryError: string | null;
  /** Requête avec couche words (fenêtre 30s). */
  wordsLayerActive: boolean;
  /** Seek au début d'un bloc (ms) — Lanes / Chat / Mots. */
  onSeekToMs?: (ms: number) => void;
  /** Vue Rythmo : défile la ligne active au centre (⌃5). */
  followPlayhead?: boolean;
  /** Lanes pro (WX-653) : mini-carte + boucle par glisser-déposer. */
  durationSec?: number | null;
  loopAsec?: number | null;
  loopBsec?: number | null;
  onSetLoopRange?: (aSec: number, bSec: number) => void;
  editMode?: boolean;
  editorSegments?: EditableSegment[];
  activeSegmentIndex?: number | null;
  setActiveSegmentIndex?: (i: number | null) => void;
  updateEditorSegmentText?: (index: number, text: string) => void;
  updateEditorSegmentBoundary?: (index: number, edge: "start" | "end", value: number) => void;
  focusSegment?: (index: number) => void;
  /** Liste complète des locuteurs du run (pour les lanes karaoké). */
  runSpeakerIds?: string[];
  /** WX-713 — Seuil de pause visible dans Lanes et Rythmo (ms). */
  longPauseMs?: number;
};

/**
 * Dispatcher des vues player — délègue à chaque vue dans views/.
 */
export function PlayerRunWindowViews({
  mode,
  slice,
  playheadMs,
  loading,
  queryError,
  wordsLayerActive,
  onSeekToMs,
  followPlayhead = true,
  durationSec,
  loopAsec,
  loopBsec,
  onSetLoopRange,
  editMode = false,
  editorSegments,
  activeSegmentIndex,
  updateEditorSegmentText,
  focusSegment,
  longPauseMs = 300,
  runSpeakerIds,
}: Props) {
  if (queryError) {
    return null;
  }
  if (!slice) {
    if (loading) {
      return <p className="player-viewport-placeholder small">Chargement des événements…</p>;
    }
    return (
      <p className="player-viewport-placeholder small">
        Aucune donnée — importe <code>events.sqlite</code> depuis <strong>Open run</strong> si
        besoin.
      </p>
    );
  }

  if (mode === "columns") {
    return (
      <PlayerColumnsBody
        slice={slice}
        playheadMs={playheadMs}
        onSeekToMs={onSeekToMs}
        editMode={editMode}
        editorSegments={editorSegments}
        activeSegmentIndex={activeSegmentIndex ?? null}
        onFocusSegment={focusSegment}
        onUpdateText={updateEditorSegmentText}
      />
    );
  }
  if (mode === "rythmo") {
    return (
      <PlayerRythmoView
        slice={slice}
        playheadMs={playheadMs}
        onSeekToMs={onSeekToMs}
        followPlayhead={followPlayhead}
        editMode={editMode}
        editorSegments={editorSegments}
        activeSegmentIndex={activeSegmentIndex ?? null}
        onFocusSegment={focusSegment}
        onUpdateText={updateEditorSegmentText}
        durationSec={durationSec}
        longPauseMs={longPauseMs}
      />
    );
  }
  if (mode === "karaoke") {
    return (
      <PlayerKaraokeBody
        slice={slice}
        playheadMs={playheadMs}
        wordsLayerActive={wordsLayerActive}
        onSeekToMs={onSeekToMs}
        followPlayhead={followPlayhead}
        editMode={editMode}
        editorSegments={editorSegments}
        activeSegmentIndex={activeSegmentIndex ?? null}
        onFocusSegment={focusSegment}
        onUpdateText={updateEditorSegmentText}
        runSpeakerIds={runSpeakerIds}
      />
    );
  }
  if (mode === "lanes") {
    return (
      <PlayerLanesBody
        slice={slice}
        playheadMs={playheadMs}
        onSeekToMs={onSeekToMs}
        durationSec={durationSec}
        loopAsec={loopAsec}
        loopBsec={loopBsec}
        editorSegments={editorSegments}
        onSetLoopRange={onSetLoopRange}
        followPlayhead={followPlayhead}
        editMode={editMode}
        activeSegmentIndex={activeSegmentIndex ?? null}
        onFocusSegment={focusSegment}
        onUpdateText={updateEditorSegmentText}
        longPauseMs={longPauseMs}
      />
    );
  }
  if (mode === "chat") {
    return (
      <PlayerChatBody
        slice={slice}
        playheadMs={playheadMs}
        onSeekToMs={onSeekToMs}
        followPlayhead={followPlayhead}
        editorSegments={editorSegments}
        editMode={editMode}
        activeSegmentIndex={activeSegmentIndex ?? null}
        onFocusSegment={focusSegment}
        onUpdateText={updateEditorSegmentText}
        durationSec={durationSec}
      />
    );
  }
  if (mode === "stats") {
    return (
      <PlayerStatsBody
        slice={slice}
        playheadMs={playheadMs}
        durationSec={durationSec}
        onSeekToMs={onSeekToMs}
      />
    );
  }
  return (
    <PlayerWordsBody
      slice={slice}
      playheadMs={playheadMs}
      wordsLayerActive={wordsLayerActive}
      onSeekToMs={onSeekToMs}
      followPlayhead={followPlayhead}
      editMode={editMode}
      editorSegments={editorSegments}
      activeSegmentIndex={activeSegmentIndex ?? null}
      onFocusSegment={focusSegment}
      onUpdateText={updateEditorSegmentText}
      durationSec={durationSec}
    />
  );
}
