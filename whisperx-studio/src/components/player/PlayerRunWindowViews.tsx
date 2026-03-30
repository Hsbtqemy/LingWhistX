import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { clampNumber, formatClockSeconds } from "../../appUtils";
import {
  buildTimeBins,
  turnsForSpeakerInBin,
  uniqueSpeakersFromTurns,
} from "../../player/playerColumnsBins";
import { isWordAligned } from "../../player/karaokeWords";
import {
  buildPauseHistogram,
  computeSpeakerStats,
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
      <PlayerColumnsBody slice={slice} playheadMs={playheadMs} onSeekToMs={onSeekToMs} />
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
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
  followPlayhead: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeSegRef = useRef<HTMLDivElement | null>(null);
  const [followActive, setFollowActive] = useState(true);
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
        Active <strong>Charger les mots</strong> dans le panneau de gauche pour afficher la vue Karaok\u00e9.
      </p>
    );
  }

  const speakers = Array.from(new Set(allSegments.map((s) => s.speaker)));

  return (
    <div className="karaoke-v2" aria-label="Vue karaok\u00e9">
      <div className="karaoke-v2-header">
        <span className="karaoke-v2-header-info small mono">
          {allSegments.length} segments \u00b7 {speakers.length} loc.
          {slice.truncated.ipus ? " \u00b7 tronqu\u00e9" : ""}
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
          let cls = "karaoke-v2-seg";
          if (isActive) cls += " is-active";
          else if (isPast) cls += " is-past";

          return (
            <div
              key={seg.ipuId}
              ref={isActive ? activeSegRef : undefined}
              className={cls}
              role="listitem"
            >
              <div className="karaoke-v2-seg-left">
                <span className="karaoke-v2-speaker mono">{seg.speaker}</span>
                <span className="karaoke-v2-time mono">
                  {formatClockSeconds(seg.startMs / 1000)}
                </span>
              </div>

              <div className="karaoke-v2-seg-body">
                {seg.words.length > 0 ? (
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
                    \u23f8 {(seg.pauseBefore / 1000).toFixed(1)}s
                  </span>
                )}
                {seg.hasOverlap && (
                  <span className="karaoke-v2-badge karaoke-v2-badge--overlap" title="Chevauchement">
                    \u27f7
                  </span>
                )}
                {seg.hasUnaligned && (
                  <span className="karaoke-v2-badge karaoke-v2-badge--unaligned" title="Mots interpol\u00e9s">
                    \u2248
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {allSegments.length === 0 && (
          <p className="small" style={{ padding: "16px" }}>Aucun segment dans cette fen\u00eatre.</p>
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
                          {formatClockSeconds(t.startMs / 1000)} → {formatClockSeconds(t.endMs / 1000)}
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
// Karaoke edit — derives segments from editor JSON segments
// ---------------------------------------------------------------------------

type KaraokeWord = {
  segIdx: number;
  wordIdx: number;
  word: string;
  speaker: string;
  startMs: number;
  endMs: number;
};

function areTimestampsCorrupted(segments: EditableSegment[], durationMs: number): boolean {
  if (segments.length === 0 || durationMs <= 0) return false;
  const lastEnd = Math.round(segments[segments.length - 1].end * 1000);
  const firstStart = Math.round(segments[0].start * 1000);
  const span = lastEnd - firstStart;
  return span > durationMs * 2 || firstStart > durationMs;
}

function buildKaraokeWords(segments: EditableSegment[], durationMs: number): KaraokeWord[] {
  const result: KaraokeWord[] = [];
  if (segments.length === 0) return result;

  const corrupted = durationMs > 0 && areTimestampsCorrupted(segments, durationMs);

  let totalWords = 0;
  for (const seg of segments) {
    totalWords += (seg.words?.length ?? seg.text.split(/\s+/).filter(Boolean).length);
  }
  if (totalWords === 0) return result;

  let globalWordIdx = 0;
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const hasRealWords = seg.words && seg.words.length > 0;
    const textWords = seg.text.split(/\s+/).filter(Boolean);
    const wordCount = hasRealWords ? seg.words!.length : textWords.length;
    if (wordCount === 0) continue;

    for (let wi = 0; wi < wordCount; wi++) {
      let wStart: number;
      let wEnd: number;
      let wText: string;

      if (corrupted) {
        wStart = Math.round((globalWordIdx / totalWords) * durationMs);
        wEnd = Math.round(((globalWordIdx + 1) / totalWords) * durationMs);
        wText = hasRealWords ? seg.words![wi].word : textWords[wi];
      } else if (hasRealWords) {
        const rw = seg.words![wi];
        wStart = Math.round(rw.start * 1000);
        wEnd = Math.round(rw.end * 1000);
        wText = rw.word;
      } else {
        const segStartMs = Math.round(seg.start * 1000);
        const segEndMs = Math.round(seg.end * 1000);
        const segDurMs = segEndMs - segStartMs;
        wStart = segStartMs + Math.round((wi / wordCount) * segDurMs);
        wEnd = segStartMs + Math.round(((wi + 1) / wordCount) * segDurMs);
        wText = textWords[wi];
      }

      result.push({
        segIdx: si,
        wordIdx: wi,
        word: wText,
        speaker: seg.speaker ?? "\u2014",
        startMs: wStart,
        endMs: wEnd,
      });
      globalWordIdx++;
    }
  }
  return result;
}

type KaraokeEditSegGroup = {
  segIdx: number;
  speaker: string;
  startMs: number;
  words: KaraokeWord[];
};

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeSegRef = useRef<HTMLDivElement | null>(null);
  const [followActive, setFollowActive] = useState(true);
  const programmaticScrollRef = useRef(false);

  const durationMs = durationSec != null && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec * 1000
    : 0;
  const words = useMemo(() => buildKaraokeWords(segments, durationMs), [segments, durationMs]);

  const activeIdx = useMemo(() => {
    for (let i = 0; i < words.length; i++) {
      if (playheadMs >= words[i].startMs && playheadMs < words[i].endMs) return i;
    }
    if (durationMs > 0 && words.length > 0) {
      const ratio = Math.max(0, Math.min(playheadMs / durationMs, 1));
      return Math.min(Math.floor(ratio * words.length), words.length - 1);
    }
    return -1;
  }, [words, playheadMs, durationMs]);

  const segGroups = useMemo(() => {
    const groups: KaraokeEditSegGroup[] = [];
    let cur: KaraokeEditSegGroup | null = null;
    for (const w of words) {
      if (!cur || cur.segIdx !== w.segIdx) {
        const seg = segments[w.segIdx];
        cur = { segIdx: w.segIdx, speaker: w.speaker, startMs: Math.round(seg.start * 1000), words: [] };
        groups.push(cur);
      }
      cur.words.push(w);
    }
    return groups;
  }, [words, segments]);

  const activeSegGroupIdx = useMemo(() => {
    if (activeIdx < 0) return -1;
    let offset = 0;
    for (let gi = 0; gi < segGroups.length; gi++) {
      if (activeIdx >= offset && activeIdx < offset + segGroups[gi].words.length) return gi;
      offset += segGroups[gi].words.length;
    }
    return -1;
  }, [segGroups, activeIdx]);

  useEffect(() => {
    if (!followPlayhead || !followActive || activeSegGroupIdx < 0) return;
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
  }, [followPlayhead, followActive, activeSegGroupIdx]);

  const handleScroll = () => {
    if (programmaticScrollRef.current) return;
    if (followActive) setFollowActive(false);
  };

  return (
    <div className="karaoke-v2 karaoke-v2--edit" aria-label="Vue karaok\u00e9 \u00e9dition">
      <div className="karaoke-v2-header">
        <span className="karaoke-v2-header-info small mono">
          Mode \u00e9dition \u00b7 {words.length} mots \u00b7 {segments.length} segments
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
        {segGroups.map((group, gi) => {
          const isActive = gi === activeSegGroupIdx;
          const isPast = activeSegGroupIdx >= 0 && gi < activeSegGroupIdx;
          let cls = "karaoke-v2-seg";
          if (isActive) cls += " is-active";
          else if (isPast) cls += " is-past";

          let wordOffset = 0;
          for (let k = 0; k < gi; k++) wordOffset += segGroups[k].words.length;

          return (
            <div
              key={group.segIdx}
              ref={isActive ? activeSegRef : undefined}
              className={cls}
              role="listitem"
            >
              <div className="karaoke-v2-seg-left">
                <span className="karaoke-v2-speaker mono">{group.speaker}</span>
                <span className="karaoke-v2-time mono">
                  {formatClockSeconds(group.startMs / 1000)}
                </span>
              </div>
              <div className="karaoke-v2-seg-body">
                <span className="karaoke-v2-seg-words">
                  {group.words.map((w, wi) => {
                    const globalIdx = wordOffset + wi;
                    const wActive = globalIdx === activeIdx;
                    let wCls = "karaoke-v2-word";
                    if (wActive) wCls += " is-active";
                    return (
                      <button
                        key={wi}
                        type="button"
                        className={wCls}
                        disabled={!onSeekToMs}
                        onClick={() => onSeekToMs?.(w.startMs)}
                      >
                        {w.word}
                      </button>
                    );
                  })}
                </span>
              </div>
              <div className="karaoke-v2-seg-right" />
            </div>
          );
        })}
        {words.length === 0 && (
          <p className="small" style={{ padding: "16px" }}>Aucun mot dans le transcript.</p>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Vues éditables — segments JSON (mode édition)
// ---------------------------------------------------------------------------

function findPlayheadSegment(
  segments: EditableSegment[],
  playheadMs: number,
  durationMs: number,
): number | null {
  if (segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const sMs = Math.round(segments[i].start * 1000);
    const eMs = Math.round(segments[i].end * 1000);
    if (playheadMs >= sMs && playheadMs < eMs) return i;
  }
  if (durationMs > 0 && areTimestampsCorrupted(segments, durationMs)) {
    const ratio = Math.max(0, Math.min(playheadMs / durationMs, 1));
    return Math.min(Math.floor(ratio * segments.length), segments.length - 1);
  }
  return null;
}

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

/* PlayerRythmoEditBody removed — replaced by PlayerRythmoView */

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

  // Compute active word index within the active segment using real word timestamps
  const activeWordInfo = useMemo(() => {
    if (playheadSegIdx == null || playheadSegIdx < 0) return null;
    const seg = segments[playheadSegIdx];
    if (!seg) return null;
    const wds = seg.words;
    if (wds && wds.length > 0) {
      for (let i = 0; i < wds.length; i++) {
        const ws = Math.round(wds[i].start * 1000);
        const we = Math.round(wds[i].end * 1000);
        if (playheadMs >= ws && playheadMs < we) return { segIdx: playheadSegIdx, wordIdx: i };
      }
    }
    return null;
  }, [segments, playheadSegIdx, playheadMs]);

  return (
    <div className="player-words player-words--edit">
      <p className="player-lanes-meta small mono">
        Mode édition · mots par segment
      </p>
      {segments.map((seg, i) => {
        const active = playheadSegIdx === i;
        const focused = activeSegmentIndex === i;
        const textWords = seg.text.split(/\s+/).filter(Boolean);
        const hasRealWords = seg.words && seg.words.length > 0;
        const displayWords = hasRealWords ? seg.words!.map((w) => w.word) : textWords;
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
                {displayWords.map((w, wi) => {
                  const isActiveWord = activeWordInfo?.segIdx === i && activeWordInfo?.wordIdx === wi;
                  return (
                    <li key={wi}>
                      <span className={`player-word-chip${isActiveWord ? " is-active" : ""}`}>{w}</span>
                    </li>
                  );
                })}
                {displayWords.length === 0 ? <li className="small">…</li> : null}
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
