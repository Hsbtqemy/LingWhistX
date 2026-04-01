import { useEffect, useMemo, useRef, useState } from "react";
import { formatClockSeconds } from "../../../appUtils";
import type { EditableSegment, QueryWindowResult } from "../../../types";
import { speakerColor } from "./viewUtils";

export function PlayerWordsBody({
  slice,
  playheadMs,
  wordsLayerActive,
  onSeekToMs,
  followPlayhead = true,
  editMode = false,
  editorSegments,
  onFocusSegment,
  onUpdateText,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
  followPlayhead?: boolean;
  editMode?: boolean;
  editorSegments?: EditableSegment[];
  activeSegmentIndex?: number | null;
  onFocusSegment?: (index: number) => void;
  onUpdateText?: (index: number, text: string) => void;
  durationSec?: number | null;
}) {
  const [followActive, setFollowActive] = useState(true);
  const [editingSegIdx, setEditingSegIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const programmaticScrollRef = useRef(false);

  const activeWordId = useMemo(() => {
    for (let i = slice.words.length - 1; i >= 0; i--) {
      const w = slice.words[i];
      if (playheadMs >= w.startMs && playheadMs < w.endMs) return w.id;
    }
    return -1;
  }, [slice.words, playheadMs]);

  useEffect(() => {
    if (!followPlayhead || !followActive || activeWordId < 0) return;
    const el = activeRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [followPlayhead, followActive, activeWordId]);

  const handleScroll = () => {
    if (programmaticScrollRef.current) return;
    if (followActive) setFollowActive(false);
  };

  if (!wordsLayerActive) {
    return (
      <p className="player-viewport-placeholder small">
        Active <strong>Fenêtre mots (30s)</strong> dans le panneau de gauche pour charger les tokens
        dans une fenêtre ≤ 30s.
      </p>
    );
  }

  const speakers = Array.from(new Set(slice.words.map((w) => w.speaker || "\u2014").filter(Boolean))).sort();

  return (
    <div className="player-words">
      <div className="player-words-header">
        <span className="player-words-meta small mono">
          {slice.words.length} mots
          {slice.truncated.words ? " · tronqué" : ""}
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

      <div className="player-words-flow" ref={scrollRef} onScroll={handleScroll}>
        {editMode && editingSegIdx != null && editorSegments && onUpdateText ? (
          <div className="player-words-edit-inline">
            <span className="player-words-edit-label small mono">
              {editorSegments[editingSegIdx]?.speaker ?? "\u2014"} · {formatClockSeconds(editorSegments[editingSegIdx]?.start ?? 0)}
            </span>
            <textarea
              className="player-inline-edit-textarea"
              value={editorSegments[editingSegIdx].text}
              onChange={(ev) => onUpdateText(editingSegIdx, ev.target.value)}
              onBlur={() => setEditingSegIdx(null)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); setEditingSegIdx(null); }
                if (ev.key === "Escape") setEditingSegIdx(null);
              }}
              autoFocus
              rows={Math.max(2, Math.ceil((editorSegments[editingSegIdx].text.length || 1) / 60))}
            />
          </div>
        ) : null}
        {slice.words.map((w) => {
          const isActive = w.id === activeWordId;
          const isPast = activeWordId >= 0 && w.startMs < playheadMs && !isActive;
          const isUnaligned = w.alignmentStatus === "interpolated" || w.alignmentStatus === "unaligned";
          const isLowConf = w.confidence != null && w.confidence < 0.5;
          const spIdx = speakers.indexOf(w.speaker || "\u2014");

          let cls = "player-word-token";
          if (isActive) cls += " is-active";
          else if (isPast) cls += " is-past";
          if (isUnaligned) cls += " is-unaligned";
          if (isLowConf) cls += " is-low-conf";

          const handleWordDoubleClick = () => {
            if (!editMode || !editorSegments) return;
            for (let si = 0; si < editorSegments.length; si++) {
              const sMs = Math.round(editorSegments[si].start * 1000);
              const eMs = Math.round(editorSegments[si].end * 1000);
              if (w.startMs >= sMs && w.startMs < eMs) {
                onFocusSegment?.(si);
                setEditingSegIdx(si);
                return;
              }
            }
          };

          return (
            <span
              key={w.id}
              ref={isActive ? activeRef : undefined}
              className={cls}
              role="button"
              tabIndex={onSeekToMs ? 0 : -1}
              onClick={() => onSeekToMs?.(w.startMs)}
              onDoubleClick={handleWordDoubleClick}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSeekToMs?.(w.startMs); }}
              title={`${formatClockSeconds(w.startMs / 1000)} – ${formatClockSeconds(w.endMs / 1000)}${isUnaligned ? " · non aligné" : ""}${isLowConf ? ` · conf. ${((w.confidence ?? 0) * 100).toFixed(0)}%` : ""}`}
              style={isActive ? { borderBottomColor: speakerColor(spIdx) } : undefined}
            >
              {w.token?.trim() || "\u2026"}
            </span>
          );
        })}
      </div>
      {slice.words.length === 0 && (
        <p className="small player-empty-message">Aucun mot dans cette fenêtre.</p>
      )}
    </div>
  );
}
