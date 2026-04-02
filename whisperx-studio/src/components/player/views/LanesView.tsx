import { useEffect, useMemo, useRef, useState } from "react";
import { clampNumber, formatClockSeconds } from "../../../appUtils";
import type { EventTurnRow, QueryWindowResult } from "../../../types";
import { speakerColor, turnTextFromIpus } from "./viewUtils";

type LanesLayoutMode = "timeline" | "columns";

type LanesTurnEnriched = {
  turn: EventTurnRow;
  text: string;
  durMs: number;
  pauseBeforeMs: number | null;
  pauseBeforeType: string | null;
  hasOverlap: boolean;
  speakerIndex: number;
};

function enrichTurns(
  slice: QueryWindowResult,
  longPauseMs: number = 300,
): { enriched: LanesTurnEnriched[]; speakers: string[] } {
  const sorted = [...slice.turns].sort((a, b) => a.startMs - b.startMs);
  const speakers = Array.from(new Set(sorted.map((t) => t.speaker || "\u2014"))).sort();

  const enriched: LanesTurnEnriched[] = sorted.map((t, i) => {
    const text = turnTextFromIpus(t, slice.ipus);
    const durMs = t.endMs - t.startMs;

    let pauseBeforeMs: number | null = null;
    const matchedPause = slice.pauses.find(
      (p) => p.endMs >= t.startMs - 50 && p.endMs <= t.startMs + 50 && p.durMs >= longPauseMs,
    );
    const pauseBeforeType = matchedPause?.type ?? null;
    if (matchedPause) pauseBeforeMs = matchedPause.durMs;

    const prev = i > 0 ? sorted[i - 1] : null;
    const hasOverlap = prev != null && prev.speaker !== t.speaker && prev.endMs > t.startMs + 50;

    const sp = t.speaker || "\u2014";
    const speakerIndex = speakers.indexOf(sp);

    return { turn: t, text, durMs, pauseBeforeMs, pauseBeforeType, hasOverlap, speakerIndex };
  });

  return { enriched, speakers };
}

function PlayerLanesMiniMap({
  durationSec,
  t0Ms,
  t1Ms,
  playheadMs,
  loopAsec,
  loopBsec,
  onSeekToMs,
  onSetLoopRange,
}: {
  durationSec: number | null | undefined;
  t0Ms: number;
  t1Ms: number;
  playheadMs: number;
  loopAsec: number | null | undefined;
  loopBsec: number | null | undefined;
  onSeekToMs?: (ms: number) => void;
  onSetLoopRange?: (aSec: number, bSec: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startMs: number; curMs: number } | null>(null);
  const [dragUi, setDragUi] = useState<{ startMs: number; curMs: number } | null>(null);

  const durMs =
    durationSec != null && durationSec > 0 && Number.isFinite(durationSec)
      ? durationSec * 1000
      : null;

  const timeFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || !durMs) {
      return 0;
    }
    const r = el.getBoundingClientRect();
    const x = clampNumber((clientX - r.left) / Math.max(1, r.width), 0, 1);
    return x * durMs;
  };

  if (!durMs) {
    return null;
  }

  const loopAMs = loopAsec != null ? loopAsec * 1000 : null;
  const loopBMs = loopBsec != null ? loopBsec * 1000 : null;
  const previewA = dragUi ? Math.min(dragUi.startMs, dragUi.curMs) : null;
  const previewB = dragUi ? Math.max(dragUi.startMs, dragUi.curMs) : null;

  const pct = (ms: number) => clampNumber((ms / durMs) * 100, 0, 100);
  const widthPct = (a: number, b: number) => clampNumber(((b - a) / durMs) * 100, 0, 100);

  return (
    <div className="player-lanes-minimap">
      <p className="player-lanes-minimap-hint small">
        Vue d'ensemble — glisser pour boucle A–B · clic court pour seek
      </p>
      <div
        ref={trackRef}
        className="player-lanes-minimap-track"
        role="group"
        aria-label="Mini-carte : fenêtre SQLite, lecture, boucle"
      >
        <div className="player-lanes-minimap-track-inner">
          <div
            className="player-lanes-minimap-window"
            style={{
              left: `${pct(t0Ms)}%`,
              width: `${widthPct(t0Ms, t1Ms)}%`,
            }}
          />
          {loopAMs != null && loopBMs != null && loopBMs > loopAMs ? (
            <div
              className="player-lanes-minimap-loop"
              style={{
                left: `${pct(loopAMs)}%`,
                width: `${widthPct(loopAMs, loopBMs)}%`,
              }}
            />
          ) : null}
          {previewA != null && previewB != null ? (
            <div
              className="player-lanes-minimap-drag"
              style={{
                left: `${pct(previewA)}%`,
                width: `${widthPct(previewA, previewB)}%`,
              }}
            />
          ) : null}
          <div className="player-lanes-minimap-playhead" style={{ left: `${pct(playheadMs)}%` }} />
        </div>
        <button
          type="button"
          tabIndex={-1}
          className="player-lanes-minimap-hit"
          aria-label="Définir boucle ou seek sur la timeline"
          onPointerDown={(e) => {
            if (e.button !== 0) {
              return;
            }
            e.preventDefault();
            const ms = timeFromClientX(e.clientX);
            dragRef.current = { startMs: ms, curMs: ms };
            setDragUi({ startMs: ms, curMs: ms });
            (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) {
              return;
            }
            const ms = timeFromClientX(e.clientX);
            dragRef.current = { ...dragRef.current, curMs: ms };
            setDragUi({ ...dragRef.current });
          }}
          onPointerUp={(e) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDragUi(null);
            try {
              (e.target as HTMLButtonElement).releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
            if (!d) {
              return;
            }
            const a = Math.min(d.startMs, d.curMs);
            const b = Math.max(d.startMs, d.curMs);
            if (b - a < 300) {
              onSeekToMs?.(a);
            } else {
              onSetLoopRange?.(a / 1000, b / 1000);
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragUi(null);
          }}
        />
      </div>
    </div>
  );
}

