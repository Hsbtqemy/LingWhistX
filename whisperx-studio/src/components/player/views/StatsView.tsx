import { useCallback, useMemo, useState } from "react";
import { formatClockSeconds } from "../../../appUtils";
import {
  buildSpeechTimeline,
  clipRowsToBrush,
  computeOverlaps as computeTurnOverlaps,
  computeSpeakerStats,
  computeSpeechDensity,
  computeSpeechRate,
  computeTransitions,
  percentile,
} from "../../../player/playerSpeakerStats";
import type { BrushRange } from "../../../player/playerSpeakerStats";
import type { EventPauseRow, QueryWindowResult } from "../../../types";
import { speakerColor } from "./viewUtils";
import {
  PauseHistogramCanvas,
  SpeechBarCanvas,
  SpeechDensityCanvas,
  SpeechRateCanvas,
  SpeechTimelineCanvas,
} from "./statsCanvases";

export function PlayerStatsBody({
  slice,
  playheadMs,
  durationSec,
  onSeekToMs,
  brushRange = null,
  onBrushChange,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  durationSec?: number | null;
  onSeekToMs?: (ms: number) => void;
  brushRange?: BrushRange | null;
  onBrushChange?: (range: BrushRange | null) => void;
}) {
  const totalDurationMs =
    durationSec != null && Number.isFinite(durationSec) ? durationSec * 1000 : undefined;

  const hasWords = slice.words.length > 0;

  const durMs = totalDurationMs ?? Math.max(0, ...slice.turns.map((t) => t.endMs));

  // Rows clipped to brush for stats — unclipped for canvas rendering
  const activeTurns = useMemo(
    () => (brushRange ? clipRowsToBrush(slice.turns, brushRange) : slice.turns),
    [slice.turns, brushRange],
  );
  const activePauses = useMemo(
    () => (brushRange ? clipRowsToBrush(slice.pauses, brushRange) : slice.pauses),
    [slice.pauses, brushRange],
  );
  const activeIpus = useMemo(
    () => (brushRange ? clipRowsToBrush(slice.ipus, brushRange) : slice.ipus),
    [slice.ipus, brushRange],
  );
  const activeWords = useMemo(
    () => (brushRange ? clipRowsToBrush(slice.words, brushRange) : slice.words),
    [slice.words, brushRange],
  );

  const brushDurMs = brushRange ? brushRange.endMs - brushRange.startMs : durMs;

  const stats = useMemo(
    () =>
      computeSpeakerStats(
        activeTurns,
        activePauses,
        activeIpus,
        brushDurMs,
        hasWords ? activeWords : undefined,
      ),
    [activeTurns, activePauses, activeIpus, activeWords, brushDurMs, hasWords],
  );

  const activeSpeaker = useMemo(() => {
    const activeTurn = slice.turns.find((t) => playheadMs >= t.startMs && playheadMs < t.endMs);
    return activeTurn?.speaker ?? null;
  }, [slice.turns, playheadMs]);

  const speakers = useMemo(() => stats.map((s) => s.speaker), [stats]);

  // Full timeline for canvas rendering (always unfiltered)
  const timeline = useMemo(() => buildSpeechTimeline(slice.turns), [slice.turns]);

  const overlaps = useMemo(
    () => computeTurnOverlaps(activeTurns, brushDurMs),
    [activeTurns, brushDurMs],
  );

  const rateSeries = useMemo(() => computeSpeechRate(slice.ipus, durMs), [slice.ipus, durMs]);

  const transitions = useMemo(() => computeTransitions(activeTurns), [activeTurns]);

  const densityPoints = useMemo(
    () => computeSpeechDensity(slice.turns, durMs),
    [slice.turns, durMs],
  );

  const [collapsedSpeakers, setCollapsedSpeakers] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((sp: string) => {
    setCollapsedSpeakers((prev) => {
      const next = new Set(prev);
      if (next.has(sp)) next.delete(sp);
      else next.add(sp);
      return next;
    });
  }, []);

  const [expandedCharts, setExpandedCharts] = useState<Set<string>>(new Set());
  const toggleChartExpand = useCallback((id: string) => {
    setExpandedCharts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [pauseMinMs, setPauseMinMs] = useState(0);
  const [pauseSpeakerFilter, setPauseSpeakerFilter] = useState<string>("__all__");
  const [pauseTypeFilter, setPauseTypeFilter] = useState<string>("__all__");
  const [pauseListExpanded, setPauseListExpanded] = useState(false);

  // Intentionally unfiltered: context words before/after a pause benefit from the full word list,
  // including words just outside the brush boundary.
  const sortedWords = useMemo(
    () => [...slice.words].sort((a, b) => a.startMs - b.startMs),
    [slice.words],
  );

  const filteredPauses = useMemo(() => {
    let result = activePauses.filter((p) => p.durMs >= pauseMinMs);
    if (pauseSpeakerFilter !== "__all__") {
      result = result.filter((p) => (p.speaker ?? "?") === pauseSpeakerFilter);
    }
    if (pauseTypeFilter !== "__all__") {
      result = result.filter((p) => (p.type ?? "unknown") === pauseTypeFilter);
    }
    return result.sort((a, b) => a.startMs - b.startMs);
  }, [activePauses, pauseMinMs, pauseSpeakerFilter, pauseTypeFilter]);

  const allPauseDurationsMs = useMemo(() => filteredPauses.map((p) => p.durMs), [filteredPauses]);

  const pauseTypes = useMemo(() => {
    const s = new Set<string>();
    for (const p of activePauses) s.add(p.type ?? "unknown");
    return [...s].sort();
  }, [activePauses]);

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
  const silenceMs = Math.max(0, brushDurMs - totalSpeechMs);
  const globalRate = totalSpeechMs > 0 ? (totalWords / (totalSpeechMs / 1000)) * 60 : 0;

  const qualityScore = useMemo(() => {
    const confScores = stats.filter((s) => s.meanConfidence != null).map((s) => s.meanConfidence!);
    const avgConf =
      confScores.length > 0 ? confScores.reduce((a, b) => a + b, 0) / confScores.length : null;
    const totalAligned = stats.reduce((sum, s) => sum + (s.alignmentDist["aligned"] ?? 0), 0);
    const totalAlignmentWords = stats.reduce(
      (sum, s) => sum + Object.values(s.alignmentDist).reduce((a, b) => a + b, 0),
      0,
    );
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
      {/* Brush indicator */}
      {brushRange && (
        <div className="stats-brush-info">
          <span className="stats-brush-range">
            {formatClockSeconds(brushRange.startMs / 1000)}
            {" – "}
            {formatClockSeconds(brushRange.endMs / 1000)}
            {" · "}
            {formatClockSeconds(brushDurMs / 1000)}
          </span>
          <button
            type="button"
            className="stats-brush-reset-btn"
            onClick={() => onBrushChange?.(null)}
          >
            Réinitialiser ×
          </button>
        </div>
      )}

      {/* Résumé global */}
      <div className="stats-summary">
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{formatClockSeconds(brushDurMs / 1000)}</span>
          <span className="stats-summary-label">{brushRange ? "Sélection" : "Durée totale"}</span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">
            {formatClockSeconds(totalSpeechMs / 1000)}
          </span>
          <span className="stats-summary-label">
            Parole ({brushDurMs > 0 ? ((totalSpeechMs / brushDurMs) * 100).toFixed(1) : "0"}%)
          </span>
        </div>
        <div className="stats-summary-item">
          <span className="stats-summary-value mono">{formatClockSeconds(silenceMs / 1000)}</span>
          <span className="stats-summary-label">
            Silence ({brushDurMs > 0 ? ((silenceMs / brushDurMs) * 100).toFixed(1) : "0"}%)
          </span>
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
          <div
            className={`stats-summary-item${qualityScore >= 80 ? " quality-good" : qualityScore >= 60 ? " quality-ok" : " quality-low"}`}
          >
            <span className="stats-summary-value mono">{qualityScore}</span>
            <span className="stats-summary-label">Qualit{"é"} /100</span>
          </div>
        )}
      </div>

      {/* Répartition du temps de parole */}
      <div className="player-stats-section">
        <h4 className="player-stats-section-title">
          Répartition du temps de parole
          <button
            type="button"
            className="stats-chart-expand-btn"
            onClick={() => toggleChartExpand("bar")}
            title={expandedCharts.has("bar") ? "Réduire" : "Agrandir"}
          >
            {expandedCharts.has("bar") ? "↙" : "↗"}
          </button>
        </h4>
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
        <SpeechBarCanvas
          stats={stats}
          totalDurationMs={durMs}
          activeSpeaker={activeSpeaker}
          onSeekToMs={onSeekToMs}
          expanded={expandedCharts.has("bar")}
        />
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
          <button
            type="button"
            className="stats-chart-expand-btn"
            onClick={() => toggleChartExpand("timeline")}
            title={expandedCharts.has("timeline") ? "Réduire" : "Agrandir"}
          >
            {expandedCharts.has("timeline") ? "↙" : "↗"}
          </button>
        </h4>
        <SpeechTimelineCanvas
          timeline={timeline}
          speakers={speakers}
          totalDurationMs={durMs}
          playheadMs={playheadMs}
          onSeekToMs={onSeekToMs}
          overlapSegments={overlaps.segments}
          expanded={expandedCharts.has("timeline")}
          brushRange={brushRange}
          onBrushChange={onBrushChange}
        />
      </div>

      {/* Débit de parole */}
      {rateSeries.length > 0 && (
        <div className="player-stats-section">
          <h4 className="player-stats-section-title">
            Débit de parole (mots/min)
            <button
              type="button"
              className="stats-chart-expand-btn"
              onClick={() => toggleChartExpand("rate")}
              title={expandedCharts.has("rate") ? "Réduire" : "Agrandir"}
            >
              {expandedCharts.has("rate") ? "↙" : "↗"}
            </button>
          </h4>
          <div className="player-stats-legend">
            {rateSeries.map((s) => {
              const si = speakers.indexOf(s.speaker);
              return (
                <span key={s.speaker} className="player-stats-legend-item">
                  <span
                    className="player-stats-legend-dot"
                    style={{ background: speakerColor(si >= 0 ? si : 0) }}
                  />
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
            expanded={expandedCharts.has("rate")}
            brushRange={brushRange}
            onBrushChange={onBrushChange}
          />
        </div>
      )}

      {/* Densité de parole */}
      {densityPoints.length > 0 && (
        <div className="player-stats-section">
          <h4 className="player-stats-section-title">
            Densit{"é"} de parole (activit{"é"} vocale)
            <button
              type="button"
              className="stats-chart-expand-btn"
              onClick={() => toggleChartExpand("density")}
              title={expandedCharts.has("density") ? "Réduire" : "Agrandir"}
            >
              {expandedCharts.has("density") ? "↙" : "↗"}
            </button>
          </h4>
          <SpeechDensityCanvas
            points={densityPoints}
            totalDurationMs={durMs}
            playheadMs={playheadMs}
            onSeekToMs={onSeekToMs}
            expanded={expandedCharts.has("density")}
            brushRange={brushRange}
            onBrushChange={onBrushChange}
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
                  {tr.medianGapMs < 0 && (
                    <span className="stats-transition-overlap"> (overlap)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pauses — section dédiée */}
      {activePauses.length > 0 && (
        <div className="player-stats-section">
          <h4 className="player-stats-section-title">
            Pauses ({filteredPauses.length}
            {filteredPauses.length !== activePauses.length ? ` / ${activePauses.length}` : ""})
          </h4>

          {/* Filtres */}
          <div className="stats-pause-filters">
            <label className="stats-pause-filter small">
              Seuil min
              <select value={pauseMinMs} onChange={(e) => setPauseMinMs(Number(e.target.value))}>
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
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>
            </label>
            <label className="stats-pause-filter small">
              Type
              <select value={pauseTypeFilter} onChange={(e) => setPauseTypeFilter(e.target.value)}>
                <option value="__all__">Tous</option>
                {pauseTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Histogramme agrégé */}
          {allPauseDurationsMs.length > 0 && (
            <div className="player-stats-histogram">
              <div className="player-stats-histogram-header">
                <span className="player-stats-histogram-label small">Distribution</span>
                <button
                  type="button"
                  className="stats-chart-expand-btn"
                  onClick={() => toggleChartExpand("pauses-hist")}
                  title={expandedCharts.has("pauses-hist") ? "Réduire" : "Agrandir"}
                >
                  {expandedCharts.has("pauses-hist") ? "↙" : "↗"}
                </button>
              </div>
              <PauseHistogramCanvas
                durationsMs={allPauseDurationsMs}
                activeColor="var(--lx-accent)"
                expanded={expandedCharts.has("pauses-hist")}
              />
            </div>
          )}

          {/* Stats résumées */}
          {filteredPauses.length > 0 &&
            (() => {
              const sorted = [...allPauseDurationsMs].sort((a, b) => a - b);
              const total = sorted.reduce((s, d) => s + d, 0);
              const mean = total / sorted.length;
              const med = percentile(sorted, 50);
              const p90 = percentile(sorted, 90);
              const min = sorted[0];
              const max = sorted[sorted.length - 1];
              return (
                <dl className="player-stats-dl stats-pause-summary-dl">
                  <dt>Total</dt>
                  <dd>{formatClockSeconds(total / 1000)}</dd>
                  <dt>Moy.</dt>
                  <dd>{Math.round(mean)} ms</dd>
                  <dt>Méd.</dt>
                  <dd>{Math.round(med)} ms</dd>
                  <dt>P90</dt>
                  <dd>{Math.round(p90)} ms</dd>
                  <dt>Min / Max</dt>
                  <dd>
                    {Math.round(min)} / {Math.round(max)} ms
                  </dd>
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
                        {p.durMs >= 1000
                          ? `${(p.durMs / 1000).toFixed(1)}s`
                          : `${Math.round(p.durMs)}ms`}
                      </span>
                      <span
                        className={`stats-pause-list-type${typeLabel.includes("inter") ? " is-inter" : ""}`}
                      >
                        {typeLabel}
                      </span>
                      <span className="stats-pause-list-speaker">{spLabel}</span>
                      <span
                        className="stats-pause-list-context"
                        title={`${ctx.before} ▏ ${ctx.after}`}
                      >
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
            const pauseTypeEntries = Object.entries(s.pausesByType).sort(
              (a, b) => b[1].count - a[1].count,
            );
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
                  <span className="stats-card-collapse-icon">
                    {isCollapsed ? "\u25B6" : "\u25BC"}
                  </span>
                  {isActive && <span className="player-stats-active-badge">en cours</span>}
                </button>

                {!isCollapsed && (
                  <>
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
                      <dd>
                        {s.nTurns}
                        {s.meanTurnDurMs > 0
                          ? ` (moy. ${(s.meanTurnDurMs / 1000).toFixed(1)}s)`
                          : ""}
                      </dd>
                      {s.ttr != null && (
                        <>
                          <dt>Diversité lex.</dt>
                          <dd>
                            {(s.ttr * 100).toFixed(0)} % TTR ({s.nUniqueTokens} uniques / {s.nWords}
                            )
                          </dd>
                        </>
                      )}
                    </dl>

                    {/* IPU */}
                    <div className="player-stats-subsection">
                      <p className="player-stats-subsection-title small">IPU ({s.nIpus})</p>
                      <dl className="player-stats-dl">
                        <dt>Durée moy.</dt>
                        <dd>
                          {s.meanIpuDurMs > 0 ? `${Math.round(s.meanIpuDurMs)} ms` : "\u2014"}
                        </dd>
                        <dt>Min / Max</dt>
                        <dd>
                          {s.nIpus > 0
                            ? `${Math.round(s.minIpuDurMs)} / ${Math.round(s.maxIpuDurMs)} ms`
                            : "\u2014"}
                        </dd>
                      </dl>
                      {s.topIpus.length > 0 && (
                        <div className="stats-top-ipus">
                          <p className="player-stats-subsection-title small">
                            Top {s.topIpus.length} IPU
                          </p>
                          {s.topIpus.map((ti, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className="stats-top-ipu-item"
                              disabled={!onSeekToMs}
                              onClick={() => onSeekToMs?.(ti.startMs)}
                              title={`${formatClockSeconds(ti.startMs / 1000)} \u2014 ${ti.nWords} mots, ${Math.round(ti.durMs)} ms`}
                            >
                              <span className="stats-top-ipu-dur mono">
                                {(ti.durMs / 1000).toFixed(1)}s
                              </span>
                              <span className="stats-top-ipu-text">
                                {ti.text.length > 60
                                  ? ti.text.slice(0, 60) + "\u2026"
                                  : ti.text || "\u2014"}
                              </span>
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
                        <dd>
                          {s.totalPauseMs > 0
                            ? formatClockSeconds(s.totalPauseMs / 1000)
                            : "\u2014"}
                        </dd>
                        <dt>Moy. / Méd.</dt>
                        <dd>
                          {s.meanPauseDurMs > 0
                            ? `${Math.round(s.meanPauseDurMs)} / ${Math.round(s.medianPauseDurMs)} ms`
                            : "\u2014"}
                        </dd>
                        <dt>P90</dt>
                        <dd>
                          {s.p90PauseDurMs > 0 ? `${Math.round(s.p90PauseDurMs)} ms` : "\u2014"}
                        </dd>
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
                          <dd>
                            {s.lowConfidencePct != null
                              ? `${(s.lowConfidencePct * 100).toFixed(1)} %`
                              : "\u2014"}
                          </dd>
                        </dl>
                        {Object.keys(s.alignmentDist).length > 0 && (
                          <div className="stats-alignment-dist">
                            {Object.entries(s.alignmentDist)
                              .sort((a, b) => b[1] - a[1])
                              .map(([status, count]) => (
                                <span key={status} className="stats-alignment-chip small">
                                  {status}: {count}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
