import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampNumber, formatClockSeconds } from "../../appUtils";
import {
  buildTimeBins,
  turnsForSpeakerInBin,
  uniqueSpeakersFromTurns,
} from "../../player/playerColumnsBins";
import { isWordAligned } from "../../player/karaokeWords";
import {
  buildPauseHistogram,
  buildSpeechTimeline,
  computeOverlaps as computeTurnOverlaps,
  computeSpeakerStats,
  computeSpeechDensity,
  computeSpeechRate,
  computeTransitions,
  percentile,
} from "../../player/playerSpeakerStats";
import type {
  DensityPoint,
  SpeechRateSeries,
  TimelineSegment,
} from "../../player/playerSpeakerStats";
import type {
  EditableSegment,
  EventIpuRow,
  EventPauseRow,
  EventTurnRow,
  QueryWindowResult,
} from "../../types";
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

function buildKaraokeSegments(
  slice: QueryWindowResult,
): KaraokeSegment[] {
  const ipus = [...slice.ipus].sort((a, b) => a.startMs - b.startMs);
  const words = [...slice.words].sort((a, b) => a.startMs - b.startMs);
  const pauses = slice.pauses;
  const turns = slice.turns;

  const result: KaraokeSegment[] = [];
  for (let ii = 0; ii < ipus.length; ii++) {
    const ipu = ipus[ii];
    const sp = ipu.speaker?.trim() || "\u2014";
    const segWords = words.filter(
      (w) => w.startMs >= ipu.startMs && w.endMs <= ipu.endMs + 50,
    );
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
        if (oEnd - oStart > 50) { hasOverlap = true; break; }
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

const KARAOKE_SEG_WINDOW = 300;

function PlayerKaraokeBody({
  slice,
  playheadMs,
  wordsLayerActive,
  onSeekToMs,
  followPlayhead,
  editMode = false,
  editorSegments,
  activeSegmentIndex,
  onFocusSegment,
  onUpdateText,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
  followPlayhead: boolean;
  editMode?: boolean;
  editorSegments?: EditableSegment[];
  activeSegmentIndex?: number | null;
  onFocusSegment?: (index: number) => void;
  onUpdateText?: (index: number, text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeSegRef = useRef<HTMLDivElement | null>(null);
  const [followActive, setFollowActive] = useState(true);
  const [editingIpuId, setEditingIpuId] = useState<number | null>(null);
  const programmaticScrollRef = useRef(false);

  const allSegments = useMemo(() => buildKaraokeSegments(slice), [slice]);

  const activeSegIdx = useMemo(() => {
    for (let i = 0; i < allSegments.length; i++) {
      if (playheadMs >= allSegments[i].startMs && playheadMs < allSegments[i].endMs) return i;
    }
    let best = -1;
    for (let i = 0; i < allSegments.length; i++) {
      if (allSegments[i].startMs <= playheadMs) best = i;
    }
    return best;
  }, [allSegments, playheadMs]);

  const visibleSegments = useMemo(() => {
    if (allSegments.length <= KARAOKE_SEG_WINDOW) return allSegments;
    const center = activeSegIdx >= 0 ? activeSegIdx : 0;
    const half = Math.floor(KARAOKE_SEG_WINDOW / 2);
    const from = Math.max(0, center - half);
    const to = Math.min(allSegments.length, from + KARAOKE_SEG_WINDOW);
    return allSegments.slice(from, to);
  }, [allSegments, activeSegIdx]);

  const activeWordId = useMemo(() => {
    if (activeSegIdx < 0) return -1;
    const seg = allSegments[activeSegIdx];
    for (const w of seg.words) {
      if (playheadMs >= w.startMs && playheadMs < w.endMs) return w.id;
    }
    return -1;
  }, [allSegments, activeSegIdx, playheadMs]);

  useEffect(() => {
    if (!followPlayhead || !followActive || activeSegIdx < 0) return;
    const el = activeSegRef.current;
    const container = scrollRef.current;
    if (!el || !container || typeof container.scrollTo !== "function") return;
    programmaticScrollRef.current = true;
    const containerH = container.clientHeight;
    const elTop = el.offsetTop;
    const targetScroll = elTop - containerH * 0.33;
    container.scrollTo({ top: targetScroll, behavior: "smooth" });
    const tid = window.setTimeout(() => { programmaticScrollRef.current = false; }, 400);
    return () => window.clearTimeout(tid);
  }, [followPlayhead, followActive, activeSegIdx]);

  const handleScroll = () => {
    if (programmaticScrollRef.current) return;
    if (followActive) setFollowActive(false);
  };

  if (!wordsLayerActive) {
    return (
      <p className="player-viewport-placeholder small">
        Active <strong>Charger les mots</strong> dans le panneau de gauche pour afficher la vue Karaoké.
      </p>
    );
  }

  const speakers = Array.from(new Set(allSegments.map((s) => s.speaker)));

  return (
    <div className="karaoke-v2" aria-label="Vue karaoké">
      <div className="karaoke-v2-header">
        <span className="karaoke-v2-header-info small mono">
          {allSegments.length} segments · {speakers.length} loc.
          {slice.truncated.ipus ? " \u00b7 tronqué" : ""}
        </span>
        {!followActive && (
          <button
            type="button"
            className="karaoke-v2-follow-btn small"
            onClick={() => setFollowActive(true)}
          >
            Reprendre le suivi
          </button>
        )}
      </div>

      <div className="karaoke-v2-scroll" ref={scrollRef} onScroll={handleScroll} role="list">
        {visibleSegments.map((seg) => {
          const si = allSegments.indexOf(seg);
          const isActive = si === activeSegIdx;
          const isPast = activeSegIdx >= 0 && si < activeSegIdx;

          const segIdx = editMode && editorSegments
            ? (() => {
              for (let i = 0; i < editorSegments.length; i++) {
                const sMs = Math.round(editorSegments[i].start * 1000);
                const eMs = Math.round(editorSegments[i].end * 1000);
                if (eMs > seg.startMs && sMs < seg.endMs) return i;
              }
              return null;
            })()
            : null;
          const isEditingThis = editMode && editingIpuId === seg.ipuId;
          const isFocused = editMode && segIdx != null && activeSegmentIndex === segIdx;

          let cls = "karaoke-v2-seg";
          if (isActive) cls += " is-active";
          else if (isPast) cls += " is-past";
          if (isFocused) cls += " is-focused";

          const handleDoubleClick = () => {
            if (!editMode || segIdx == null) return;
            onFocusSegment?.(segIdx);
            setEditingIpuId(seg.ipuId);
          };

          return (
            <div
              key={seg.ipuId}
              ref={isActive ? activeSegRef : undefined}
              className={cls}
              role="listitem"
              onDoubleClick={handleDoubleClick}
            >
              <div className="karaoke-v2-seg-left">
                <span className="karaoke-v2-speaker mono">{seg.speaker}</span>
                <span className="karaoke-v2-time mono">
                  {formatClockSeconds(seg.startMs / 1000)}
                </span>
              </div>

              <div className="karaoke-v2-seg-body">
                {isEditingThis && segIdx != null && onUpdateText ? (
                  <textarea
                    className="player-inline-edit-textarea"
                    value={editorSegments![segIdx].text}
                    onChange={(ev) => onUpdateText(segIdx, ev.target.value)}
                    onBlur={() => setEditingIpuId(null)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); setEditingIpuId(null); }
                      if (ev.key === "Escape") setEditingIpuId(null);
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    autoFocus
                    rows={Math.max(2, Math.ceil((editorSegments![segIdx].text.length || 1) / 60))}
                  />
                ) : seg.words.length > 0 ? (
                  <span className="karaoke-v2-seg-words">
                    {seg.words.map((w) => {
                      const wActive = w.id === activeWordId;
                      let wCls = "karaoke-v2-word";
                      if (wActive) wCls += " is-active";
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
                    className="karaoke-v2-seg-text"
                    disabled={!onSeekToMs}
                    onClick={() => onSeekToMs?.(seg.startMs)}
                  >
                    {seg.text || "\u2026"}
                  </button>
                )}
              </div>

              <div className="karaoke-v2-seg-right">
                {seg.pauseBefore != null && (
                  <span className="karaoke-v2-badge karaoke-v2-badge--pause" title={`Pause ${seg.pauseBefore} ms`}>
                    ⏸ {(seg.pauseBefore / 1000).toFixed(1)}s
                  </span>
                )}
                {seg.hasOverlap && (
                  <span className="karaoke-v2-badge karaoke-v2-badge--overlap" title="Chevauchement">
                    ⟷
                  </span>
                )}
                {seg.hasUnaligned && (
                  <span className="karaoke-v2-badge karaoke-v2-badge--unaligned" title="Mots interpolés">
                    ≈
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {allSegments.length === 0 && (
          <p className="small player-empty-message">Aucun segment dans cette fenêtre.</p>
        )}
      </div>
    </div>
  );
}


type ColumnsLayoutMode = "time" | "turn";

function PlayerColumnsBody({
  slice,
  playheadMs,
  onSeekToMs,
  editMode = false,
  editorSegments,
  activeSegmentIndex,
  onFocusSegment,
  onUpdateText,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  editMode?: boolean;
  editorSegments?: EditableSegment[];
  activeSegmentIndex?: number | null;
  onFocusSegment?: (index: number) => void;
  onUpdateText?: (index: number, text: string) => void;
}) {
  const [layout, setLayout] = useState<ColumnsLayoutMode>("time");
  const [binSec, setBinSec] = useState<1 | 2 | 5>(2);
  const [editingTurnId, setEditingTurnId] = useState<number | null>(null);

  const speakers = useMemo(() => uniqueSpeakersFromTurns(slice.turns), [slice.turns]);
  const bins = useMemo(
    () => buildTimeBins(slice.t0Ms, slice.t1Ms, binSec),
    [slice.t0Ms, slice.t1Ms, binSec],
  );
  const sortedTurns = useMemo(
    () => [...slice.turns].sort((a, b) => a.startMs - b.startMs),
    [slice.turns],
  );

  const ordinalIndex = useMemo(
    () => (editorSegments ? buildOrdinalSegmentIndex(slice.turns, editorSegments) : null),
    [slice.turns, editorSegments],
  );

  const turnTextCache = useMemo(() => {
    const cache = new Map<number, string>();
    for (const t of slice.turns) {
      let text = turnTextFromIpus(t, slice.ipus);
      if (!text && editorSegments) {
        text = turnTextFromSegments(t, editorSegments);
      }
      cache.set(t.id, text);
    }
    return cache;
  }, [slice.turns, slice.ipus, editorSegments]);

  const activeIndex = useMemo(() => {
    for (let i = sortedTurns.length - 1; i >= 0; i--) {
      if (playheadMs >= sortedTurns[i].startMs && playheadMs < sortedTurns[i].endMs) return i;
    }
    return -1;
  }, [sortedTurns, playheadMs]);

  return (
    <div className="player-columns">
      <div className="player-columns-header">
        <span className="player-columns-meta small mono">
          {slice.turns.length} tours · {speakers.length} loc.
          {slice.truncated.turns ? " · tronqué" : ""}
          {layout === "time" ? ` · ${bins.length} col. (${binSec}s)` : ""}
        </span>
        <div className="player-columns-toolbar" role="toolbar" aria-label="Mode colonnes">
          <div className="player-lanes-mode-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={layout === "time"}
              className={`player-lanes-mode-btn small${layout === "time" ? " is-active" : ""}`}
              onClick={() => setLayout("time")}
            >
              Grille
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={layout === "turn"}
              className={`player-lanes-mode-btn small${layout === "turn" ? " is-active" : ""}`}
              onClick={() => setLayout("turn")}
            >
              Tours
            </button>
          </div>
          {layout === "time" && (
            <div className="player-lanes-mode-toggle" role="tablist">
              {([1, 2, 5] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={binSec === s}
                  className={`player-lanes-mode-btn small${binSec === s ? " is-active" : ""}`}
                  onClick={() => setBinSec(s)}
                >
                  {s}s
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="player-columns-scroll">
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
                {speakers.map((sp) => {
                  const spIdx = speakers.indexOf(sp);
                  return (
                    <tr key={sp}>
                      <th
                        scope="row"
                        className="player-columns-speaker mono"
                        style={{ color: speakerColor(spIdx) }}
                      >
                        {sp}
                      </th>
                      {bins.map((bin) => {
                        const inBin = turnsForSpeakerInBin(slice.turns, sp, bin.startMs, bin.endMs);
                        const first = inBin[0];
                        const playHeadHere =
                          playheadMs >= bin.startMs &&
                          playheadMs < bin.endMs &&
                          inBin.some((t) => playheadMs >= t.startMs && playheadMs < t.endMs);
                        const isPast =
                          activeIndex >= 0 && bin.endMs <= playheadMs && !playHeadHere;
                        const seekTo = first
                          ? Math.max(bin.startMs, Math.min(first.startMs, bin.endMs - 1))
                          : bin.startMs;
                        const preview = first ? (turnTextCache.get(first.id) ?? "").slice(0, 30) : "";

                        let cellCls = "player-columns-cell";
                        if (first) cellCls += " has-turn";
                        if (playHeadHere) cellCls += " is-active";
                        else if (isPast) cellCls += " is-past";

                        return (
                          <td key={bin.startMs} className="player-columns-td">
                            <button
                              type="button"
                              className={cellCls}
                              disabled={!onSeekToMs}
                              title={
                                first
                                  ? `${inBin.length} tour(s) · ${preview || "…"}`
                                  : `Seek ${formatClockSeconds(bin.startMs / 1000)}`
                              }
                              onClick={() => onSeekToMs?.(seekTo)}
                            >
                              {first ? (
                                <span className="player-columns-cell-content">
                                  {inBin.length > 1 ? `${inBin.length}×` : preview ? preview.split(" ").slice(0, 3).join(" ") : "●"}
                                </span>
                              ) : ""}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="player-columns-turn-grid">
            {sortedTurns.map((t, i) => {
              const isActive = i === activeIndex;
              const isPast = activeIndex >= 0 && i < activeIndex;
              const spIdx = speakers.indexOf(t.speaker || "\u2014");
              const text = turnTextCache.get(t.id) ?? "";
              const durMs = t.endMs - t.startMs;
              const isEditingThis = editMode && editingTurnId === t.id;
              const segIdx = editMode && editorSegments
                ? findSegmentIndexForTurn(t, editorSegments, ordinalIndex, slice.turns)
                : null;
              const isFocused = editMode && segIdx != null && activeSegmentIndex === segIdx;

              let cls = "player-columns-turn-card";
              if (isActive) cls += " is-active";
              else if (isPast) cls += " is-past";
              if (isFocused) cls += " is-focused";

              const handleDoubleClick = () => {
                if (!editMode || segIdx == null) return;
                onFocusSegment?.(segIdx);
                setEditingTurnId(t.id);
              };

              return (
                <button
                  key={t.id}
                  type="button"
                  className={cls}
                  disabled={!onSeekToMs}
                  onClick={() => onSeekToMs?.(t.startMs)}
                  onDoubleClick={handleDoubleClick}
                  title={`${formatClockSeconds(t.startMs / 1000)} – ${formatClockSeconds(t.endMs / 1000)} · cliquer pour lire`}
                >
                  <span className="player-columns-turn-sp mono" style={{ color: speakerColor(spIdx) }}>
                    {t.speaker || "\u2014"}
                  </span>
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
                    <span className="player-columns-turn-text">{text || "\u2026"}</span>
                  )}
                  <span className="player-columns-turn-info mono">
                    <span>{formatClockSeconds(t.startMs / 1000)}</span>
                    <span className="player-columns-turn-dur">
                      {durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : `${Math.round(durMs)}ms`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {layout === "time" && speakers.length === 0 && (
          <p className="small player-empty-message">Aucun locuteur dans cette fenêtre.</p>
        )}
        {layout === "turn" && sortedTurns.length === 0 && (
          <p className="small player-empty-message">Aucun tour dans cette fenêtre.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rythmo view — bande horizontale multi-lanes, défilement continu (WX-669)
// ---------------------------------------------------------------------------

type RythmoWordTimed = {
  word: string;
  offsetPct: number;
};

type RythmoBlock = {
  id: string;
  startMs: number;
  endMs: number;
  durMs: number;
  speaker: string;
  text: string;
  segIdx?: number;
  isWord?: boolean;
  timedWords?: RythmoWordTimed[];
};

const RYTHMO_ZOOM_PRESETS = [1, 2, 3, 4, 5, 10, 30, 60] as const;
type RythmoZoomSec = (typeof RYTHMO_ZOOM_PRESETS)[number];
const RYTHMO_TIMESCALE_HEIGHT = 18;

function buildTimedWords(
  blockStartMs: number,
  blockDurMs: number,
  words: { word: string; start: number; end: number }[] | undefined,
  plainText: string,
): RythmoWordTimed[] | undefined {
  if (blockDurMs <= 0) return undefined;
  if (words && words.length > 0) {
    return words.map((w) => ({
      word: w.word,
      offsetPct: Math.max(0, Math.min(100, ((Math.round(w.start * 1000) - blockStartMs) / blockDurMs) * 100)),
    }));
  }
  const tokens = plainText.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  return tokens.map((t, i) => ({
    word: t,
    offsetPct: (i / tokens.length) * 100,
  }));
}

function buildRythmoBlocks(
  ipus: EventIpuRow[],
  editorSegments: EditableSegment[] | undefined,
  editMode: boolean,
  wordLevel: boolean,
): RythmoBlock[] {
  if (editMode && editorSegments && editorSegments.length > 0) {
    if (wordLevel) return explodeSegmentsToWords(editorSegments);
    return editorSegments.map((seg, i) => {
      const startMs = Math.round(seg.start * 1000);
      const endMs = Math.round(seg.end * 1000);
      const durMs = Math.max(1, endMs - startMs);
      return {
        id: `seg-${i}`,
        startMs,
        endMs,
        durMs,
        speaker: seg.speaker ?? "",
        text: seg.text.trim(),
        segIdx: i,
        timedWords: buildTimedWords(startMs, durMs, seg.words ?? undefined, seg.text),
      };
    });
  }
  if (wordLevel) return explodeIpusToWords(ipus);
  return ipus.map((ipu) => {
    const text = ipu.text?.trim() ?? "";
    return {
      id: `ipu-${ipu.id}`,
      startMs: ipu.startMs,
      endMs: ipu.endMs,
      durMs: ipu.durMs,
      speaker: ipu.speaker ?? "",
      text,
      timedWords: buildTimedWords(ipu.startMs, ipu.durMs, undefined, text),
    };
  });
}

function explodeSegmentsToWords(segments: EditableSegment[]): RythmoBlock[] {
  const result: RythmoBlock[] = [];
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const segStartMs = Math.round(seg.start * 1000);
    const segEndMs = Math.round(seg.end * 1000);
    const segDurMs = segEndMs - segStartMs;
    const speaker = seg.speaker ?? "";

    if (seg.words && seg.words.length > 0) {
      for (let wi = 0; wi < seg.words.length; wi++) {
        const w = seg.words[wi];
        const wStart = Math.round(w.start * 1000);
        const wEnd = Math.round(w.end * 1000);
        result.push({
          id: `sw-${si}-${wi}`,
          startMs: wStart,
          endMs: wEnd,
          durMs: Math.max(1, wEnd - wStart),
          speaker,
          text: w.word,
          segIdx: si,
          isWord: true,
        });
      }
    } else {
      const textWords = seg.text.trim().split(/\s+/).filter(Boolean);
      if (textWords.length === 0) continue;
      for (let wi = 0; wi < textWords.length; wi++) {
        const wStart = segStartMs + Math.round((wi / textWords.length) * segDurMs);
        const wEnd = segStartMs + Math.round(((wi + 1) / textWords.length) * segDurMs);
        result.push({
          id: `sw-${si}-${wi}`,
          startMs: wStart,
          endMs: wEnd,
          durMs: Math.max(1, wEnd - wStart),
          speaker,
          text: textWords[wi],
          segIdx: si,
          isWord: true,
        });
      }
    }
  }
  return result;
}

function explodeIpusToWords(ipus: EventIpuRow[]): RythmoBlock[] {
  const result: RythmoBlock[] = [];
  for (const ipu of ipus) {
    const textWords = (ipu.text?.trim() ?? "").split(/\s+/).filter(Boolean);
    if (textWords.length === 0) continue;
    const speaker = ipu.speaker ?? "";
    for (let wi = 0; wi < textWords.length; wi++) {
      const wStart = ipu.startMs + Math.round((wi / textWords.length) * ipu.durMs);
      const wEnd = ipu.startMs + Math.round(((wi + 1) / textWords.length) * ipu.durMs);
      result.push({
        id: `iw-${ipu.id}-${wi}`,
        startMs: wStart,
        endMs: wEnd,
        durMs: Math.max(1, wEnd - wStart),
        speaker,
        text: textWords[wi],
        isWord: true,
      });
    }
  }
  return result;
}

function computeOverlaps(
  blocks: RythmoBlock[],
  speakers: string[],
): { startMs: number; endMs: number }[] {
  if (speakers.length < 2) return [];
  const result: { startMs: number; endMs: number }[] = [];
  const bySpeaker = new Map<string, RythmoBlock[]>();
  for (const b of blocks) {
    const arr = bySpeaker.get(b.speaker) ?? [];
    arr.push(b);
    bySpeaker.set(b.speaker, arr);
  }
  const allSpeakers = Array.from(bySpeaker.keys());
  for (let si = 0; si < allSpeakers.length; si++) {
    const blocksA = bySpeaker.get(allSpeakers[si]) ?? [];
    for (let sj = si + 1; sj < allSpeakers.length; sj++) {
      const blocksB = bySpeaker.get(allSpeakers[sj]) ?? [];
      for (const a of blocksA) {
        for (const b of blocksB) {
          const oStart = Math.max(a.startMs, b.startMs);
          const oEnd = Math.min(a.endMs, b.endMs);
          if (oEnd > oStart) result.push({ startMs: oStart, endMs: oEnd });
        }
      }
    }
  }
  result.sort((a, b) => a.startMs - b.startMs);
  return result;
}

function rythmoTimeTicks(
  playheadMs: number,
  visibleMs: number,
): { posMs: number; label: string }[] {
  const halfMs = visibleMs / 2;
  const startMs = playheadMs - halfMs;
  const endMs = playheadMs + halfMs;
  let step: number;
  if (visibleMs <= 1_500) step = 200;
  else if (visibleMs <= 3_000) step = 500;
  else if (visibleMs <= 10_000) step = 1_000;
  else if (visibleMs <= 30_000) step = 5_000;
  else step = 10_000;
  const firstTick = Math.ceil(startMs / step) * step;
  const ticks: { posMs: number; label: string }[] = [];
  for (let ms = firstTick; ms <= endMs; ms += step) {
    if (ms < 0) continue;
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const label = step < 1000
      ? `${min}:${sec.toFixed(1).padStart(4, "0")}`
      : `${min}:${Math.floor(sec).toString().padStart(2, "0")}`;
    ticks.push({ posMs: ms, label });
  }
  return ticks;
}

function PlayerRythmoView({
  slice,
  playheadMs,
  onSeekToMs,
  editMode = false,
  editorSegments,
  onFocusSegment,
  onUpdateText,
  durationSec,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  followPlayhead?: boolean;
  editMode?: boolean;
  editorSegments?: EditableSegment[];
  activeSegmentIndex?: number | null;
  onFocusSegment?: (i: number) => void;
  onUpdateText?: (i: number, text: string) => void;
  durationSec?: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [zoomSec, setZoomSec] = useState<RythmoZoomSec>(30);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startPlayheadMs: number } | null>(null);
  const [dragOffsetMs, setDragOffsetMs] = useState(0);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

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

  const wordLevel = false;
  const blocks = useMemo(
    () => buildRythmoBlocks(slice.ipus, editorSegments, editMode, wordLevel),
    [slice.ipus, editorSegments, editMode, wordLevel],
  );

  const speakers = useMemo(() => {
    const set = new Set(blocks.map((b) => b.speaker));
    return Array.from(set).sort();
  }, [blocks]);

  const speakerIdx = useMemo(
    () => new Map(speakers.map((s, i) => [s, i])),
    [speakers],
  );

  const overlaps = useMemo(
    () => computeOverlaps(blocks, speakers),
    [blocks, speakers],
  );

  const pauses: EventPauseRow[] = slice.pauses ?? [];

  const visibleMs = zoomSec * 1000;
  const pxPerMs = containerWidth / visibleMs;
  const effectivePlayheadMs = dragging ? playheadMs + dragOffsetMs : playheadMs;
  const stripTranslateX = Math.round(containerWidth / 2 - effectivePlayheadMs * pxPerMs);
  const totalMs = durationSec != null && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec * 1000
    : Math.max(slice.t1Ms, ...blocks.map((b) => b.endMs));
  const stripWidth = Math.max(containerWidth, totalMs * pxPerMs + containerWidth);

  const ticks = useMemo(
    () => rythmoTimeTicks(effectivePlayheadMs, visibleMs),
    [effectivePlayheadMs, visibleMs],
  );

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const idx = RYTHMO_ZOOM_PRESETS.indexOf(zoomSec);
    if (e.deltaY < 0 && idx > 0) setZoomSec(RYTHMO_ZOOM_PRESETS[idx - 1]);
    else if (e.deltaY > 0 && idx < RYTHMO_ZOOM_PRESETS.length - 1) setZoomSec(RYTHMO_ZOOM_PRESETS[idx + 1]);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".player-rythmo-v2-block")) return;
    dragRef.current = { startX: e.clientX, startPlayheadMs: playheadMs };
    setDragging(true);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const deltaMs = -dx / pxPerMs;
    setDragOffsetMs(deltaMs);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const deltaMs = -dx / pxPerMs;
    if (Math.abs(dx) > 4 && onSeekToMs) {
      onSeekToMs(Math.round(dragRef.current.startPlayheadMs + deltaMs));
    }
    dragRef.current = null;
    setDragging(false);
    setDragOffsetMs(0);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
  };

  const handleBlockClick = (block: RythmoBlock) => {
    if (editMode && block.segIdx != null) {
      onFocusSegment?.(block.segIdx);
      setFocusedBlockId(block.id);
    } else {
      onSeekToMs?.(block.startMs);
    }
  };

  const handleBlockDoubleClick = (block: RythmoBlock) => {
    if (editMode && block.segIdx != null) {
      onFocusSegment?.(block.segIdx);
      setFocusedBlockId(block.id);
    }
  };

  const laneHeight = zoomSec <= 2 ? 220
    : zoomSec <= 3 ? 190
    : zoomSec <= 4 ? 170
    : zoomSec <= 5 ? 160
    : zoomSec <= 10 ? 130
    : zoomSec <= 30 ? 220
    : 280;
  const viewportHeight = speakers.length * laneHeight + RYTHMO_TIMESCALE_HEIGHT + 8;

  const halfVis = visibleMs / 2;
  const visStartMs = effectivePlayheadMs - halfVis;
  const visEndMs = effectivePlayheadMs + halfVis;

  return (
    <div className="player-rythmo-v2">
      <div className="player-rythmo-v2-toolbar">
        <span className="player-rythmo-v2-toolbar-label small mono">
          {formatClockSeconds(effectivePlayheadMs / 1000)}
        </span>
        <span className="player-rythmo-v2-zoom-group" role="group" aria-label="Zoom">
          {RYTHMO_ZOOM_PRESETS.map((z) => (
            <button
              key={z}
              type="button"
              className={`player-rythmo-v2-zoom-btn small${z === zoomSec ? " is-active" : ""}`}
              onClick={() => setZoomSec(z)}
            >
              {z}s
            </button>
          ))}
        </span>
        <span className="player-rythmo-v2-toolbar-info small mono">
          {speakers.length} loc. · {blocks.length} {wordLevel ? "mots" : "blocs"}
        </span>
      </div>

      <div
        ref={containerRef}
        className={`player-rythmo-v2-viewport${editMode ? " player-rythmo-v2-viewport--edit" : ""}`}
        style={{ height: `${viewportHeight}px` }}
        data-zoom={zoomSec}
        aria-label="Bande rythmo multi-lanes"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; setDragging(false); setDragOffsetMs(0); }}
      >
        {/* Reading zone — subtle highlight around NOW */}
        <div className="player-rythmo-v2-reading-zone" aria-hidden="true" />
        {/* NOW cursor */}
        <div className="player-rythmo-v2-now" aria-hidden="true" />

        {/* Timescale ticks */}
        <div
          className="player-rythmo-v2-timescale"
          style={{ transform: `translateX(${stripTranslateX}px)`, width: `${stripWidth}px` }}
        >
          {ticks.map((t) => (
            <span
              key={t.posMs}
              className="player-rythmo-v2-tick"
              style={{ left: `${t.posMs * pxPerMs}px` }}
            >
              {t.label}
            </span>
          ))}
        </div>

        {/* Overlap bands (behind lanes) */}
        <div
          className="player-rythmo-v2-overlap-layer"
          style={{ transform: `translateX(${stripTranslateX}px)`, width: `${stripWidth}px` }}
        >
          {overlaps.map((ov, oi) => {
            if (ov.endMs < visStartMs || ov.startMs > visEndMs) return null;
            return (
              <div
                key={oi}
                className="player-rythmo-v2-overlap-band"
                style={{
                  left: `${ov.startMs * pxPerMs}px`,
                  width: `${Math.max(2, (ov.endMs - ov.startMs) * pxPerMs)}px`,
                  top: `${RYTHMO_TIMESCALE_HEIGHT}px`,
                  height: `${speakers.length * laneHeight}px`,
                }}
              />
            );
          })}
        </div>

        {/* Speaker lanes */}
        {speakers.map((sp, si) => {
          const laneBlocks = blocks.filter((b) => b.speaker === sp);
          const lanePauses = pauses.filter((p) => (p.speaker ?? "") === sp || (!p.speaker && speakers.length === 1));
          return (
            <div
              key={sp}
              className="player-rythmo-v2-lane"
              style={{
                top: `${RYTHMO_TIMESCALE_HEIGHT + si * laneHeight}px`,
                height: `${laneHeight}px`,
              }}
              data-speaker={sp}
            >
              <span className="player-rythmo-v2-lane-label small mono">{sp || "?"}</span>
              <div
                className="player-rythmo-v2-lane-strip"
                style={{ transform: `translateX(${stripTranslateX}px)`, width: `${stripWidth}px` }}
              >
                {/* Pause markers */}
                {lanePauses.map((p) => {
                  if (p.endMs < visStartMs || p.startMs > visEndMs) return null;
                  const pw = Math.max(2, (p.endMs - p.startMs) * pxPerMs);
                  return (
                    <span
                      key={`p-${p.id}`}
                      className="player-rythmo-v2-pause"
                      style={{ left: `${p.startMs * pxPerMs}px`, width: `${pw}px` }}
                      title={`Pause ${p.durMs} ms`}
                    >
                      {pw > 28 ? <span className="player-rythmo-v2-pause-label">{(p.durMs / 1000).toFixed(1)}</span> : null}
                    </span>
                  );
                })}

                {/* Blocks */}
                {laneBlocks.map((block) => {
                  if (block.endMs < visStartMs || block.startMs > visEndMs) return null;
                  const active = playheadMs >= block.startMs && playheadMs < block.endMs;
                  const focused = editMode && focusedBlockId === block.id;
                  const isEditing = focused && block.segIdx != null && onUpdateText;
                  const blockW = Math.max(4, block.durMs * pxPerMs - 2);
                  const spI = speakerIdx.get(block.speaker) ?? 0;

                  return (
                    <div
                      key={block.id}
                      className={`player-rythmo-v2-block${block.isWord ? " is-word" : ""}${active ? " is-active" : ""}${focused ? " is-focused" : ""}`}
                      style={{
                        left: `${block.startMs * pxPerMs}px`,
                        width: `${blockW}px`,
                        "--rythmo-sp": `var(--lx-speaker-${spI}, var(--lx-accent))`,
                      } as CSSProperties}
                      onClick={(e) => { e.stopPropagation(); handleBlockClick(block); }}
                      onDoubleClick={(e) => { e.stopPropagation(); handleBlockDoubleClick(block); }}
                      title={`${block.speaker || "?"} · ${block.text || "…"}`}
                      role="button"
                      tabIndex={0}
                    >
                      {isEditing && block.segIdx != null ? (
                        <textarea
                          className="player-rythmo-v2-edit-textarea"
                          value={editorSegments?.[block.segIdx]?.text ?? block.text}
                          onChange={(ev) => onUpdateText!(block.segIdx!, ev.target.value)}
                          onClick={(ev) => ev.stopPropagation()}
                          onPointerDown={(ev) => ev.stopPropagation()}
                          autoFocus
                          rows={1}
                        />
                      ) : block.timedWords && zoomSec <= 5 ? (
                        <span className="player-rythmo-v2-block-timed">
                          {block.timedWords.map((tw, twi) => (
                            <span
                              key={twi}
                              className="player-rythmo-v2-timed-word"
                              style={{ left: `${tw.offsetPct}%` }}
                            >
                              {tw.word}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="player-rythmo-v2-block-text">
                          {block.text || "…"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {blocks.length === 0 ? <p className="small">Aucun bloc dans cette fenêtre.</p> : null}
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

function findSegmentIndexForTurn(
  turn: EventTurnRow,
  segments: EditableSegment[],
  ordinalIndex: Map<number, number> | null,
  allTurns: EventTurnRow[],
): number | null {
  for (let i = 0; i < segments.length; i++) {
    const sMs = Math.round(segments[i].start * 1000);
    const eMs = Math.round(segments[i].end * 1000);
    if (eMs > turn.startMs && sMs < turn.endMs) return i;
  }
  if (ordinalIndex) {
    const globalIdx = allTurns.indexOf(turn);
    const segIdx = ordinalIndex.get(globalIdx);
    if (segIdx != null) return segIdx;
  }
  return null;
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

type LanesLayoutMode = "timeline" | "columns";

type LanesTurnEnriched = {
  turn: EventTurnRow;
  text: string;
  durMs: number;
  pauseBeforeMs: number | null;
  hasOverlap: boolean;
  speakerIndex: number;
};

function enrichTurns(
  slice: QueryWindowResult,
  editorSegments: EditableSegment[] | undefined,
): { enriched: LanesTurnEnriched[]; speakers: string[] } {
  const sorted = [...slice.turns].sort((a, b) => a.startMs - b.startMs);
  const speakers = Array.from(new Set(sorted.map((t) => t.speaker || "\u2014"))).sort();

  const enriched: LanesTurnEnriched[] = sorted.map((t, i) => {
    let text = turnTextFromIpus(t, slice.ipus);
    if (!text && editorSegments) {
      text = turnTextFromSegments(t, editorSegments);
    }

    const durMs = t.endMs - t.startMs;

    let pauseBeforeMs: number | null = null;
    const matchedPause = slice.pauses.find(
      (p) => p.endMs >= t.startMs - 50 && p.endMs <= t.startMs + 50 && p.durMs >= 300,
    );
    if (matchedPause) pauseBeforeMs = matchedPause.durMs;

    const prev = i > 0 ? sorted[i - 1] : null;
    const hasOverlap = prev != null && prev.speaker !== t.speaker && prev.endMs > t.startMs + 50;

    const sp = t.speaker || "\u2014";
    const speakerIndex = speakers.indexOf(sp);

    return { turn: t, text, durMs, pauseBeforeMs, hasOverlap, speakerIndex };
  });

  return { enriched, speakers };
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
  followPlayhead = true,
  editMode = false,
  activeSegmentIndex,
  onFocusSegment,
  onUpdateText,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  durationSec?: number | null;
  loopAsec?: number | null;
  loopBsec?: number | null;
  onSetLoopRange?: (aSec: number, bSec: number) => void;
  editorSegments?: EditableSegment[];
  followPlayhead?: boolean;
  editMode?: boolean;
  activeSegmentIndex?: number | null;
  onFocusSegment?: (index: number) => void;
  onUpdateText?: (index: number, text: string) => void;
}) {
  const [layoutMode, setLayoutMode] = useState<LanesLayoutMode>("timeline");
  const [followActive, setFollowActive] = useState(true);
  const [editingTurnId, setEditingTurnId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);

  const { enriched, speakers } = useMemo(
    () => enrichTurns(slice, editorSegments),
    [slice, editorSegments],
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

  const ordinalIndex = useMemo(
    () => (editorSegments ? buildOrdinalSegmentIndex(slice.turns, editorSegments) : null),
    [slice.turns, editorSegments],
  );

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

  const renderTurnCard = (e: LanesTurnEnriched, _idx: number, isActive: boolean, isPast: boolean, showSpeaker: boolean) => {
    const isEditing = editMode && editingTurnId === e.turn.id;
    const segIdx = editMode && editorSegments
      ? findSegmentIndexForTurn(e.turn, editorSegments, ordinalIndex, slice.turns)
      : null;
    const isFocused = editMode && segIdx != null && activeSegmentIndex === segIdx;

    let cls = "player-lanes-turn";
    if (isActive) cls += " is-active";
    else if (isPast) cls += " is-past";
    if (isFocused) cls += " is-focused";

    const handleDoubleClick = () => {
      if (!editMode || segIdx == null) return;
      onFocusSegment?.(segIdx);
      setEditingTurnId(e.turn.id);
    };

    const handleBlur = () => {
      setEditingTurnId(null);
    };

    const handleKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        setEditingTurnId(null);
      }
      if (ev.key === "Escape") {
        setEditingTurnId(null);
      }
    };

    return (
      <div
        key={e.turn.id}
        ref={isActive ? activeRef : undefined}
        className={cls}
        role="listitem"
        onDoubleClick={handleDoubleClick}
      >
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
          <div className="player-lanes-turn-body">
            {isEditing && segIdx != null && onUpdateText ? (
              <textarea
                className="player-inline-edit-textarea"
                value={editorSegments![segIdx].text}
                onChange={(ev) => onUpdateText(segIdx, ev.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                onClick={(ev) => ev.stopPropagation()}
                autoFocus
                rows={Math.max(2, Math.ceil((editorSegments![segIdx].text.length || 1) / 60))}
              />
            ) : (
              e.text || "\u2026"
            )}
          </div>
          <div className="player-lanes-turn-badges">
            {e.pauseBeforeMs != null && (
              <span className="player-lanes-badge player-lanes-badge--pause" title={`Pause ${Math.round(e.pauseBeforeMs)} ms`}>
                ⏸ {(e.pauseBeforeMs / 1000).toFixed(1)}s
              </span>
            )}
            {e.hasOverlap && (
              <span className="player-lanes-badge player-lanes-badge--overlap" title="Chevauchement">
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

function PlayerWordsBody({
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

function PlayerChatBody({
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

// ---------------------------------------------------------------------------
// Karaoke edit — derives segments from editor JSON segments
// ---------------------------------------------------------------------------

/* KaraokeWord, buildKaraokeWords, PlayerKaraokeEditBody removed — editing is now inline in PlayerKaraokeBody (WX-703) */


// ---------------------------------------------------------------------------
// Vues éditables — segments JSON (mode édition)
// ---------------------------------------------------------------------------

/* findPlayheadSegment and EditViewProps removed — no longer needed after WX-702 inline editing integration */

/* PlayerChatEditBody and PlayerWordsEditBody removed — editing is now inline in the refactored views (WX-702) */

// ---------------------------------------------------------------------------
// WX-667/710/711 — Vue statistiques prosodiques par locuteur
// ---------------------------------------------------------------------------

const STATS_HISTOGRAM_BINS = 12;
const STATS_HISTOGRAM_W = 200;
const STATS_HISTOGRAM_H = 56;

const SPEAKER_COLORS = [
  "var(--lx-accent)",
  "#e67e22",
  "#27ae60",
  "#8e44ad",
  "#e74c3c",
  "#16a085",
  "#d35400",
  "#2980b9",
];

function speakerColor(idx: number): string {
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

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

    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || STATS_HISTOGRAM_W;
    const H = STATS_HISTOGRAM_H;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const bins = buildPauseHistogram(durationsMs, STATS_HISTOGRAM_BINS);
    ctx.clearRect(0, 0, W, H);

    if (bins.length === 0) {
      ctx.fillStyle = "#888";
      ctx.font = "10px sans-serif";
      ctx.fillText("\u2014", 4, H / 2 + 4);
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

// ─── WX-710 : Barre empilée du temps de parole ──────────────────────────────────

function SpeechBarCanvas({
  stats,
  totalDurationMs,
  activeSpeaker,
}: {
  stats: { speaker: string; speechMs: number }[];
  totalDurationMs: number;
  activeSpeaker: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || 600;
    const H = 38;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    if (totalDurationMs <= 0) return;

    const totalSpeech = stats.reduce((s, st) => s + st.speechMs, 0);
    const silenceMs = Math.max(0, totalDurationMs - totalSpeech);

    let x = 0;
    const barH = H - 12;

    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const w = (s.speechMs / totalDurationMs) * W;
      if (w < 1) continue;
      ctx.fillStyle = speakerColor(i);
      if (activeSpeaker && s.speaker !== activeSpeaker) ctx.globalAlpha = 0.35;
      else ctx.globalAlpha = 1;
      ctx.fillRect(x, 0, w, barH);
      ctx.globalAlpha = 1;

      if (w > 30) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(s.speaker, x + w / 2, barH / 2 + 4);
      }
      x += w;
    }

    if (silenceMs > 0) {
      const sw = (silenceMs / totalDurationMs) * W;
      ctx.fillStyle = "rgba(128,128,128,0.15)";
      ctx.fillRect(x, 0, sw, barH);
      if (sw > 30) {
        ctx.fillStyle = "#888";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("silence", x + sw / 2, barH / 2 + 4);
      }
    }

    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "var(--lx-text-2, #888)";
    x = 0;
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i];
      const w = (s.speechMs / totalDurationMs) * W;
      if (w > 40) {
        const pct = ((s.speechMs / totalDurationMs) * 100).toFixed(0);
        ctx.fillText(`${pct}%`, x + 3, barH + 10);
      }
      x += w;
    }
  }, [stats, totalDurationMs, activeSpeaker]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={38}
      className="stats-speech-bar-canvas"
      title="Répartition temps de parole"
    />
  );
}

// ─── WX-710 : Timeline alternances de parole ─────────────────────────────────

function SpeechTimelineCanvas({
  timeline,
  speakers,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
  overlapSegments,
}: {
  timeline: TimelineSegment[];
  speakers: string[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
  overlapSegments?: { startMs: number; endMs: number }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const W_REF = 600;
  const H = 60;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    if (totalDurationMs <= 0) return;

    const laneH = speakers.length > 0 ? Math.min(20, (H - 10) / speakers.length) : 20;
    const contentH = speakers.length * laneH;

    for (let si = 0; si < speakers.length; si++) {
      const y = si * laneH + 2;
      ctx.fillStyle = "rgba(128,128,128,0.06)";
      ctx.fillRect(0, y, W, laneH - 2);

      ctx.fillStyle = "#888";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(speakers[si], 2, y + laneH / 2 + 3);
    }

    for (const seg of timeline) {
      const si = speakers.indexOf(seg.speaker);
      if (si < 0) continue;
      const x = (seg.startMs / totalDurationMs) * W;
      const w = Math.max(1, ((seg.endMs - seg.startMs) / totalDurationMs) * W);
      const y = si * laneH + 2;
      ctx.fillStyle = speakerColor(si);
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x, y, w, laneH - 3);
      ctx.globalAlpha = 1;
    }

    if (overlapSegments && overlapSegments.length > 0) {
      for (const ov of overlapSegments) {
        const x = (ov.startMs / totalDurationMs) * W;
        const w = Math.max(1, ((ov.endMs - ov.startMs) / totalDurationMs) * W);
        ctx.fillStyle = "rgba(217, 83, 79, 0.25)";
        ctx.fillRect(x, 0, w, contentH + 2);
        ctx.strokeStyle = "rgba(217, 83, 79, 0.6)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, 0, w, contentH + 2);
      }
    }

    const px = (playheadMs / totalDurationMs) * W;
    ctx.strokeStyle = "var(--lx-accent, #3498db)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }, [timeline, speakers, totalDurationMs, playheadMs, overlapSegments]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeekToMs || totalDurationMs <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ms = (x / rect.width) * totalDurationMs;
    onSeekToMs(Math.max(0, Math.round(ms)));
  };

  return (
    <canvas
      ref={canvasRef}
      width={W_REF}
      height={H}
      className="stats-timeline-canvas"
      title="Timeline alternances de parole — clic pour seek"
      onClick={handleClick}
      style={{ cursor: onSeekToMs ? "pointer" : "default" }}
    />
  );
}

// ─── WX-711 : Courbe débit de parole ────────────────────────────────────────────

function SpeechRateCanvas({
  series,
  speakers,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
}: {
  series: SpeechRateSeries[];
  speakers: string[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const W_REF = 600;
  const H = 120;
  const PAD_TOP = 20;
  const PAD_BOTTOM = 22;
  const PAD_LEFT = 42;
  const PAD_RIGHT = 10;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);
    if (series.length === 0 || totalDurationMs <= 0) return;

    const plotW = W - PAD_LEFT - PAD_RIGHT;
    const plotH = H - PAD_TOP - PAD_BOTTOM;

    let maxRate = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (p.wordsPerMin > maxRate) maxRate = p.wordsPerMin;
      }
    }
    maxRate = Math.max(maxRate, 10);
    const yMax = Math.ceil(maxRate / 20) * 20;

    ctx.strokeStyle = "rgba(128,128,128,0.15)";
    ctx.lineWidth = 0.5;
    ctx.font = "9px sans-serif";
    ctx.fillStyle = "#888";
    ctx.textAlign = "right";
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const val = (yMax / gridSteps) * i;
      const y = PAD_TOP + plotH - (val / yMax) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(W - PAD_RIGHT, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(val)}`, PAD_LEFT - 4, y + 3);
    }

    ctx.textAlign = "center";
    const timeSteps = Math.min(6, Math.floor(totalDurationMs / 60000));
    for (let i = 0; i <= Math.max(timeSteps, 1); i++) {
      const tMs = (totalDurationMs / Math.max(timeSteps, 1)) * i;
      const x = PAD_LEFT + (tMs / totalDurationMs) * plotW;
      const min = Math.floor(tMs / 60000);
      const sec = Math.floor((tMs % 60000) / 1000);
      ctx.fillText(`${min}:${sec.toString().padStart(2, "0")}`, x, H - 4);
    }

    ctx.save();
    ctx.translate(10, PAD_TOP + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = "#888";
    ctx.font = "9px sans-serif";
    ctx.fillText("mots/min", 0, 0);
    ctx.restore();

    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      if (s.points.length === 0) continue;
      const spIdx = speakers.indexOf(s.speaker);
      ctx.strokeStyle = speakerColor(spIdx >= 0 ? spIdx : si);
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let pi = 0; pi < s.points.length; pi++) {
        const p = s.points[pi];
        const x = PAD_LEFT + (p.timeMs / totalDurationMs) * plotW;
        const y = PAD_TOP + plotH - (Math.min(p.wordsPerMin, yMax) / yMax) * plotH;
        if (pi === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const px = PAD_LEFT + (playheadMs / totalDurationMs) * plotW;
    ctx.strokeStyle = "var(--lx-accent, #3498db)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, PAD_TOP);
    ctx.lineTo(px, PAD_TOP + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [series, speakers, totalDurationMs, playheadMs]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeekToMs || totalDurationMs <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
    const ms = ((x - PAD_LEFT) / plotW) * totalDurationMs;
    onSeekToMs(Math.max(0, Math.round(ms)));
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const tip = tooltipRef.current;
    const canvas = canvasRef.current;
    if (!tip || !canvas || totalDurationMs <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
    const ms = ((x - PAD_LEFT) / plotW) * totalDurationMs;
    if (ms < 0 || ms > totalDurationMs) { tip.style.display = "none"; return; }

    let text = `${formatClockSeconds(ms / 1000)}\n`;
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      let closest = s.points[0];
      let minDist = Infinity;
      for (const p of s.points) {
        const d = Math.abs(p.timeMs - ms);
        if (d < minDist) { minDist = d; closest = p; }
      }
      if (closest) text += `${s.speaker}: ${closest.wordsPerMin.toFixed(0)} m/min\n`;
    }
    tip.textContent = text.trim();
    tip.style.display = "block";
    tip.style.left = `${Math.min(x + 8, rect.width - 120)}px`;
    tip.style.top = `${e.clientY - rect.top - 40}px`;
  };

  const handleMouseLeave = () => {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
  };

  return (
    <div className="stats-rate-chart-wrap" style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={W_REF}
        height={H}
        className="stats-rate-canvas"
        title="Débit de parole (mots/min) — clic pour seek"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: onSeekToMs ? "crosshair" : "default" }}
      />
      <div
        ref={tooltipRef}
        className="stats-rate-tooltip"
        style={{ display: "none", position: "absolute", pointerEvents: "none" }}
      />
    </div>
  );
}

// ─── Densité de parole ───────────────────────────────────────────────────────

function SpeechDensityCanvas({
  points,
  totalDurationMs,
  playheadMs,
  onSeekToMs,
}: {
  points: DensityPoint[];
  totalDurationMs: number;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const W_REF = 600;
  const H = 70;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width) || W_REF;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (totalDurationMs <= 0 || points.length === 0) return;

    const padL = 28;
    const padR = 6;
    const padT = 4;
    const padB = 14;
    const gW = W - padL - padR;
    const gH = H - padT - padB;

    ctx.strokeStyle = "rgba(128,128,128,0.15)";
    ctx.lineWidth = 0.5;
    for (const pct of [0.25, 0.5, 0.75, 1]) {
      const y = padT + gH * (1 - pct);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + gW, y);
      ctx.stroke();
      ctx.fillStyle = "#888";
      ctx.font = "8px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(pct * 100)}%`, padL - 3, y + 3);
    }

    ctx.beginPath();
    let started = false;
    for (const pt of points) {
      const x = padL + (pt.timeMs / totalDurationMs) * gW;
      const y = padT + gH * (1 - pt.density);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(52, 152, 219, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const last = points[points.length - 1];
    if (last) {
      ctx.lineTo(padL + (last.timeMs / totalDurationMs) * gW, padT + gH);
      ctx.lineTo(padL + (points[0].timeMs / totalDurationMs) * gW, padT + gH);
      ctx.closePath();
      ctx.fillStyle = "rgba(52, 152, 219, 0.08)";
      ctx.fill();
    }

    const px = padL + (playheadMs / totalDurationMs) * gW;
    ctx.strokeStyle = "var(--lx-accent, #3498db)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + gH);
    ctx.stroke();
  }, [points, totalDurationMs, playheadMs]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeekToMs || totalDurationMs <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 28;
    const padR = 6;
    const gW = rect.width - padL - padR;
    const x = e.clientX - rect.left - padL;
    if (x < 0 || x > gW) return;
    onSeekToMs(Math.max(0, Math.round((x / gW) * totalDurationMs)));
  };

  return (
    <canvas
      ref={canvasRef}
      width={W_REF}
      height={H}
      className="stats-density-canvas"
      title="Densité de parole — clic pour seek"
      onClick={handleClick}
      style={{ cursor: onSeekToMs ? "pointer" : "default" }}
    />
  );
}

// ─── PlayerStatsBody : vue principale ────────────────────────────────────────

function PlayerStatsBody({
  slice,
  playheadMs,
  durationSec,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  durationSec?: number | null;
  onSeekToMs?: (ms: number) => void;
}) {
  const totalDurationMs =
    durationSec != null && Number.isFinite(durationSec) ? durationSec * 1000 : undefined;

  const hasWords = slice.words.length > 0;

  const stats = useMemo(
    () => computeSpeakerStats(
      slice.turns, slice.pauses, slice.ipus, totalDurationMs,
      hasWords ? slice.words : undefined,
    ),
    [slice.turns, slice.pauses, slice.ipus, slice.words, totalDurationMs, hasWords],
  );

  const activeSpeaker = useMemo(() => {
    const activeTurn = slice.turns.find(
      (t) => playheadMs >= t.startMs && playheadMs < t.endMs,
    );
    return activeTurn?.speaker ?? null;
  }, [slice.turns, playheadMs]);

  const speakers = useMemo(() => stats.map((s) => s.speaker), [stats]);

  const timeline = useMemo(
    () => buildSpeechTimeline(slice.turns),
    [slice.turns],
  );

  const durMs = totalDurationMs ?? Math.max(0, ...slice.turns.map((t) => t.endMs));

  const overlaps = useMemo(
    () => computeTurnOverlaps(slice.turns, durMs),
    [slice.turns, durMs],
  );

  const rateSeries = useMemo(
    () => computeSpeechRate(slice.ipus, durMs),
    [slice.ipus, durMs],
  );

  const transitions = useMemo(
    () => computeTransitions(slice.turns),
    [slice.turns],
  );

  const densityPoints = useMemo(
    () => computeSpeechDensity(slice.turns, durMs),
    [slice.turns, durMs],
  );

  const [collapsedSpeakers, setCollapsedSpeakers] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((sp: string) => {
    setCollapsedSpeakers((prev) => {
      const next = new Set(prev);
      if (next.has(sp)) next.delete(sp); else next.add(sp);
      return next;
    });
  }, []);

  const [pauseMinMs, setPauseMinMs] = useState(0);
  const [pauseSpeakerFilter, setPauseSpeakerFilter] = useState<string>("__all__");
  const [pauseTypeFilter, setPauseTypeFilter] = useState<string>("__all__");
  const [pauseListExpanded, setPauseListExpanded] = useState(false);

  const allPauses = slice.pauses;
  const sortedWords = useMemo(
    () => [...slice.words].sort((a, b) => a.startMs - b.startMs),
    [slice.words],
  );

  const filteredPauses = useMemo(() => {
    let result = allPauses.filter((p) => p.durMs >= pauseMinMs);
    if (pauseSpeakerFilter !== "__all__") {
      result = result.filter((p) => (p.speaker ?? "?") === pauseSpeakerFilter);
    }
    if (pauseTypeFilter !== "__all__") {
      result = result.filter((p) => (p.type ?? "unknown") === pauseTypeFilter);
    }
    return result.sort((a, b) => a.startMs - b.startMs);
  }, [allPauses, pauseMinMs, pauseSpeakerFilter, pauseTypeFilter]);

  const allPauseDurationsMs = useMemo(
    () => filteredPauses.map((p) => p.durMs),
    [filteredPauses],
  );

  const pauseTypes = useMemo(() => {
    const s = new Set<string>();
    for (const p of allPauses) s.add(p.type ?? "unknown");
    return [...s].sort();
  }, [allPauses]);

  const pauseContextLookup = useCallback(
    (p: EventPauseRow) => {
      const before = sortedWords.filter((w) => w.endMs <= p.startMs + 30).slice(-3);
      const after = sortedWords.filter((w) => w.startMs >= p.endMs - 30).slice(0, 3);
      return {
        before: before.map((w) => w.token ?? "").join(" "),
        after: after.map((w) => w.token ?? "").join(" "),
      };
    },
    [sortedWords],
  );

  const totalSpeechMs = stats.reduce((s, st) => s + st.speechMs, 0);
  const totalWords = stats.reduce((s, st) => s + st.nWords, 0);
  const silenceMs = Math.max(0, durMs - totalSpeechMs);
  const globalRate = totalSpeechMs > 0 ? (totalWords / (totalSpeechMs / 1000)) * 60 : 0;

  const qualityScore = useMemo(() => {
    const confScores = stats.filter((s) => s.meanConfidence != null).map((s) => s.meanConfidence!);
    const avgConf = confScores.length > 0 ? confScores.reduce((a, b) => a + b, 0) / confScores.length : null;
    const totalAligned = stats.reduce((sum, s) => sum + (s.alignmentDist["aligned"] ?? 0), 0);
    const totalAlignmentWords = stats.reduce((sum, s) => sum + Object.values(s.alignmentDist).reduce((a, b) => a + b, 0), 0);
    const alignedRatio = totalAlignmentWords > 0 ? totalAligned / totalAlignmentWords : null;
    const overlapPenalty = Math.max(0, 1 - overlaps.ratio * 5);

    if (avgConf == null && alignedRatio == null) return null;
    const confPart = avgConf ?? 0.8;
    const alignPart = alignedRatio ?? 0.8;
    return Math.round(confPart * 40 + alignPart * 40 + overlapPenalty * 20);
  }, [stats, overlaps.ratio]);

  if (stats.length === 0) {
    return (
      <p className="player-viewport-placeholder small">
        Aucune donnée de locuteurs disponible dans ce run.
      </p>
    );
  }

  return (
    <div className="player-stats-body">
      {/* Résumé global */}
      <div className="stats-summary">
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{formatClockSeconds(durMs / 1000)}</span>
          <span className="stats-summary-label">Durée totale</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{formatClockSeconds(totalSpeechMs / 1000)}</span>
          <span className="stats-summary-label">Parole ({durMs > 0 ? ((totalSpeechMs / durMs) * 100).toFixed(1) : "0"}%)</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{formatClockSeconds(silenceMs / 1000)}</span>
          <span className="stats-summary-label">Silence ({durMs > 0 ? ((silenceMs / durMs) * 100).toFixed(1) : "0"}%)</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{stats.length}</span>
          <span className="stats-summary-label">Locuteurs</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{slice.turns.length}</span>
          <span className="stats-summary-label">Tours</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{overlaps.count}</span>
          <span className="stats-summary-label">Overlaps</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{Math.round(globalRate)}</span>
          <span className="stats-summary-label">Mots/min global</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{totalWords}</span>
          <span className="stats-summary-label">Mots total</span>
        </div>
        {qualityScore != null && (
          <div className={`stats-summary-item${qualityScore >= 80 ? " quality-good" : qualityScore >= 60 ? " quality-ok" : " quality-low"}`}>
            <span className="stats-summary-value mono">{qualityScore}</span>
            <span className="stats-summary-label">Qualit{"é"} /100</span>
          </div>
        )}
      </div>

      {/* Répartition du temps de parole */}
      <div className="player-stats-section">
        <h4 className="player-stats-section-title">Répartition du temps de parole</h4>
        <div className="player-stats-legend">
          {stats.map((s, i) => (
            <span key={s.speaker} className="player-stats-legend-item">
              <span className="player-stats-legend-dot" style={{ background: speakerColor(i) }} />
              <span className="player-stats-legend-label">{s.speaker}</span>
              <span className="player-stats-legend-pct mono">
                {((s.speechMs / Math.max(durMs, 1)) * 100).toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
        <SpeechBarCanvas stats={stats} totalDurationMs={durMs} activeSpeaker={activeSpeaker} />
      </div>

      {/* Timeline alternances + overlaps */}
      <div className="player-stats-section">
        <h4 className="player-stats-section-title">
          Timeline des alternances
          {overlaps.count > 0 && (
            <span className="stats-overlap-badge">
              {overlaps.count} overlap{overlaps.count > 1 ? "s" : ""} ·{" "}
              {formatClockSeconds(overlaps.totalMs / 1000)} ({(overlaps.ratio * 100).toFixed(1)}%)
            </span>
          )}
        </h4>
        <SpeechTimelineCanvas
          timeline={timeline}
          speakers={speakers}
          totalDurationMs={durMs}
          playheadMs={playheadMs}
          onSeekToMs={onSeekToMs}
          overlapSegments={overlaps.segments}
        />
      </div>

      {/* Débit de parole */}
      {rateSeries.length > 0 && (
        <div className="player-stats-section">
          <h4 className="player-stats-section-title">Débit de parole (mots/min)</h4>
          <div className="player-stats-legend">
            {rateSeries.map((s) => {
              const si = speakers.indexOf(s.speaker);
              return (
                <span key={s.speaker} className="player-stats-legend-item">
                  <span className="player-stats-legend-dot" style={{ background: speakerColor(si >= 0 ? si : 0) }} />
                  <span className="player-stats-legend-label">{s.speaker}</span>
                </span>
              );
            })}
          </div>
          <SpeechRateCanvas
            series={rateSeries}
            speakers={speakers}
            totalDurationMs={durMs}
            playheadMs={playheadMs}
            onSeekToMs={onSeekToMs}
          />
        </div>
      )}

      {/* Densité de parole */}
      {densityPoints.length > 0 && (
        <div className="player-stats-section">
          <h4 className="player-stats-section-title">Densit{"é"} de parole (activit{"é"} vocale)</h4>
          <SpeechDensityCanvas
            points={densityPoints}
            totalDurationMs={durMs}
            playheadMs={playheadMs}
            onSeekToMs={onSeekToMs}
          />
        </div>
      )}

      {/* Transitions entre speakers */}
      {transitions.length > 0 && (
        <div className="player-stats-section">
          <h4 className="player-stats-section-title">Transitions entre locuteurs</h4>
          <div className="stats-transitions-grid">
            {transitions.map((tr) => (
              <div key={`${tr.from}→${tr.to}`} className="stats-transition-item">
                <span className="stats-transition-pair">
                  <span className="stats-transition-speaker">{tr.from}</span>
                  <span className="stats-transition-arrow">{"\u2192"}</span>
                  <span className="stats-transition-speaker">{tr.to}</span>
                </span>
                <span className="stats-transition-stats mono">
                  {tr.count}x · méd. {Math.round(tr.medianGapMs)} ms
                  {tr.medianGapMs < 0 && <span className="stats-transition-overlap"> (overlap)</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pauses — section dédiée */}
      {allPauses.length > 0 && (
        <div className="player-stats-section">
          <h4 className="player-stats-section-title">
            Pauses ({filteredPauses.length}{filteredPauses.length !== allPauses.length ? ` / ${allPauses.length}` : ""})
          </h4>

          {/* Filtres */}
          <div className="stats-pause-filters">
            <label className="stats-pause-filter small">
              Seuil min
              <select
                value={pauseMinMs}
                onChange={(e) => setPauseMinMs(Number(e.target.value))}
              >
                <option value={0}>Toutes</option>
                <option value={200}>{"\u2265"} 200 ms</option>
                <option value={300}>{"\u2265"} 300 ms</option>
                <option value={500}>{"\u2265"} 500 ms</option>
                <option value={1000}>{"\u2265"} 1 s</option>
                <option value={2000}>{"\u2265"} 2 s</option>
                <option value={5000}>{"\u2265"} 5 s</option>
              </select>
            </label>
            <label className="stats-pause-filter small">
              Locuteur
              <select
                value={pauseSpeakerFilter}
                onChange={(e) => setPauseSpeakerFilter(e.target.value)}
              >
                <option value="__all__">Tous</option>
                {speakers.map((sp) => (
                  <option key={sp} value={sp}>{sp}</option>
                ))}
              </select>
            </label>
            <label className="stats-pause-filter small">
              Type
              <select
                value={pauseTypeFilter}
                onChange={(e) => setPauseTypeFilter(e.target.value)}
              >
                <option value="__all__">Tous</option>
                {pauseTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Histogramme agrégé */}
          {allPauseDurationsMs.length > 0 && (
            <div className="player-stats-histogram">
              <PauseHistogramCanvas
                durationsMs={allPauseDurationsMs}
                activeColor="var(--lx-accent)"
              />
            </div>
          )}

          {/* Stats résumées */}
          {filteredPauses.length > 0 && (() => {
            const sorted = [...allPauseDurationsMs].sort((a, b) => a - b);
            const total = sorted.reduce((s, d) => s + d, 0);
            const mean = total / sorted.length;
            const med = percentile(sorted, 50);
            const p90 = percentile(sorted, 90);
            const min = sorted[0];
            const max = sorted[sorted.length - 1];
            return (
              <dl className="player-stats-dl stats-pause-summary-dl">
                <dt>Total</dt><dd>{formatClockSeconds(total / 1000)}</dd>
                <dt>Moy.</dt><dd>{Math.round(mean)} ms</dd>
                <dt>Méd.</dt><dd>{Math.round(med)} ms</dd>
                <dt>P90</dt><dd>{Math.round(p90)} ms</dd>
                <dt>Min / Max</dt><dd>{Math.round(min)} / {Math.round(max)} ms</dd>
              </dl>
            );
          })()}

          {/* Liste navigable */}
          <div className="stats-pause-list-header">
            <button
              type="button"
              className="stats-pause-list-toggle small"
              onClick={() => setPauseListExpanded((v) => !v)}
            >
              {pauseListExpanded ? "\u25BC" : "\u25B6"} Liste des pauses ({filteredPauses.length})
            </button>
          </div>
          {pauseListExpanded && (
            <ul className="stats-pause-list">
              {filteredPauses.slice(0, 200).map((p) => {
                const ctx = pauseContextLookup(p);
                const typeLabel = p.type ?? "unknown";
                const spLabel = p.speaker ?? "?";
                return (
                  <li key={p.id} className="stats-pause-list-item">
                    <button
                      type="button"
                      className="stats-pause-list-btn"
                      onClick={() => onSeekToMs?.(p.startMs)}
                      title={`Aller à ${formatClockSeconds(p.startMs / 1000)}`}
                    >
                      <span className="stats-pause-list-time mono">
                        {formatClockSeconds(p.startMs / 1000)}
                      </span>
                      <span className="stats-pause-list-dur mono">
                        {p.durMs >= 1000 ? `${(p.durMs / 1000).toFixed(1)}s` : `${Math.round(p.durMs)}ms`}
                      </span>
                      <span className={`stats-pause-list-type${typeLabel.includes("inter") ? " is-inter" : ""}`}>
                        {typeLabel}
                      </span>
                      <span className="stats-pause-list-speaker">{spLabel}</span>
                      <span className="stats-pause-list-context" title={`${ctx.before} ▏ ${ctx.after}`}>
                        {ctx.before && <span className="stats-pause-ctx-before">{ctx.before}</span>}
                        <span className="stats-pause-ctx-sep">{"\u258F"}</span>
                        {ctx.after && <span className="stats-pause-ctx-after">{ctx.after}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filteredPauses.length > 200 && (
                <li className="stats-pause-list-more small">
                  … et {filteredPauses.length - 200} pauses supplémentaires
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Détail par locuteur */}
      <div className="player-stats-section">
        <h4 className="player-stats-section-title">Détail par locuteur</h4>
        <div className="player-stats-grid">
          {stats.map((s, si) => {
            const isActive = s.speaker === activeSpeaker;
            const isCollapsed = collapsedSpeakers.has(s.speaker);
            const pauseTypeEntries = Object.entries(s.pausesByType).sort((a, b) => b[1].count - a[1].count);
            return (
              <div
                key={s.speaker}
                className={`player-stats-card${isActive ? " is-active" : ""}${isCollapsed ? " is-collapsed" : ""}`}
                style={{ borderLeftColor: speakerColor(si) }}
                aria-current={isActive ? "true" : undefined}
              >
                <button
                  type="button"
                  className="player-stats-card-header"
                  onClick={() => toggleCollapse(s.speaker)}
                  title={isCollapsed ? "Déplier" : "Replier"}
                >
                  <span className="player-stats-speaker">{s.speaker}</span>
                  <span className="stats-card-collapse-icon">{isCollapsed ? "\u25B6" : "\u25BC"}</span>
                  {isActive && <span className="player-stats-active-badge">en cours</span>}
                </button>

                {!isCollapsed && <>
                {/* Stats principales */}
                <dl className="player-stats-dl">
                  <dt>Parole</dt>
                  <dd>{formatClockSeconds(s.speechMs / 1000)}</dd>
                  <dt>Ratio parole</dt>
                  <dd>{(s.speechRatio * 100).toFixed(1)} %</dd>
                  <dt>Mots</dt>
                  <dd>{s.nWords}</dd>
                  <dt>Débit</dt>
                  <dd>{s.speechRateWordsPerSec.toFixed(1)} mots/s</dd>
                  <dt>Tours</dt>
                  <dd>{s.nTurns}{s.meanTurnDurMs > 0 ? ` (moy. ${(s.meanTurnDurMs / 1000).toFixed(1)}s)` : ""}</dd>
                  {s.ttr != null && (
                    <>
                      <dt>Diversité lex.</dt>
                      <dd>{(s.ttr * 100).toFixed(0)} % TTR ({s.nUniqueTokens} uniques / {s.nWords})</dd>
                    </>
                  )}
                </dl>

                {/* IPU */}
                <div className="player-stats-subsection">
                  <p className="player-stats-subsection-title small">IPU ({s.nIpus})</p>
                  <dl className="player-stats-dl">
                    <dt>Durée moy.</dt>
                    <dd>{s.meanIpuDurMs > 0 ? `${Math.round(s.meanIpuDurMs)} ms` : "\u2014"}</dd>
                    <dt>Min / Max</dt>
                    <dd>{s.nIpus > 0 ? `${Math.round(s.minIpuDurMs)} / ${Math.round(s.maxIpuDurMs)} ms` : "\u2014"}</dd>
                  </dl>
                  {s.topIpus.length > 0 && (
                    <div className="stats-top-ipus">
                      <p className="player-stats-subsection-title small">Top {s.topIpus.length} IPU</p>
                      {s.topIpus.map((ti, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="stats-top-ipu-item"
                          disabled={!onSeekToMs}
                          onClick={() => onSeekToMs?.(ti.startMs)}
                          title={`${formatClockSeconds(ti.startMs / 1000)} \u2014 ${ti.nWords} mots, ${Math.round(ti.durMs)} ms`}
                        >
                          <span className="stats-top-ipu-dur mono">{(ti.durMs / 1000).toFixed(1)}s</span>
                          <span className="stats-top-ipu-text">{ti.text.length > 60 ? ti.text.slice(0, 60) + "\u2026" : ti.text || "\u2014"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pauses */}
                <div className="player-stats-subsection">
                  <p className="player-stats-subsection-title small">Pauses ({s.nPauses})</p>
                  <dl className="player-stats-dl">
                    <dt>Total pauses</dt>
                    <dd>{s.totalPauseMs > 0 ? formatClockSeconds(s.totalPauseMs / 1000) : "\u2014"}</dd>
                    <dt>Moy. / Méd.</dt>
                    <dd>
                      {s.meanPauseDurMs > 0
                        ? `${Math.round(s.meanPauseDurMs)} / ${Math.round(s.medianPauseDurMs)} ms`
                        : "\u2014"}
                    </dd>
                    <dt>P90</dt>
                    <dd>{s.p90PauseDurMs > 0 ? `${Math.round(s.p90PauseDurMs)} ms` : "\u2014"}</dd>
                    <dt>Ratio pause</dt>
                    <dd>{(s.pauseRatio * 100).toFixed(1)} %</dd>
                  </dl>
                  {pauseTypeEntries.length > 0 && (
                    <div className="stats-pause-types">
                      {pauseTypeEntries.map(([type, val]) => (
                        <span key={type} className="stats-pause-type-chip small">
                          {type}: {val.count} ({Math.round(val.totalMs)} ms)
                        </span>
                      ))}
                    </div>
                  )}
                  {s.nPauses > 0 && (
                    <div className="player-stats-histogram">
                      <p className="player-stats-histogram-label small">Distribution pauses</p>
                      <PauseHistogramCanvas
                        durationsMs={s.pauseDurationsMs}
                        activeColor={speakerColor(si)}
                      />
                    </div>
                  )}
                </div>

                {/* Confiance + alignement (si mots chargés) */}
                {s.meanConfidence != null && (
                  <div className="player-stats-subsection">
                    <p className="player-stats-subsection-title small">Qualité transcript</p>
                    <dl className="player-stats-dl">
                      <dt>Confiance moy.</dt>
                      <dd>{(s.meanConfidence * 100).toFixed(0)} %</dd>
                      <dt>Mots &lt; 70%</dt>
                      <dd>{s.lowConfidencePct != null ? `${(s.lowConfidencePct * 100).toFixed(1)} %` : "\u2014"}</dd>
                    </dl>
                    {Object.keys(s.alignmentDist).length > 0 && (
                      <div className="stats-alignment-dist">
                        {Object.entries(s.alignmentDist).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                          <span key={status} className="stats-alignment-chip small">
                            {status}: {count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                </>}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