export function PlayerLanesBody({
  slice,
  playheadMs,
  onSeekToMs,
  durationSec,
  loopAsec,
  loopBsec,
  onSetLoopRange,
  followPlayhead = true,
  longPauseMs = 300,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  durationSec?: number | null;
  loopAsec?: number | null;
  loopBsec?: number | null;
  onSetLoopRange?: (aSec: number, bSec: number) => void;
  followPlayhead?: boolean;
  longPauseMs?: number;
}) {
  const [layoutMode, setLayoutMode] = useState<LanesLayoutMode>("timeline");
  const [followActive, setFollowActive] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);

  const { enriched, speakers } = useMemo(
    () => enrichTurns(slice, longPauseMs),
    // `slice` object reference changes on every IPC query even when data is identical;
    // depend on the inner arrays so we only recompute when the content actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slice.turns, slice.ipus, slice.pauses, longPauseMs],
  );

  const activeIndex = useMemo(() => {
    for (let i = enriched.length - 1; i >= 0; i--) {
      const t = enriched[i].turn;
      if (playheadMs >= t.startMs && playheadMs < t.endMs) return i;
    }
    return -1;
  }, [enriched, playheadMs]);

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

  const bySpeaker = useMemo(() => {
    const map = new Map<string, LanesTurnEnriched[]>();
    for (const e of enriched) {
      const sp = e.turn.speaker || "\u2014";
      const list = map.get(sp) ?? [];
      list.push(e);
      map.set(sp, list);
    }
    return map;
  }, [enriched]);

  const renderTurnCard = (
    e: LanesTurnEnriched,
    _idx: number,
    isActive: boolean,
    isPast: boolean,
    showSpeaker: boolean,
  ) => {
    let cls = "player-lanes-turn";
    if (isActive) cls += " is-active";
    else if (isPast) cls += " is-past";

    return (
      <div key={e.turn.id} ref={isActive ? activeRef : undefined} className={cls} role="listitem">
        <button
          type="button"
          className="player-lanes-turn-btn"
          disabled={!onSeekToMs}
          onClick={() => onSeekToMs?.(e.turn.startMs)}
          title={`${formatClockSeconds(e.turn.startMs / 1000)} – ${formatClockSeconds(e.turn.endMs / 1000)} · cliquer pour lire`}
        >
          <div className="player-lanes-turn-left">
            {showSpeaker && (
              <span
                className="player-lanes-turn-speaker mono"
                style={{ color: speakerColor(e.speakerIndex) }}
              >
                {e.turn.speaker || "\u2014"}
              </span>
            )}
            <span className="player-lanes-turn-time mono">
              {formatClockSeconds(e.turn.startMs / 1000)}
            </span>
            <span className="player-lanes-turn-dur mono">
              {e.durMs >= 1000 ? `${(e.durMs / 1000).toFixed(1)}s` : `${Math.round(e.durMs)}ms`}
            </span>
          </div>
          <div className="player-lanes-turn-body">{e.text || "\u2026"}</div>
          <div className="player-lanes-turn-badges">
            {e.pauseBeforeMs != null &&
              (() => {
                const typeLabel =
                  e.pauseBeforeType === "inter_turn"
                    ? "inter"
                    : e.pauseBeforeType === "intra_turn"
                      ? "intra"
                      : null;
                const tooltip = typeLabel
                  ? `Pause ${typeLabel}-tour — ${(e.pauseBeforeMs / 1000).toFixed(2)} s`
                  : `Pause — ${(e.pauseBeforeMs / 1000).toFixed(2)} s`;
                return (
                  <span
                    className={`player-lanes-badge player-lanes-badge--pause${e.pauseBeforeType === "inter_turn" ? " player-lanes-badge--pause-inter" : ""}`}
                    title={tooltip}
                  >
                    ⏸ {(e.pauseBeforeMs / 1000).toFixed(1)}s{typeLabel ? ` ${typeLabel}` : ""}
                  </span>
                );
              })()}
            {e.hasOverlap && (
              <span
                className="player-lanes-badge player-lanes-badge--overlap"
                title="Chevauchement"
              >
                ⟷
              </span>
            )}
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="player-lanes">
      <div className="player-lanes-header">
        <span className="player-lanes-meta small mono">
          {slice.turns.length} tours · {speakers.length} loc.
          {slice.truncated.turns ? " · tronqué" : ""}
        </span>
        <div className="player-lanes-header-actions">
          <div className="player-lanes-mode-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={layoutMode === "timeline"}
              className={`player-lanes-mode-btn small${layoutMode === "timeline" ? " is-active" : ""}`}
              onClick={() => setLayoutMode("timeline")}
            >
              Chronologique
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={layoutMode === "columns"}
              className={`player-lanes-mode-btn small${layoutMode === "columns" ? " is-active" : ""}`}
              onClick={() => setLayoutMode("columns")}
            >
              Par locuteur
            </button>
          </div>
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
      </div>

      <PlayerLanesMiniMap
        durationSec={durationSec}
        t0Ms={slice.t0Ms}
        t1Ms={slice.t1Ms}
        playheadMs={playheadMs}
        loopAsec={loopAsec}
        loopBsec={loopBsec}
        onSeekToMs={onSeekToMs}
        onSetLoopRange={onSetLoopRange}
      />

      <div className="player-lanes-scroll" ref={scrollRef} onScroll={handleScroll} role="list">
        {layoutMode === "timeline" ? (
          <div className="player-lanes-timeline">
            {enriched.map((e, i) =>
              renderTurnCard(e, i, i === activeIndex, activeIndex >= 0 && i < activeIndex, true),
            )}
          </div>
        ) : (
          <div className="player-lanes-grid">
            {speakers.map((sp) => {
              const spTurns = bySpeaker.get(sp) ?? [];
              const spIdx = speakers.indexOf(sp);
              return (
                <div key={sp} className="player-lanes-column">
                  <div className="player-lanes-column-title" style={{ color: speakerColor(spIdx) }}>
                    {sp}
                  </div>
                  {spTurns.map((e) => {
                    const globalIdx = enriched.indexOf(e);
                    const isActive = globalIdx === activeIndex;
                    const isPast = activeIndex >= 0 && globalIdx < activeIndex;
                    return renderTurnCard(e, globalIdx, isActive, isPast, false);
                  })}
                </div>
              );
            })}
          </div>
        )}
        {slice.turns.length === 0 && (
          <p className="small player-empty-message">Aucun tour de parole dans cette fenêtre.</p>
        )}
      </div>
    </div>
  );
}
