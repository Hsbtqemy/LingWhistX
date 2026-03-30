import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { clampNumber, formatClockSeconds } from "../../appUtils";
import {
  buildTimeBins,
  turnsForSpeakerInBin,
  uniqueSpeakersFromTurns,
} from "../../player/playerColumnsBins";
import {
  findActiveWordIndex,
  isWordAligned,
  karaokeVisibleRange,
  KARAOKE_VISIBLE_RADIUS,
} from "../../player/karaokeWords";
import {
  buildPauseHistogram,
  computeSpeakerStats,
} from "../../player/playerSpeakerStats";
import type { EditableSegment, EventTurnRow, QueryWindowResult } from "../../types";
import type { PlayerViewportMode } from "./playerViewportContract";

export type { PlayerViewportMode };

type Props = {
  mode: PlayerViewportMode;
  slice: QueryWindowResult | null;
  playheadMs: number;
  loading: boolean;
  /** Si défini, le parent affiche déjà l’erreur IPC. */
  queryError: string | null;
  /** Requête avec couche words (fenêtre 30s). */
  wordsLayerActive: boolean;
  /** Seek au début d’un bloc (ms) — Lanes / Chat / Mots. */
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
  updateEditorSegmentBoundary?: (
    index: number,
    edge: "start" | "end",
    value: number,
  ) => void;
  focusSegment?: (index: number) => void;
};

