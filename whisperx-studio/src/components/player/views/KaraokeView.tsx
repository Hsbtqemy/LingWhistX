import { useEffect, useMemo, useRef } from "react";
import { isWordAligned } from "../../../player/karaokeWords";
import type { QueryWindowResult } from "../../../types";
import { speakerColor } from "./viewUtils";

type KaraokeSegment = {
  ipuId: number;
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
  words: { id: number; token: string; startMs: number; endMs: number; aligned: boolean }[];
  pauseBefore: number | null;
  hasOverlap: boolean;
  hasUnaligned: boolean;
};

function buildKaraokeSegments(slice: QueryWindowResult): KaraokeSegment[] {
  const ipus = [...slice.ipus].sort((a, b) => a.startMs - b.startMs);
  const words = [...slice.words].sort((a, b) => a.startMs - b.startMs);
  const pauses = slice.pauses;
  const turns = slice.turns;

  const result: KaraokeSegment[] = [];
  for (let ii = 0; ii < ipus.length; ii++) {
    const ipu = ipus[ii];
    const sp = ipu.speaker?.trim() || "\u2014";
    const segWords = words.filter((w) => w.startMs >= ipu.startMs && w.endMs <= ipu.endMs + 50);
    const hasUnaligned = segWords.some((w) => !isWordAligned(w));

    let pauseBefore: number | null = null;
    const matchedPause = pauses.find(
      (p) => p.endMs >= ipu.startMs - 50 && p.endMs <= ipu.startMs + 50 && p.durMs >= 300,
    );
    if (matchedPause) pauseBefore = matchedPause.durMs;

    let hasOverlap = false;
    for (const t of turns) {
      if (t.speaker !== sp) {
        const oStart = Math.max(t.startMs, ipu.startMs);
        const oEnd = Math.min(t.endMs, ipu.endMs);
        if (oEnd - oStart > 50) {
          hasOverlap = true;
          break;
        }
      }
    }

    result.push({
      ipuId: ipu.id,
      startMs: ipu.startMs,
      endMs: ipu.endMs,
      speaker: sp,
      text: ipu.text?.trim() ?? segWords.map((w) => w.token?.trim() || "").join(" "),
      words: segWords.map((w) => ({
        id: w.id,
        token: w.token?.trim() || "\u2026",
        startMs: w.startMs,
        endMs: w.endMs,
        aligned: isWordAligned(w),
      })),
      pauseBefore,
      hasOverlap,
      hasUnaligned,
    });
  }
  return result;
}

