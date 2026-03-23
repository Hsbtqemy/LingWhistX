import type { ExplorerLayerToggles } from "../types";
import type { StudioExplorerModel } from "../hooks/useStudioExplorer";

function LayerToggle(props: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="explorer-layer-toggle">
      <input type="checkbox" checked={props.checked} onChange={props.onChange} />
      {props.label}
    </label>
  );
}

/** Barre supérieure Explorer (WX-616). */
export function StudioExplorerTopBar({ explorer: ex }: { explorer: StudioExplorerModel }) {
  return (
    <header className="explorer-topbar" aria-label="Explorateur run">
      <div className="explorer-topbar-row explorer-topbar-row--actions">
        <button
          type="button"
          className="ghost"
          disabled={ex.explorerBusy}
          onClick={() => void ex.pickOpenRun()}
        >
          Ouvrir run
        </button>
        <button type="button" className="ghost" onClick={() => void ex.pickOpenFile()}>
          Ouvrir fichier
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!ex.activeRunSummary || ex.importBusy}
          onClick={() => void ex.importRunEvents()}
        >
          {ex.importBusy ? "Indexation…" : "Indexer événements"}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!ex.hasTranscriptSource}
          onClick={() => void ex.exportTimingPack()}
          title="JSON + SRT + CSV à côté du fichier transcript source"
        >
          Export pack timing
        </button>
      </div>
      <div className="explorer-topbar-row explorer-topbar-row--meta">
        <span className="explorer-resume mono" title="Média / durée (manifest ou fichier)">
          {ex.resumeLine}
        </span>
        <span className="explorer-device" title="Device job / runtime local">
          Device: <strong>{ex.deviceLabel}</strong>
          <span className="explorer-runtime-badges">
            {" "}
            Py {ex.runtimeBadges.python} · WX {ex.runtimeBadges.whisperx} · ff{" "}
            {ex.runtimeBadges.ffmpeg}
          </span>
        </span>
      </div>
      <div className="explorer-status-chips" role="list">
        <span className="explorer-chip" title="Mots (manifest)">
          Mots: {ex.statusChips.words ?? "—"}
        </span>
        <span className="explorer-chip" title="Tours locuteur (manifest)">
          Locuteurs: {ex.statusChips.speakers ?? "—"}
        </span>
        <span className="explorer-chip" title="Avertissements overlap dans le manifest">
          Overlap: {ex.statusChips.overlapWarnings}
        </span>
        <span className="explorer-chip" title="Segments (manifest)">
          Segments: {ex.statusChips.segments ?? "—"}
        </span>
      </div>
      <div className="explorer-topbar-row explorer-topbar-row--nav">
        <button type="button" className="ghost" onClick={() => void ex.seekToNextPause()}>
          Pause suivante
        </button>
        <button type="button" className="ghost" disabled title="Index overlap (à brancher)">
          Overlap suivant
        </button>
        <label className="explorer-goto">
          Aller au temps
          <input
            className="explorer-goto-input mono"
            value={ex.goToTimeInput}
            onChange={(e) => ex.setGoToTimeInput(e.target.value)}
            placeholder="1:02:05 ou 90"
          />
          <button type="button" className="ghost" onClick={() => ex.applyGoToTime()}>
            Go
          </button>
        </label>
      </div>
      {ex.lastImport ? (
        <p className="small explorer-import-hint">
          Index SQLite : {ex.lastImport.nWords} mots, {ex.lastImport.nTurns} tours,{" "}
          {ex.lastImport.nPauses} pauses, {ex.lastImport.nIpus} IPU.
        </p>
      ) : null}
    </header>
  );
}

