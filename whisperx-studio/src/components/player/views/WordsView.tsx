import { useEffect, useMemo, useRef, useState } from "react";
import { formatClockSeconds } from "../../../appUtils";
import type { QueryWindowResult } from "../../../types";
import { speakerColor } from "./viewUtils";

export function PlayerWordsBody({
  slice,
  playheadMs,
  wordsLayerActive,
  onSeekToMs,
  followPlayhead = true,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
  followPlayhead?: boolean;
  durationSec?: number | null;
}) {
  const [followActive, setFollowActive] = useState(true);
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

  const speakers = Array.from(
    new Set(slice.words.map((w) => w.speaker || "\u2014").filter(Boolean)),
  ).sort();

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
        {slice.words.map((w) => {
          const isActive = w.id === activeWordId;
          const isPast = activeWordId >= 0 && w.startMs < playheadMs && !isActive;
          const isUnaligned =
            w.alignmentStatus === "interpolated" || w.alignmentStatus === "unaligned";
          const isLowConf = w.confidence != null && w.confidence < 0.5;
          const spIdx = speakers.indexOf(w.speaker || "\u2014");

          let cls = "player-word-token";
          if (isActive) cls += " is-active";
          else if (isPast) cls += " is-past";
          if (isUnaligned) cls += " is-unaligned";
          if (isLowConf) cls += " is-low-conf";

          return (
            <span
              key={w.id}
              ref={isActive ? activeRef : undefined}
              className={cls}
              role="button"
              tabIndex={onSeekToMs ? 0 : -1}
              onClick={() => onSeekToMs?.(w.startMs)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSeekToMs?.(w.startMs);
              }}
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
