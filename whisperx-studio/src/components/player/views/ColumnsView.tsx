import { useMemo, useState } from "react";
import { formatClockSeconds } from "../../../appUtils";
import {
  buildTimeBins,
  turnsForSpeakerInBin,
  uniqueSpeakersFromTurns,
} from "../../../player/playerColumnsBins";
import type { QueryWindowResult } from "../../../types";
import { speakerColor, turnTextFromIpus } from "./viewUtils";

type ColumnsLayoutMode = "time" | "turn";

export function PlayerColumnsBody({
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

  const turnTextCache = useMemo(() => {
    const cache = new Map<number, string>();
    for (const t of slice.turns) {
      cache.set(t.id, turnTextFromIpus(t, slice.ipus));
    }
    return cache;
  }, [slice.turns, slice.ipus]);

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

              let cls = "player-columns-turn-card";
              if (isActive) cls += " is-active";
              else if (isPast) cls += " is-past";

              return (
                <button
                  key={t.id}
                  type="button"
                  className={cls}
                  disabled={!onSeekToMs}
                  onClick={() => onSeekToMs?.(t.startMs)}
                  title={`${formatClockSeconds(t.startMs / 1000)} – ${formatClockSeconds(t.endMs / 1000)} · cliquer pour lire`}
                >
                  <span
                    className="player-columns-turn-sp mono"
                    style={{ color: speakerColor(spIdx) }}
                  >
                    {t.speaker || "\u2014"}
                  </span>
                  <span className="player-columns-turn-text">{text || "\u2026"}</span>
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
