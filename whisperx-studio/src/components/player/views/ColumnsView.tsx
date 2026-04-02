import { useMemo, useState } from "react";
import { formatClockSeconds } from "../../../appUtils";
import {
  buildTimeBins,
  turnsForSpeakerInBin,
  uniqueSpeakersFromTurns,
} from "../../../player/playerColumnsBins";
import type { EditableSegment, QueryWindowResult } from "../../../types";
import {
  buildOrdinalSegmentIndex,
  findSegmentIndexForTurn,
  speakerColor,
  turnTextFromIpus,
  turnTextFromSegments,
} from "./viewUtils";

type ColumnsLayoutMode = "time" | "turn";

export function PlayerColumnsBody({
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
                        const isPast = activeIndex >= 0 && bin.endMs <= playheadMs && !playHeadHere;
                        const seekTo = first
                          ? Math.max(bin.startMs, Math.min(first.startMs, bin.endMs - 1))
                          : bin.startMs;
                        const preview = first
                          ? (turnTextCache.get(first.id) ?? "").slice(0, 30)
                          : "";

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
                                  {inBin.length > 1
                                    ? `${inBin.length}×`
                                    : preview
                                      ? preview.split(" ").slice(0, 3).join(" ")
                                      : "●"}
                                </span>
                              ) : (
                                ""
                              )}
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
              const segIdx =
                editMode && editorSegments
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
                  <span
                    className="player-columns-turn-sp mono"
                    style={{ color: speakerColor(spIdx) }}
                  >
                    {t.speaker || "\u2014"}
                  </span>
                  {isEditingThis && segIdx != null && onUpdateText ? (
                    <textarea
                      className="player-inline-edit-textarea"
                      value={editorSegments![segIdx].text}
                      onChange={(ev) => onUpdateText(segIdx, ev.target.value)}
                      onBlur={() => setEditingTurnId(null)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" && !ev.shiftKey) {
                          ev.preventDefault();
                          setEditingTurnId(null);
                        }
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