/**
 * Aperçu v1 Lanes / Chat (WX-624) à partir d’un `QueryWindowResult` déjà chargé.
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
      <PlayerColumnsBody slice={slice} playheadMs={playheadMs} onSeekToMs={onSeekToMs} />
    );
  }
  if (mode === "rythmo") {
    if (editMode && editorSegments) {
      return (
        <PlayerRythmoEditBody
          segments={editorSegments}
          playheadMs={playheadMs}
          activeSegmentIndex={activeSegmentIndex ?? null}
          onSeekToMs={onSeekToMs}
          onFocusSegment={focusSegment}
          onUpdateText={updateEditorSegmentText}
          followPlayhead={followPlayhead}
          durationSec={durationSec}
        />
      );
    }
    return (
      <PlayerRythmoBody
        slice={slice}
        playheadMs={playheadMs}
        onSeekToMs={onSeekToMs}
        followPlayhead={followPlayhead}
      />
    );
  }
  if (mode === "karaoke") {
    if (editMode && editorSegments) {
      return (
        <PlayerKaraokeEditBody
          segments={editorSegments}
          playheadMs={playheadMs}
          onSeekToMs={onSeekToMs}
          followPlayhead={followPlayhead}
          durationSec={durationSec}
        />
      );
    }
    return (
      <PlayerKaraokeBody
        slice={slice}
        playheadMs={playheadMs}
        wordsLayerActive={wordsLayerActive}
        onSeekToMs={onSeekToMs}
        followPlayhead={followPlayhead}
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
      />
    );
  }
  if (mode === "chat") {
    if (editMode && editorSegments) {
      return (
        <PlayerChatEditBody
          segments={editorSegments}
          playheadMs={playheadMs}
          activeSegmentIndex={activeSegmentIndex ?? null}
          onSeekToMs={onSeekToMs}
          onFocusSegment={focusSegment}
          onUpdateText={updateEditorSegmentText}
          durationSec={durationSec}
        />
      );
    }
    return <PlayerChatBody slice={slice} playheadMs={playheadMs} onSeekToMs={onSeekToMs} />;
  }
  if (mode === "stats") {
    return (
      <PlayerStatsBody
        slice={slice}
        playheadMs={playheadMs}
        durationSec={durationSec}
      />
    );
  }
  if (editMode && editorSegments && mode === "words") {
    return (
      <PlayerWordsEditBody
        segments={editorSegments}
        playheadMs={playheadMs}
        activeSegmentIndex={activeSegmentIndex ?? null}
        onSeekToMs={onSeekToMs}
        onFocusSegment={focusSegment}
        onUpdateText={updateEditorSegmentText}
        durationSec={durationSec}
      />
    );
  }
  return (
    <PlayerWordsBody
      slice={slice}
      playheadMs={playheadMs}
      wordsLayerActive={wordsLayerActive}
      onSeekToMs={onSeekToMs}
    />
  );
}

function PlayerKaraokeBody({
  slice,
  playheadMs,
  wordsLayerActive,
  onSeekToMs,
  followPlayhead,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
  followPlayhead: boolean;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const words = useMemo(
    () => [...slice.words].sort((a, b) => a.startMs - b.startMs),
    [slice.words],
  );
  const activeIdx = useMemo(() => findActiveWordIndex(words, playheadMs), [words, playheadMs]);
  const { from, to } = useMemo(
    () => karaokeVisibleRange(words.length, activeIdx, KARAOKE_VISIBLE_RADIUS),
    [words.length, activeIdx],
  );
  const visible = words.slice(from, to);
  const activeWordId = activeIdx >= 0 ? words[activeIdx]?.id : null;

  useEffect(() => {
    const el = activeRef.current;
    if (!followPlayhead || !el || typeof el.scrollIntoView !== "function") {
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      inline: "center",
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [followPlayhead, activeWordId, from, to]);

  if (!wordsLayerActive) {
    return (
      <p className="player-viewport-placeholder small">
        Active <strong>Fenêtre mots (30s)</strong> dans le panneau de gauche pour charger les tokens
        dans une fenêtre ≤ 30s (spec WX-624).
      </p>
    );
  }

  return (
    <div className="player-karaoke">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {words.length} mots · virt. ±{KARAOKE_VISIBLE_RADIUS}
        {slice.truncated.words ? " · tronqué (zoom / réduire la fenêtre)" : ""}
      </p>
      <div className="player-karaoke-now" aria-hidden="true">
        <span className="player-karaoke-now-line" />
        <span className="player-karaoke-now-label">lecture</span>
        <span className="player-karaoke-now-line" />
      </div>
      <div className="player-karaoke-strip" role="list">
        {visible.map((w, i) => {
          const idx = from + i;
          const prev = idx > 0 ? words[idx - 1] : null;
          const speaker = w.speaker?.trim() || null;
          const prevSp = prev?.speaker?.trim() || null;
          const showSpeaker = speaker !== prevSp;
          const active = idx === activeIdx && activeIdx >= 0;
          const aligned = isWordAligned(w);
          return (
            <span key={w.id} className="player-karaoke-item" role="listitem">
              {showSpeaker ? (
                <span className="player-karaoke-speaker mono small">{speaker ?? "—"}</span>
              ) : null}
              <button
                type="button"
                ref={active ? activeRef : undefined}
                className={`player-karaoke-chip${active ? " is-active" : ""}${!aligned ? " is-unaligned" : ""}`}
                title={`${w.startMs}–${w.endMs} ms${!aligned ? ` · ${w.alignmentStatus ?? "non aligné"}` : ""} — cliquer pour seek`}
                disabled={!onSeekToMs}
                onClick={() => onSeekToMs?.(w.startMs)}
              >
                {w.token?.trim() || "…"}
              </button>
            </span>
          );
        })}
      </div>
      {words.length === 0 ? (
        <p className="small">Aucun mot dans cette fenêtre — vérifie l’indexation ou zoome pour une fenêtre ≤ 30s.</p>
      ) : null}
    </div>
  );
}

type ColumnsLayoutMode = "time" | "turn";

function PlayerColumnsBody({
  slice,
  playheadMs,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const [layout, setLayout] = useState<ColumnsLayoutMode>("time");
  const [binSec, setBinSec] = useState<1 | 2 | 5>(2);

  const speakers = useMemo(() => uniqueSpeakersFromTurns(slice.turns), [slice.turns]);
  const bins = useMemo(
    () => buildTimeBins(slice.t0Ms, slice.t1Ms, binSec),
    [slice.t0Ms, slice.t1Ms, binSec],
  );
  const sortedTurns = useMemo(
    () => [...slice.turns].sort((a, b) => a.startMs - b.startMs),
    [slice.turns],
  );

  return (
    <div className="player-columns">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {slice.turns.length} tours ·{" "}
        {slice.truncated.turns ? "tronqué · " : ""}
        {layout === "time" ? `${bins.length} colonnes (${binSec}s)` : "mode Tours"}
      </p>
      <div className="player-columns-toolbar" role="toolbar" aria-label="Mode colonnes">
        <span className="small">Mode</span>
        <button
          type="button"
          className={`ghost small ${layout === "time" ? "player-columns-tool--on" : ""}`}
          onClick={() => setLayout("time")}
        >
          Temps
        </button>
        <button
          type="button"
          className={`ghost small ${layout === "turn" ? "player-columns-tool--on" : ""}`}
          onClick={() => setLayout("turn")}
        >
          Tours
        </button>
        {layout === "time" ? (
          <>
            <span className="small">Pas</span>
            {([1, 2, 5] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`ghost small ${binSec === s ? "player-columns-tool--on" : ""}`}
                onClick={() => setBinSec(s)}
              >
                {s}s
              </button>
            ))}
          </>
        ) : null}
      </div>
      {layout === "time" ? (
        <div className="player-columns-time-scroll">
          <table className="player-columns-time-table">
            <thead>
              <tr>
                <th className="player-columns-corner" scope="col" />
                {bins.map((bin) => (
                  <th key={bin.startMs} scope="col" className="mono player-columns-bin-head">
                    {formatClockSeconds(bin.startMs / 1000)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {speakers.map((sp) => (
                <tr key={sp}>
                  <th scope="row" className="player-columns-speaker">
                    {sp}
                  </th>
                  {bins.map((bin) => {
                    const inBin = turnsForSpeakerInBin(slice.turns, sp, bin.startMs, bin.endMs);
                    const first = inBin[0];
                    const playHeadHere =
                      playheadMs >= bin.startMs &&
                      playheadMs < bin.endMs &&
                      inBin.some((t) => playheadMs >= t.startMs && playheadMs < t.endMs);
                    const seekTo = first
                      ? Math.max(bin.startMs, Math.min(first.startMs, bin.endMs - 1))
                      : bin.startMs;
                    return (
                      <td key={bin.startMs} className="player-columns-td">
                        <button
                          type="button"
                          className={`player-columns-cell ${first ? "has-turn" : ""} ${playHeadHere ? "is-active" : ""}`}
                          disabled={!onSeekToMs}
                          title={
                            first
                              ? `${inBin.length} tour(s) — seek ${seekTo} ms`
                              : `Seek ${bin.startMs} ms`
                          }
                          onClick={() => onSeekToMs?.(seekTo)}
                        >
                          {first ? "●" : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="player-columns-turn-list">
          {sortedTurns.map((t) => {
            const active = playheadMs >= t.startMs && playheadMs < t.endMs;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={`player-columns-turn-row ${active ? "is-active" : ""}`}
                  disabled={!onSeekToMs}
                  onClick={() => onSeekToMs?.(t.startMs)}
                >
                  <span className="player-columns-turn-sp">{t.speaker || "—"}</span>
                  <span className="mono player-columns-turn-time">
                    {formatClockSeconds(t.startMs / 1000)} → {formatClockSeconds(t.endMs / 1000)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {layout === "time" && speakers.length === 0 ? (
        <p className="small">Aucun locuteur dans cette fenêtre.</p>
      ) : null}
      {layout === "turn" && sortedTurns.length === 0 ? (
        <p className="small">Aucun tour dans cette fenêtre.</p>
      ) : null}
    </div>
  );
}

/** WX-669 — Bande rythmo horizontale défilante (doublage style). */
function PlayerRythmoBody({
  slice,
  playheadMs,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  followPlayhead: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const ipus = useMemo(
    () => [...slice.ipus].sort((a, b) => a.startMs - b.startMs),
    [slice.ipus],
  );

  const speakerIndex = useMemo(() => {
    const speakers = Array.from(new Set(ipus.map((i) => i.speaker ?? ""))).sort();
    return new Map(speakers.map((s, idx) => [s, idx]));
  }, [ipus]);

  // 60s fills the viewport → PX_PER_MS such that 60 000 ms = containerWidth
  const PX_PER_MS = containerWidth / 60_000;
  const stripTranslateX = Math.round(containerWidth / 2 - playheadMs * PX_PER_MS);
  const stripWidth = Math.max(containerWidth, slice.t1Ms * PX_PER_MS + containerWidth / 2);

  return (
    <div className="player-rythmo">
      <PlayerRythmoScrub
        t0Ms={slice.t0Ms}
        t1Ms={slice.t1Ms}
        playheadMs={playheadMs}
        onSeekToMs={onSeekToMs}
      />
      {/* Horizontal band */}
      <div
        ref={containerRef}
        className="player-rythmo-band-viewport"
        aria-label="Bande rythmo horizontale"
      >
        {/* Fixed cursor at center */}
        <div className="player-rythmo-band-cursor" aria-hidden="true" />
        {/* Sliding strip — translates so playheadMs is always at 50% */}
        <div
          className="player-rythmo-band-strip"
          style={{ width: `${stripWidth}px`, transform: `translateX(${stripTranslateX}px)` }}
        >
          {ipus.map((ipu) => {
            const spIdx = speakerIndex.get(ipu.speaker ?? "") ?? 0;
            const blockW = Math.max(2, ipu.durMs * PX_PER_MS - 2);
            const active = playheadMs >= ipu.startMs && playheadMs < ipu.endMs;
            return (
              <button
                key={ipu.id}
                type="button"
                className={`player-rythmo-band-ipu${active ? " is-active" : ""}`}
                style={
                  {
                    left: `${ipu.startMs * PX_PER_MS}px`,
                    width: `${blockW}px`,
                    "--ipu-sp": `var(--lx-speaker-${spIdx}, var(--lx-accent))`,
                  } as CSSProperties
                }
                disabled={!onSeekToMs}
                onClick={() => onSeekToMs?.(ipu.startMs)}
                title={`${ipu.speaker ?? "?"} · ${ipu.text?.trim() ?? ""}`}
              >
                <span className="player-rythmo-band-ipu-text">{ipu.text?.trim() || "…"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {ipus.length === 0 ? <p className="small">Aucun IPU dans cette fenêtre.</p> : null}
    </div>
  );
}

/** Scrub horizontal sur la fenêtre SQLite courante [t0, t1] (WX-650 complément). */
function PlayerRythmoScrub({
  t0Ms,
  t1Ms,
  playheadMs,
  onSeekToMs,
}: {
  t0Ms: number;
  t1Ms: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const span = Math.max(1, t1Ms - t0Ms);
  const pct = (ms: number) => clampNumber(((ms - t0Ms) / span) * 100, 0, 100);

  const msFromClientX = (clientX: number) => {
    const el = barRef.current;
    if (!el) {
      return t0Ms;
    }
    const r = el.getBoundingClientRect();
    const x = clampNumber((clientX - r.left) / Math.max(1, r.width), 0, 1);
    return Math.round(t0Ms + x * span);
  };

  return (
    <div className="player-rythmo-scrub-wrap">
      <p className="player-rythmo-scrub-hint small">Scrub (fenêtre courante)</p>
      <div
        ref={barRef}
        className="player-rythmo-scrub"
        data-testid="player-rythmo-scrub"
        role="slider"
        aria-label="Scrub dans la fenêtre temporelle affichée"
        aria-valuemin={t0Ms}
        aria-valuemax={t1Ms}
        aria-valuenow={clampNumber(playheadMs, t0Ms, t1Ms)}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0 || !onSeekToMs) {
            return;
          }
          e.preventDefault();
          draggingRef.current = true;
          const el = e.currentTarget as HTMLDivElement;
          if (typeof el.setPointerCapture === "function") {
            el.setPointerCapture(e.pointerId);
          }
          onSeekToMs(msFromClientX(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current || !onSeekToMs) {
            return;
          }
          onSeekToMs(msFromClientX(e.clientX));
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          const el = e.currentTarget as HTMLDivElement;
          if (typeof el.releasePointerCapture === "function") {
            try {
              el.releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <div className="player-rythmo-scrub-fill" style={{ width: `${pct(playheadMs)}%` }} />
        <div className="player-rythmo-scrub-playhead" style={{ left: `${pct(playheadMs)}%` }} />
      </div>
    </div>
  );
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

  const durMs = durationSec != null && durationSec > 0 && Number.isFinite(durationSec) ? durationSec * 1000 : null;

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
        Vue d’ensemble — glisser pour boucle A–B · clic court pour seek
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

function turnTextFromIpus(
  turn: EventTurnRow,
  ipus: QueryWindowResult["ipus"],
): string {
  const overlapping = ipus.filter(
    (ipu) => ipu.endMs > turn.startMs && ipu.startMs < turn.endMs,
  );
  if (overlapping.length === 0) return "";
  return overlapping
    .map((ipu) => ipu.text?.trim())
    .filter(Boolean)
    .join(" ");
}

function turnTextFromSegments(
  turn: EventTurnRow,
  segments: EditableSegment[],
): string {
  const overlapping = segments.filter((seg) => {
    const sMs = Math.round(seg.start * 1000);
    const eMs = Math.round(seg.end * 1000);
    return eMs > turn.startMs && sMs < turn.endMs;
  });
  if (overlapping.length === 0) return "";
  return overlapping
    .map((seg) => seg.text?.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Pré-calcule un index ordinal turn→segment (global par ordre).
 * Fallback quand le matching temporel échoue (timestamps corrompus).
 */
function buildOrdinalSegmentIndex(
  turns: EventTurnRow[],
  segments: EditableSegment[],
): Map<number, number> {
  const result = new Map<number, number>();
  for (let i = 0; i < turns.length && i < segments.length; i++) {
    result.set(i, i);
  }
  return result;
}

function PlayerLanesBody({
  slice,
  playheadMs,
  onSeekToMs,
  durationSec,
  loopAsec,
  loopBsec,
  onSetLoopRange,
  editorSegments,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  durationSec?: number | null;
  loopAsec?: number | null;
  loopBsec?: number | null;
  onSetLoopRange?: (aSec: number, bSec: number) => void;
  editorSegments?: EditableSegment[];
}) {
  const bySpeaker = new Map<string, EventTurnRow[]>();
  for (const turn of slice.turns) {
    const sp = turn.speaker || "—";
    const list = bySpeaker.get(sp) ?? [];
    list.push(turn);
    bySpeaker.set(sp, list);
  }
  const speakers = Array.from(bySpeaker.keys()).sort();

  return (
    <div className="player-lanes">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {slice.turns.length} tours ·{" "}
        {slice.truncated.turns ? "tronqué · " : ""}
        {slice.pauses.length} pauses · {slice.ipus.length} IPU
      </p>
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
      <div className="player-lanes-grid">
        {speakers.map((sp) => {
          const spTurns = bySpeaker.get(sp) ?? [];
          const ordinalIndex = editorSegments
            ? buildOrdinalSegmentIndex(slice.turns, editorSegments)
            : null;
          return (
            <div key={sp} className="player-lanes-column">
              <div className="player-lanes-column-title">{sp}</div>
              <ul className="player-lanes-turns">
                {spTurns.map((t) => {
                  const active = playheadMs >= t.startMs && playheadMs < t.endMs;
                  let text = "";
                  if (editorSegments) {
                    text = turnTextFromSegments(t, editorSegments);
                    if (!text && ordinalIndex) {
                      const globalIdx = slice.turns.indexOf(t);
                      const segIdx = ordinalIndex.get(globalIdx);
                      if (segIdx != null && editorSegments[segIdx]) {
                        text = editorSegments[segIdx].text?.trim() || "";
                      }
                    }
                  }
                  if (!text) {
                    text = turnTextFromIpus(t, slice.ipus);
                  }
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={`player-lanes-turn ${active ? "is-active" : ""}`}
                        title={`${t.startMs}–${t.endMs} ms — cliquer pour lire depuis ce tour`}
                        disabled={!onSeekToMs}
                        onClick={() => onSeekToMs?.(t.startMs)}
                      >
                        <span className="mono player-lanes-turn-time">
                          {formatClockSeconds(t.startMs / 1000)} →{" "}
                          {formatClockSeconds(t.endMs / 1000)}
                        </span>
                        {text ? (
                          <span className="player-lanes-turn-text">{text}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {slice.turns.length === 0 ? (
        <p className="small">Aucun tour de parole dans cette fenêtre.</p>
      ) : null}
    </div>
  );
}

function PlayerWordsBody({
  slice,
  playheadMs,
  wordsLayerActive,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
}) {
  if (!wordsLayerActive) {
    return (
      <p className="player-viewport-placeholder small">
        Active <strong>Fenêtre mots (30s)</strong> dans le panneau de gauche pour charger les tokens
        dans une fenêtre ≤ 30s (spec WX-624).
      </p>
    );
  }
  return (
    <div className="player-words">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {slice.words.length} mots
        {slice.truncated.words ? " · tronqué (zoom / réduire la fenêtre)" : ""}
      </p>
      <ul className="player-words-strip">
        {slice.words.map((w) => {
          const active = playheadMs >= w.startMs && playheadMs < w.endMs;
          return (
            <li key={w.id}>
              <button
                type="button"
                className={`player-word-chip ${active ? "is-active" : ""}`}
                title={`${w.startMs}–${w.endMs} ms — cliquer pour seek`}
                disabled={!onSeekToMs}
                onClick={() => onSeekToMs?.(w.startMs)}
              >
                {w.token?.trim() || "…"}
              </button>
            </li>
          );
        })}
      </ul>
      {slice.words.length === 0 ? <p className="small">Aucun mot dans cette fenêtre.</p> : null}
    </div>
  );
}

function PlayerChatBody({
  slice,
  playheadMs,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const activeId = useMemo(() => {
    const hit = slice.ipus.find((ipu) => playheadMs >= ipu.startMs && playheadMs < ipu.endMs);
    return hit?.id ?? null;
  }, [slice.ipus, playheadMs]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  return (
    <div className="player-chat">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {slice.ipus.length} IPU
        {slice.truncated.ipus ? " · tronqué" : ""}
      </p>
      <div className="player-chat-thread" role="log">
        {slice.ipus.map((ipu) => {
          const active = playheadMs >= ipu.startMs && playheadMs < ipu.endMs;
          return (
            <button
              key={ipu.id}
              ref={active ? activeRef : undefined}
              type="button"
              className={`player-chat-bubble ${active ? "is-active" : ""}`}
              title="Cliquer pour lire depuis ce bloc"
              disabled={!onSeekToMs}
              onClick={() => onSeekToMs?.(ipu.startMs)}
            >
              <div className="player-chat-bubble-head">
                <span className="player-chat-speaker">{ipu.speaker ?? "—"}</span>
                <span className="mono small player-chat-time">
                  {formatClockSeconds(ipu.startMs / 1000)}
                </span>
              </div>
              <p className="player-chat-text">{ipu.text?.trim() || "…"}</p>
            </button>
          );
        })}
      </div>
      {slice.ipus.length === 0 ? <p className="small">Aucun IPU dans cette fenêtre.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Karaoké éditable — mots extraits des segments JSON
// ---------------------------------------------------------------------------

type KaraokeWord = {
  segIdx: number;
  wordIdx: number;
  word: string;
  speaker: string;
  startMs: number;
  endMs: number;
};

/**
 * Détecte si les timestamps des segments sont cohérents avec la durée réelle.
 * Retourne `true` si les timestamps semblent corrompus (span > 2× la durée).
 */
function areTimestampsCorrupted(segments: EditableSegment[], durationMs: number): boolean {
  if (segments.length === 0 || durationMs <= 0) return false;
  const lastEnd = Math.round(segments[segments.length - 1].end * 1000);
  const firstStart = Math.round(segments[0].start * 1000);
  const span = lastEnd - firstStart;
  return span > durationMs * 2 || firstStart > durationMs;
}

/**
 * Trouve l'index du segment correspondant au playhead.
 * Utilise le matching temporel si possible, sinon un fallback proportionnel.
 */
function findPlayheadSegment(
  segments: EditableSegment[],
  playheadMs: number,
  durationMs: number,
): number | null {
  if (segments.length === 0) return null;
  // Temporal match
  for (let i = 0; i < segments.length; i++) {
    const sMs = Math.round(segments[i].start * 1000);
    const eMs = Math.round(segments[i].end * 1000);
    if (playheadMs >= sMs && playheadMs < eMs) return i;
  }
  // Proportional fallback for corrupted timestamps
  if (durationMs > 0 && areTimestampsCorrupted(segments, durationMs)) {
    const ratio = Math.max(0, Math.min(playheadMs / durationMs, 1));
    return Math.min(Math.floor(ratio * segments.length), segments.length - 1);
  }
  return null;
}

function buildKaraokeWords(segments: EditableSegment[], durationMs: number): KaraokeWord[] {
  const result: KaraokeWord[] = [];
  if (segments.length === 0) return result;

  const corrupted = durationMs > 0 && areTimestampsCorrupted(segments, durationMs);

  // Count total words for proportional distribution when timestamps are bad
  let totalWords = 0;
  const segWordCounts: number[] = [];
  for (const seg of segments) {
    const count = seg.text.split(/\s+/).filter(Boolean).length;
    segWordCounts.push(count);
    totalWords += count;
  }
  if (totalWords === 0) return result;

  let globalWordIdx = 0;
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    for (let wi = 0; wi < words.length; wi++) {
      let wStart: number;
      let wEnd: number;

      if (corrupted) {
        wStart = Math.round((globalWordIdx / totalWords) * durationMs);
        wEnd = Math.round(((globalWordIdx + 1) / totalWords) * durationMs);
      } else {
        const segStartMs = Math.round(seg.start * 1000);
        const segEndMs = Math.round(seg.end * 1000);
        const segDurMs = segEndMs - segStartMs;
        wStart = segStartMs + Math.round((wi / words.length) * segDurMs);
        wEnd = segStartMs + Math.round(((wi + 1) / words.length) * segDurMs);
      }

      result.push({
        segIdx: si,
        wordIdx: wi,
        word: words[wi],
        speaker: seg.speaker ?? "—",
        startMs: wStart,
        endMs: wEnd,
      });
      globalWordIdx++;
    }
  }
  return result;
}

function PlayerKaraokeEditBody({
  segments,
  playheadMs,
  onSeekToMs,
  followPlayhead,
  durationSec,
}: {
  segments: EditableSegment[];
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  followPlayhead?: boolean;
  durationSec?: number | null;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const durationMs = durationSec != null && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec * 1000
    : 0;
  const words = useMemo(() => buildKaraokeWords(segments, durationMs), [segments, durationMs]);

  // Proportional fallback when temporal matching fails
  const activeIdx = useMemo(() => {
    for (let i = 0; i < words.length; i++) {
      if (playheadMs >= words[i].startMs && playheadMs < words[i].endMs) return i;
    }
    // Fallback: proportional position when durationMs is known
    if (durationMs > 0 && words.length > 0) {
      const ratio = Math.max(0, Math.min(playheadMs / durationMs, 1));
      return Math.min(Math.floor(ratio * words.length), words.length - 1);
    }
    return -1;
  }, [words, playheadMs, durationMs]);

  useEffect(() => {
    if (!followPlayhead || activeIdx < 0) return;
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [followPlayhead, activeIdx]);

  // Group words by segment for line-per-segment layout
  const segGroups = useMemo(() => {
    const groups: { segIdx: number; speaker: string; words: KaraokeWord[] }[] = [];
    let cur: { segIdx: number; speaker: string; words: KaraokeWord[] } | null = null;
    for (const w of words) {
      if (!cur || cur.segIdx !== w.segIdx) {
        cur = { segIdx: w.segIdx, speaker: w.speaker, words: [] };
        groups.push(cur);
      }
      cur.words.push(w);
    }
    return groups;
  }, [words]);

  return (
    <div className="player-karaoke player-karaoke--edit">
      <p className="player-lanes-meta small mono">
        Mode édition · {words.length} mots · {segments.length} segments
      </p>
      <div className="player-karaoke-edit-strip" role="list">
        {segGroups.map((group, gi) => {
          const prevGroup = gi > 0 ? segGroups[gi - 1] : null;
          const showSpeaker = group.speaker !== prevGroup?.speaker;
          const firstWordGlobalIdx = words.indexOf(group.words[0]);
          const lastWordGlobalIdx = firstWordGlobalIdx + group.words.length - 1;
          const lineActive = activeIdx >= firstWordGlobalIdx && activeIdx <= lastWordGlobalIdx;
          return (
            <div
              key={group.segIdx}
              className={`player-karaoke-edit-turn${lineActive ? " is-active" : ""}`}
              role="listitem"
            >
              <span
                className={`player-karaoke-edit-turn__speaker${showSpeaker ? "" : " player-karaoke-edit-turn__speaker--hidden"}`}
              >
                {group.speaker}
              </span>
              <span className="player-karaoke-edit-turn__words">
                {group.words.map((w, wi) => {
                  const globalIdx = firstWordGlobalIdx + wi;
                  const active = globalIdx === activeIdx;
                  return (
                    <button
                      key={wi}
                      type="button"
                      ref={active ? activeRef : undefined}
                      className={`player-karaoke-chip${active ? " is-active" : ""}`}
                      title={`${w.startMs}–${w.endMs} ms`}
                      disabled={!onSeekToMs}
                      onClick={() => onSeekToMs?.(w.startMs)}
                    >
                      {w.word}
                    </button>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
      {words.length === 0 ? (
        <p className="small">Aucun mot dans le transcript.</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vues éditables — segments JSON (mode édition)
// ---------------------------------------------------------------------------

type EditViewProps = {
  segments: EditableSegment[];
  playheadMs: number;
  activeSegmentIndex: number | null;
  onSeekToMs?: (ms: number) => void;
  onFocusSegment?: (index: number) => void;
  onUpdateText?: (index: number, text: string) => void;
  durationSec?: number | null;
};

function PlayerChatEditBody({
  segments,
  playheadMs,
  activeSegmentIndex,
  onFocusSegment,
  onUpdateText,
  durationSec,
}: EditViewProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const durationMs = durationSec != null && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec * 1000 : 0;
  const playheadSegIdx = useMemo(
    () => findPlayheadSegment(segments, playheadMs, durationMs),
    [segments, playheadMs, durationMs],
  );

  const scrollTarget = playheadSegIdx ?? activeSegmentIndex;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollTarget]);

  return (
    <div className="player-chat player-chat--edit">
      <p className="player-lanes-meta small mono">
        Mode édition · {segments.length} segment{segments.length === 1 ? "" : "s"}
      </p>
      <div className="player-chat-thread" role="log">
        {segments.map((seg, i) => {
          const active = playheadSegIdx === i;
          const focused = activeSegmentIndex === i;
          return (
            <div
              key={i}
              ref={active || focused ? activeRef : undefined}
              className={`player-chat-bubble player-chat-bubble--edit ${active ? "is-active" : ""} ${focused ? "is-focused" : ""}`}
              onClick={() => {
                onFocusSegment?.(i);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  onFocusSegment?.(i);
                }
              }}
            >
              <div className="player-chat-bubble-head">
                <span className="player-chat-speaker">{seg.speaker ?? "—"}</span>
                <span className="mono small player-chat-time">
                  {formatClockSeconds(seg.start)}
                </span>
              </div>
              {focused && onUpdateText ? (
                <textarea
                  className="player-chat-edit-textarea"
                  value={seg.text}
                  onChange={(e) => onUpdateText(i, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  rows={Math.max(2, Math.ceil(seg.text.length / 60))}
                />
              ) : (
                <p className="player-chat-text">{seg.text?.trim() || "…"}</p>
              )}
            </div>
          );
        })}
      </div>
      {segments.length === 0 ? <p className="small">Aucun segment dans le transcript.</p> : null}
    </div>
  );
}

function PlayerRythmoEditBody({
  segments,
  playheadMs,
  activeSegmentIndex,
  onFocusSegment,
  onUpdateText,
  followPlayhead,
  durationSec,
}: EditViewProps & { followPlayhead?: boolean }) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const durationMs = durationSec != null && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec * 1000 : 0;
  const playheadSegIdx = useMemo(
    () => findPlayheadSegment(segments, playheadMs, durationMs),
    [segments, playheadMs, durationMs],
  );

  const scrollTarget = playheadSegIdx ?? activeSegmentIndex;

  useEffect(() => {
    if (followPlayhead) {
      activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [followPlayhead, scrollTarget]);

  return (
    <div className="player-rythmo player-rythmo--edit">
      <p className="player-lanes-meta small mono">
        Mode édition · {segments.length} segment{segments.length === 1 ? "" : "s"}
      </p>
      <div className="player-rythmo-strip" role="list">
        {segments.map((seg, i) => {
          const startMs = Math.round(seg.start * 1000);
          const endMs = Math.round(seg.end * 1000);
          const active = playheadSegIdx === i;
          const focused = activeSegmentIndex === i;
          const durMs = Math.max(1, endMs - startMs);
          return (
            <div
              key={i}
              ref={active ? activeRef : undefined}
              className={`player-rythmo-band player-rythmo-band--edit ${active ? "is-active" : ""} ${focused ? "is-focused" : ""}`}
              style={{ "--rythmo-dur-factor": Math.max(0.3, durMs / 5000) } as CSSProperties}
              onClick={() => {
                onFocusSegment?.(i);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  onFocusSegment?.(i);
                }
              }}
            >
              <span className="player-rythmo-band-speaker small">{seg.speaker ?? "—"}</span>
              {focused && onUpdateText ? (
                <textarea
                  className="player-rythmo-edit-textarea"
                  value={seg.text}
                  onChange={(e) => onUpdateText(i, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  rows={2}
                />
              ) : (
                <span className="player-rythmo-band-text">{seg.text?.trim() || "…"}</span>
              )}
              <span className="player-rythmo-band-time mono small">
                {formatClockSeconds(seg.start)}–{formatClockSeconds(seg.end)}
              </span>
            </div>
          );
        })}
      </div>
      {segments.length === 0 ? <p className="small">Aucun segment.</p> : null}
    </div>
  );
}

function PlayerWordsEditBody({
  segments,
  playheadMs,
  activeSegmentIndex,
  onFocusSegment,
  onUpdateText,
  durationSec,
}: EditViewProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);
  const durationMs = durationSec != null && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec * 1000 : 0;
  const playheadSegIdx = useMemo(
    () => findPlayheadSegment(segments, playheadMs, durationMs),
    [segments, playheadMs, durationMs],
  );

  const scrollTarget = playheadSegIdx ?? activeSegmentIndex;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollTarget]);

  return (
    <div className="player-words player-words--edit">
      <p className="player-lanes-meta small mono">
        Mode édition · mots par segment
      </p>
      {segments.map((seg, i) => {
        const active = playheadSegIdx === i;
        const focused = activeSegmentIndex === i;
        const words = seg.text.split(/\s+/).filter(Boolean);
        return (
          <div
            key={i}
            ref={active || focused ? activeRef : undefined}
            className={`player-words-segment ${active ? "is-active" : ""} ${focused ? "is-focused" : ""}`}
            onClick={() => {
              onFocusSegment?.(i);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                onFocusSegment?.(i);
              }
            }}
          >
            <span className="player-words-segment-head small mono">
              {seg.speaker ?? "—"} · {formatClockSeconds(seg.start)}
            </span>
            {focused && onUpdateText ? (
              <textarea
                className="player-words-edit-textarea"
                value={seg.text}
                onChange={(e) => onUpdateText(i, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                rows={2}
              />
            ) : (
              <ul className="player-word-list">
                {words.map((w, wi) => (
                  <li key={wi}>
                    <span className="player-word-chip">{w}</span>
                  </li>
                ))}
                {words.length === 0 ? <li className="small">…</li> : null}
              </ul>
            )}
          </div>
        );
      })}
      {segments.length === 0 ? <p className="small">Aucun segment.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WX-667 — Vue statistiques prosodiques par locuteur
// ---------------------------------------------------------------------------

const STATS_HISTOGRAM_BINS = 12;
const STATS_HISTOGRAM_W = 200;
const STATS_HISTOGRAM_H = 56;

function PauseHistogramCanvas({
  durationsMs,
  activeColor,
}: {
  durationsMs: number[];
  activeColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bins = buildPauseHistogram(durationsMs, STATS_HISTOGRAM_BINS);
    const W = STATS_HISTOGRAM_W;
    const H = STATS_HISTOGRAM_H;
    ctx.clearRect(0, 0, W, H);

    if (bins.length === 0) {
      ctx.fillStyle = "#888";
      ctx.font = "10px sans-serif";
      ctx.fillText("—", 4, H / 2 + 4);
      return;
    }

    const maxCount = Math.max(...bins.map((b) => b.count), 1);
    const barW = W / bins.length;
    const pad = 1;

    for (let i = 0; i < bins.length; i++) {
      const barH = Math.round((bins[i].count / maxCount) * (H - 2));
      ctx.fillStyle = activeColor;
      ctx.fillRect(i * barW + pad, H - barH, barW - pad * 2, barH);
    }
  }, [durationsMs, activeColor]);

  return (
    <canvas
      ref={canvasRef}
      width={STATS_HISTOGRAM_W}
      height={STATS_HISTOGRAM_H}
      className="stats-histogram-canvas"
      title="Distribution durées de pauses"
    />
  );
}

function PlayerStatsBody({
  slice,
  playheadMs,
  durationSec,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  durationSec?: number | null;
}) {
  const totalDurationMs =
    durationSec != null && Number.isFinite(durationSec) ? durationSec * 1000 : undefined;

  const stats = useMemo(
    () => computeSpeakerStats(slice.turns, slice.pauses, slice.ipus, totalDurationMs),
    [slice.turns, slice.pauses, slice.ipus, totalDurationMs],
  );

  const activeSpeaker = useMemo(() => {
    const activeTurn = slice.turns.find(
      (t) => playheadMs >= t.startMs && playheadMs < t.endMs,
    );
    return activeTurn?.speaker ?? null;
  }, [slice.turns, playheadMs]);

  if (stats.length === 0) {
    return (
      <p className="player-viewport-placeholder small">
        Aucune donnée de locuteurs disponible dans ce run.
      </p>
    );
  }

  return (
    <div className="player-stats-body">
      <p className="player-stats-header small">
        Statistiques prosodiques — {stats.length} locuteur(s)
        {durationSec != null ? ` · durée totale ${Math.round(durationSec)}s` : ""}
      </p>
      <div className="player-stats-grid">
        {stats.map((s) => {
          const isActive = s.speaker === activeSpeaker;
          return (
            <div
              key={s.speaker}
              className={`player-stats-card${isActive ? " is-active" : ""}`}
              aria-current={isActive ? "true" : undefined}
            >
              <div className="player-stats-card-header">
                <span className="player-stats-speaker">{s.speaker}</span>
                {isActive && <span className="player-stats-active-badge">en cours</span>}
              </div>
              <dl className="player-stats-dl">
                <dt>Parole</dt>
                <dd>{formatClockSeconds(s.speechMs / 1000)}</dd>
                <dt>Ratio p/s</dt>
                <dd>{(s.speechRatio * 100).toFixed(1)} %</dd>
                <dt>IPU</dt>
                <dd>{s.nIpus}</dd>
                <dt>Mots</dt>
                <dd>{s.nWords}</dd>
                <dt>Débit</dt>
                <dd>{s.speechRateWordsPerSec.toFixed(1)} mots/s</dd>
                <dt>Pauses</dt>
                <dd>{s.nPauses}</dd>
                <dt>Pause moy.</dt>
                <dd>{s.meanPauseDurMs > 0 ? `${Math.round(s.meanPauseDurMs)} ms` : "—"}</dd>
              </dl>
              {s.nPauses > 0 && (
                <div className="player-stats-histogram">
                  <p className="player-stats-histogram-label small">
                    Distribution pauses ({s.nPauses})
                  </p>
                  <PauseHistogramCanvas
                    durationsMs={s.pauseDurationsMs}
                    activeColor={isActive ? "var(--lx-accent)" : "var(--lx-text-2)"}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