/** Panneaux calques + locuteurs (colonne latérale). */
export function StudioExplorerSidePanels({ explorer: ex }: { explorer: StudioExplorerModel }) {
  const layers = ex.layers;
  const setLayer = (key: keyof ExplorerLayerToggles) => () => ex.toggleLayer(key);

  return (
    <div className="explorer-panels explorer-panels--sidebar">
      <section className="explorer-card" aria-labelledby="explorer-layers-title">
        <h3 id="explorer-layers-title" className="explorer-card-title">
          Calques
        </h3>
        <p className="small explorer-card-hint">
          Préférences UI (session). Branchement requêtes timeline à venir.
        </p>
        <div className="explorer-layer-grid">
          <LayerToggle label="Turns" checked={layers.turns} onChange={setLayer("turns")} />
          <LayerToggle label="Pauses" checked={layers.pauses} onChange={setLayer("pauses")} />
          <LayerToggle label="IPU" checked={layers.ipus} onChange={setLayer("ipus")} />
          <LayerToggle label="Overlap" checked={layers.overlap} onChange={setLayer("overlap")} />
          <LayerToggle label="Mots" checked={layers.words} onChange={setLayer("words")} />
          <LayerToggle
            label="Mots (auto zoom)"
            checked={layers.wordsAutoZoom}
            onChange={setLayer("wordsAutoZoom")}
          />
          <LayerToggle label="Segments" checked={layers.segments} onChange={setLayer("segments")} />
        </div>
      </section>

      <section className="explorer-card" aria-labelledby="explorer-speakers-title">
        <h3 id="explorer-speakers-title" className="explorer-card-title">
          Locuteurs
        </h3>
        {ex.speakerRows.length === 0 ? (
          <p className="small">Indexer le run pour lister les locuteurs SQLite.</p>
        ) : (
          <ul className="explorer-speaker-list">
            {ex.speakerRows.map((row) => (
              <li key={row.id} className="explorer-speaker-row">
                <input
                  type="text"
                  className="explorer-speaker-alias mono"
                  value={row.alias}
                  onChange={(e) => ex.updateSpeakerAlias(row.id, e.target.value)}
                  aria-label={`Alias ${row.id}`}
                />
                <label className="explorer-speaker-vis">
                  <input
                    type="checkbox"
                    checked={row.visible}
                    onChange={() => ex.toggleSpeakerVisible(row.id)}
                  />
                  Vis.
                </label>
                <button
                  type="button"
                  className={`ghost explorer-solo ${ex.soloSpeakerId === row.id ? "is-active" : ""}`}
                  onClick={() => ex.toggleSolo(row.id)}
                >
                  Solo
                </button>
                <span className="mono explorer-speaker-id">{row.id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="explorer-card" aria-labelledby="explorer-recalc-title">
        <h3 id="explorer-recalc-title" className="explorer-card-title">
          Pauses / IPU (Rust)
        </h3>
        <p className="small explorer-card-hint">
          Recalcul rapide depuis <code>words</code> — aucun WhisperX. Aperçu automatique ; bouton
          pour écrire <code>pauses</code> / <code>ipus</code> dans SQLite.
        </p>
        <div className="explorer-recalc-grid">
          <label>
            Pause min (s)
            <input
              type="text"
              inputMode="decimal"
              className="explorer-recalc-input"
              value={ex.recalcMinPauseInput}
              onChange={(e) => ex.setRecalcMinPauseInput(e.target.value)}
            />
          </label>
          <label>
            Ignorer sous (s)
            <input
              type="text"
              inputMode="decimal"
              className="explorer-recalc-input"
              value={ex.recalcIgnoreBelowInput}
              onChange={(e) => ex.setRecalcIgnoreBelowInput(e.target.value)}
            />
          </label>
          <label>
            Pause max (s)
            <input
              type="text"
              inputMode="decimal"
              className="explorer-recalc-input"
              value={ex.recalcPauseMaxInput}
              onChange={(e) => ex.setRecalcPauseMaxInput(e.target.value)}
              placeholder="optionnel"
            />
          </label>
          <label>
            IPU mots min
            <input
              type="text"
              inputMode="numeric"
              className="explorer-recalc-input"
              value={ex.recalcIpuMinWordsInput}
              onChange={(e) => ex.setRecalcIpuMinWordsInput(e.target.value)}
            />
          </label>
          <label className="explorer-recalc-span2">
            IPU durée min (s)
            <input
              type="text"
              inputMode="decimal"
              className="explorer-recalc-input"
              value={ex.recalcIpuMinDurInput}
              onChange={(e) => ex.setRecalcIpuMinDurInput(e.target.value)}
            />
          </label>
        </div>
        <div className="explorer-recalc-actions">
          <button
            type="button"
            className="primary"
            disabled={!ex.activeRunSummary || ex.recalcBusy}
            onClick={() => void ex.applyRecalcPersist()}
          >
            {ex.recalcBusy ? "Calcul…" : "Appliquer → SQLite"}
          </button>
          {ex.recalcBusy ? <span className="small">Aperçu ou écriture…</span> : null}
        </div>
        {ex.recalcStats ? (
          <dl className="explorer-recalc-stats">
            <div>
              <dt># Pauses</dt>
              <dd>{ex.recalcStats.nPauses}</dd>
            </div>
            <div>
              <dt>Durée pause moy.</dt>
              <dd>{ex.recalcStats.pauseDurationMeanMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>Durée pause p95</dt>
              <dd>{ex.recalcStats.pauseDurationP95Ms.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt># IPU</dt>
              <dd>{ex.recalcStats.nIpus}</dd>
            </div>
            <div>
              <dt>Overlap total</dt>
              <dd>{ex.recalcStats.overlapTotalMs} ms</dd>
            </div>
          </dl>
        ) : (
          <p className="small">Ouvre un run indexé pour prévisualiser les stats.</p>
        )}
      </section>
    </div>
  );
}
