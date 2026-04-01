import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClockSeconds } from "../../../appUtils";
import type { EditableSegment, EventTurnRow, QueryWindowResult } from "../../../types";
import {
  buildOrdinalSegmentIndex,
  findSegmentIndexForTurn,
  speakerColor,
  turnTextFromIpus,
  turnTextFromSegments,
} from "./viewUtils";

export function PlayerChatBody({
  slice,
  playheadMs,
  onSeekToMs,
  followPlayhead = true,
  editorSegments,
  editMode = false,
  activeSegmentIndex,
  onFocusSegment,
  onUpdateText,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  followPlayhead?: boolean;
  editorSegments?: EditableSegment[];
  editMode?: boolean;
  activeSegmentIndex?: number | null;
  onFocusSegment?: (index: number) => void;
  onUpdateText?: (index: number, text: string) => void;
  durationSec?: number | null;
}) {
  const [followActive, setFollowActive] = useState(true);
  const [editingTurnId, setEditingTurnId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);

  const speakers = useMemo(
    () => Array.from(new Set(slice.turns.map((t) => t.speaker || "\u2014"))).sort(),
    [slice.turns],
  );

  const sortedTurns = useMemo(
    () => [...slice.turns].sort((a, b) => a.startMs - b.startMs),
    [slice.turns],
  );

  const ordinalIndex = useMemo(
    () => (editorSegments ? buildOrdinalSegmentIndex(slice.turns, editorSegments) : null),
    [slice.turns, editorSegments],
  );

  const activeIndex = useMemo(() => {
    for (let i = sortedTurns.length - 1; i >= 0; i--) {
      const t = sortedTurns[i];
      if (playheadMs >= t.startMs && playheadMs < t.endMs) return i;
    }
    return -1;
  }, [sortedTurns, playheadMs]);

  useEffect(() => {
    if (!followPlayhead || !followActive || activeIndex < 0) return;
    const el = activeRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [followPlayhead, followActive, activeIndex]);

  const handleScroll = () => {
    if (programmaticScrollRef.current) return;
    if (followActive) setFollowActive(false);
  };

  const getTurnText = useCallback(
    (turn: EventTurnRow): string => {
      const ipuText = turnTextFromIpus(turn, slice.ipus);
      if (ipuText) return ipuText;
      if (editorSegments) {
        return turnTextFromSegments(turn, editorSegments);
      }
      return "";
    },
    [editorSegments, slice.ipus],
  );

  return (
    <div className="player-chat">
      <div className="player-chat-header">
        <span className="player-chat-meta small mono">
          {sortedTurns.length} tours · {speakers.length} loc.
          {slice.truncated.turns ? " · tronqué" : ""}
        </span>
        {!followActive && (
          <button
            type="button"
            className="player-lanes-follow-btn small"
            onClick={() => setFollowActive(true)}
          >
            Reprendre le suivi
          </button>
        )}
      </div>

      <div className="player-chat-thread" ref={scrollRef} onScroll={handleScroll} role="log">
        {sortedTurns.map((turn, i) => {
          const isActive = i === activeIndex;
          const isPast = activeIndex >= 0 && i < activeIndex;
          const prevSpeaker = i > 0 ? sortedTurns[i - 1].speaker : null;
          const sameSpeaker = turn.speaker === prevSpeaker && i > 0;
          const spIdx = speakers.indexOf(turn.speaker || "\u2014");
          const text = getTurnText(turn);
          const durMs = turn.endMs - turn.startMs;
          const isEditingThis = editMode && editingTurnId === turn.id;
          const segIdx = editMode && editorSegments
            ? findSegmentIndexForTurn(turn, editorSegments, ordinalIndex, slice.turns)
            : null;
          const isFocused = editMode && segIdx != null && activeSegmentIndex === segIdx;

          let cls = "player-chat-bubble";
          if (isActive) cls += " is-active";
          else if (isPast) cls += " is-past";
          if (isFocused) cls += " is-focused";

          const handleDoubleClick = () => {
            if (!editMode || segIdx == null) return;
            onFocusSegment?.(segIdx);
            setEditingTurnId(turn.id);
          };

          return (
            <div
              key={turn.id}
              ref={isActive ? activeRef : undefined}
              className={cls}
              onDoubleClick={handleDoubleClick}
            >
              <button
                type="button"
                className="player-chat-bubble-btn"
                disabled={!onSeekToMs}
                onClick={() => onSeekToMs?.(turn.startMs)}
                title={`${formatClockSeconds(turn.startMs / 1000)} – ${formatClockSeconds(turn.endMs / 1000)} · cliquer pour lire`}
              >
                {!sameSpeaker && (
                  <div
                    className="player-chat-speaker-tag mono"
                    style={{ color: speakerColor(spIdx) }}
                  >
                    {turn.speaker || "\u2014"}
                  </div>
                )}
                <div className="player-chat-body">
                  {isEditingThis && segIdx != null && onUpdateText ? (
                    <textarea
                      className="player-inline-edit-textarea"
                      value={editorSegments![segIdx].text}
                      onChange={(ev) => onUpdateText(segIdx, ev.target.value)}
                      onBlur={() => setEditingTurnId(null)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); setEditingTurnId(null); }
                        if (ev.key === "Escape") setEditingTurnId(null);
                      }}
                      onClick={(ev) => ev.stopPropagation()}
                      autoFocus
                      rows={Math.max(2, Math.ceil((editorSegments![segIdx].text.length || 1) / 60))}
                    />
                  ) : (
                    <p className="player-chat-text">{text || "\u2026"}</p>
                  )}
                </div>
                <div className="player-chat-meta-row mono">
                  <span className="player-chat-time">
                    {formatClockSeconds(turn.startMs / 1000)}
                  </span>
                  <span className="player-chat-dur">
                    {durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : `${Math.round(durMs)}ms`}
                  </span>
                </div>
              </button>
            </div>
          );
        })}
        {sortedTurns.length === 0 && (
          <p className="small player-empty-message">Aucun tour de parole dans cette fenêtre.</p>
        )}
      </div>
    </div>
  );
}
