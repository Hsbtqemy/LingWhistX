import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { formatClockSeconds } from "../../../appUtils";
import type {
  EditableSegment,
  EventIpuRow,
  EventPauseRow,
  QueryWindowResult,
} from "../../../types";
import {} from "./viewUtils";

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
      offsetPct: Math.max(
        0,
        Math.min(100, ((Math.round(w.start * 1000) - blockStartMs) / blockDurMs) * 100),
      ),
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
    const label =
      step < 1000
        ? `${min}:${sec.toFixed(1).padStart(4, "0")}`
        : `${min}:${Math.floor(sec).toString().padStart(2, "0")}`;
    ticks.push({ posMs: ms, label });
  }
  return ticks;
}

export function PlayerRythmoView({
  slice,
  playheadMs,
  onSeekToMs,
  editMode = false,
  editorSegments,
  onFocusSegment,
  onUpdateText,
  durationSec,
  longPauseMs = 300,
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
  longPauseMs?: number;
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

  const speakerIdx = useMemo(() => new Map(speakers.map((s, i) => [s, i])), [speakers]);

  const overlaps = useMemo(() => computeOverlaps(blocks, speakers), [blocks, speakers]);

  const pauses: EventPauseRow[] = useMemo(
    () => (slice.pauses ?? []).filter((p) => p.durMs >= longPauseMs),
    [slice.pauses, longPauseMs],
  );

  const visibleMs = zoomSec * 1000;
  const pxPerMs = containerWidth / visibleMs;
  const effectivePlayheadMs = dragging ? playheadMs + dragOffsetMs : playheadMs;
  const stripTranslateX = Math.round(containerWidth / 2 - effectivePlayheadMs * pxPerMs);
  const totalMs =
    durationSec != null && Number.isFinite(durationSec) && durationSec > 0
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
    else if (e.deltaY > 0 && idx < RYTHMO_ZOOM_PRESETS.length - 1)
      setZoomSec(RYTHMO_ZOOM_PRESETS[idx + 1]);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".player-rythmo-v2-block")) return;
    dragRef.current = { startX: e.clientX, startPlayheadMs: playheadMs };
    setDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
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
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
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

  const laneHeight =
    zoomSec <= 2
      ? 220
      : zoomSec <= 3
        ? 190
        : zoomSec <= 4
          ? 170
          : zoomSec <= 5
            ? 160
            : zoomSec <= 10
              ? 130
              : zoomSec <= 30
                ? 220
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
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
          setDragOffsetMs(0);
        }}
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
          const lanePauses = pauses.filter(
            (p) => (p.speaker ?? "") === sp || (!p.speaker && speakers.length === 1),
          );
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
                {/* Pause markers — filtrés par longPauseMs (WX-713) */}
                {lanePauses.map((p) => {
                  if (p.endMs < visStartMs || p.startMs > visEndMs) return null;
                  const pw = Math.max(2, (p.endMs - p.startMs) * pxPerMs);
                  const typeLabel =
                    p.type === "inter_turn"
                      ? "inter-tour"
                      : p.type === "intra_turn"
                        ? "intra-tour"
                        : null;
                  const tooltip = typeLabel
                    ? `Pause ${typeLabel} — ${(p.durMs / 1000).toFixed(2)} s`
                    : `Pause — ${(p.durMs / 1000).toFixed(2)} s`;
                  return (
                    <button
                      key={`p-${p.id}`}
                      type="button"
                      className={`player-rythmo-v2-pause${p.type === "inter_turn" ? " player-rythmo-v2-pause--inter" : ""}`}
                      style={{ left: `${p.startMs * pxPerMs}px`, width: `${pw}px` }}
                      title={tooltip}
                      onClick={() => onSeekToMs?.(p.startMs)}
                    >
                      {pw > 28 ? (
                        <span className="player-rythmo-v2-pause-label">
                          {(p.durMs / 1000).toFixed(1)}
                        </span>
                      ) : null}
                    </button>
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
                      style={
                        {
                          left: `${block.startMs * pxPerMs}px`,
                          width: `${blockW}px`,
                          "--rythmo-sp": `var(--lx-speaker-${spI}, var(--lx-accent))`,
                        } as CSSProperties
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBlockClick(block);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleBlockDoubleClick(block);
                      }}
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
                        <span className="player-rythmo-v2-block-text">{block.text || "…"}</span>
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