function KaraokeLane({
  speaker,
  speakerIndex,
  segments,
  playheadMs,
  onSeekToMs,
}: {
  speaker: string;
  speakerIndex: number;
  segments: KaraokeSegment[];
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLDivElement | null>(null);

  const activeIdx = useMemo(() => {
    for (let i = 0; i < segments.length; i++) {
      if (playheadMs >= segments[i].startMs && playheadMs < segments[i].endMs) return i;
    }
    let best = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startMs <= playheadMs) best = i;
    }
    return best;
  }, [segments, playheadMs]);

  const isSpeaking =
    activeIdx >= 0 &&
    playheadMs >= segments[activeIdx].startMs &&
    playheadMs < segments[activeIdx].endMs;

  const activeWordId = useMemo(() => {
    if (activeIdx < 0) return -1;
    const seg = segments[activeIdx];
    for (const w of seg.words) {
      if (playheadMs >= w.startMs && playheadMs < w.endMs) return w.id;
    }
    return -1;
  }, [segments, activeIdx, playheadMs]);

  useEffect(() => {
    const el = activeLineRef.current;
    const container = contentRef.current;
    if (!el || !container || typeof container.scrollTo !== "function") return;
    const containerH = container.clientHeight;
    const elTop = el.offsetTop;
    const elH = el.offsetHeight;
    const targetScroll = elTop - (containerH - elH) / 2;
    container.scrollTo({ top: targetScroll, behavior: "smooth" });
  }, [activeIdx]);

  const hasNotStarted = activeIdx < 0 && segments.length > 0;
  const nextSegIdx = useMemo(() => {
    if (!hasNotStarted) return -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startMs > playheadMs) return i;
    }
    return -1;
  }, [hasNotStarted, segments, playheadMs]);

  const WINDOW_BEFORE = 2;
  const WINDOW_AFTER = 2;
  const renderedSegs = useMemo(() => {
    if (hasNotStarted) return [];
    const from = Math.max(0, activeIdx - WINDOW_BEFORE);
    const to = Math.min(segments.length, activeIdx + WINDOW_AFTER + 1);
    return segments.slice(from, to).map((seg, i) => ({ seg, globalIdx: from + i }));
  }, [hasNotStarted, segments, activeIdx]);

  const color = speakerColor(speakerIndex);

  const timeUntilSec =
    hasNotStarted && nextSegIdx >= 0
      ? Math.max(0, Math.round((segments[nextSegIdx].startMs - playheadMs) / 1000))
      : 0;

  return (
    <div
      className={`karaoke-lane${isSpeaking ? " is-speaking" : ""}${hasNotStarted ? " is-waiting" : ""}`}
      style={{ "--lane-color": color } as React.CSSProperties}
    >
      <div className="karaoke-lane-label mono" style={{ color }}>
        {speaker}
        {hasNotStarted && timeUntilSec > 0 ? (
          <span className="karaoke-lane-countdown"> · dans {timeUntilSec}s</span>
        ) : null}
      </div>
      <div className="karaoke-lane-content" ref={contentRef}>
        {renderedSegs.length === 0 ? (
          <div className="karaoke-lane-empty" />
        ) : (
          renderedSegs.map(({ seg, globalIdx: si }) => {
            const isActive = si === activeIdx;
            const isPast = activeIdx >= 0 && si < activeIdx;
            const isFuture = !isActive && !isPast;
            const isUpcoming = false;

            let cls = "karaoke-line";
            if (isActive) cls += " is-active";
            if (isPast) cls += " is-past";
            if (isUpcoming) cls += " is-upcoming";
            else if (isFuture) cls += " is-future";

            return (
              <div key={seg.ipuId} ref={isActive ? activeLineRef : undefined} className={cls}>
                {seg.words.length > 0 ? (
                  <span className="karaoke-line-words">
                    {seg.words.map((w) => {
                      const wSpoken = isPast || (isActive && playheadMs >= w.startMs);
                      const wCurrent = isActive && w.id === activeWordId;
                      let wCls = "karaoke-word";
                      if (wSpoken) wCls += " is-spoken";
                      if (wCurrent) wCls += " is-current";
                      if (!w.aligned) wCls += " is-unaligned";
                      return (
                        <button
                          key={w.id}
                          type="button"
                          className={wCls}
                          disabled={!onSeekToMs}
                          onClick={() => onSeekToMs?.(w.startMs)}
                        >
                          {w.token}
                        </button>
                      );
                    })}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="karaoke-line-text"
                    disabled={!onSeekToMs}
                    onClick={() => onSeekToMs?.(seg.startMs)}
                  >
                    {seg.text || "\u2026"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function PlayerKaraokeBody({
  slice,
  playheadMs,
  wordsLayerActive,
  onSeekToMs,
  runSpeakerIds,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
  followPlayhead: boolean;
  runSpeakerIds?: string[];
}) {
  const allSegments = useMemo(() => buildKaraokeSegments(slice), [slice]);

  const speakers = useMemo(() => {
    const fromSegs = allSegments.map((s) => s.speaker);
    const all = runSpeakerIds && runSpeakerIds.length > 0 ? [...runSpeakerIds] : [...fromSegs];
    return Array.from(new Set(all)).sort();
  }, [allSegments, runSpeakerIds]);

  const speakerSegments = useMemo(() => {
    const map = new Map<string, KaraokeSegment[]>();
    for (const sp of speakers) map.set(sp, []);
    for (const seg of allSegments) {
      const list = map.get(seg.speaker);
      if (list) list.push(seg);
      else map.set(seg.speaker, [seg]);
    }
    return map;
  }, [allSegments, speakers]);

  if (!wordsLayerActive) {
    return (
      <p className="player-viewport-placeholder small">
        Active <strong>Charger les mots</strong> dans le panneau de gauche pour afficher la vue
        Karaoké.
      </p>
    );
  }

  if (allSegments.length === 0) {
    return <p className="small player-empty-message">Aucun segment dans cette fenêtre.</p>;
  }

  return (
    <div className="karaoke-v2" aria-label="Vue karaoké">
      {speakers.map((sp, spIdx) => (
        <KaraokeLane
          key={sp}
          speaker={sp}
          speakerIndex={spIdx}
          segments={speakerSegments.get(sp) || []}
          playheadMs={playheadMs}
          onSeekToMs={onSeekToMs}
        />
      ))}
    </div>
  );
}
