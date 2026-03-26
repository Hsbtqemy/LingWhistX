import type { ExplorerLayerToggles } from "../types";
import type { StudioExplorerModel } from "../hooks/useStudioExplorer";
import { runInTransition } from "../whisperxOptionsTransitions";
import { LayerList, StatsCard } from "./ui";

/** Barre supérieure Explorer — 3 groupes (audit §B.4, WX-628). */
export function StudioExplorerTopBar({ explorer: ex }: { explorer: StudioExplorerModel }) {
  const statsItems = [
    {
      label: "Mots",
      value: String(ex.statusChips.words ?? "—"),
      title: "Mots (manifest)",
    },
    {
      label: "Segments",
      value: String(ex.statusChips.segments ?? "—"),
      title: "Segments (manifest)",
    },
    {
      label: "Locuteurs",
      value: String(ex.statusChips.speakers ?? "—"),
      title: "Tours locuteur (manifest)",
    },
    {
      label: "Overlap",
      value: String(ex.statusChips.overlapWarnings),
      title: "Avertissements overlap dans le manifest",
    },
  ];

  return (
    <header className="explorer-topbar" aria-label="Explorateur run">
      <div
        className="explorer-topbar-group explorer-topbar-group--file"
        aria-label="Fichier et média"
      >
        <div className="explorer-topbar-group__actions">
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
        </div>
        <span className="explorer-topbar-sep" aria-hidden="true" />
        <span className="explorer-resume mono" title="Média / durée (manifest ou fichier)">
          {ex.resumeLine}
        </span>
      </div>

      <div
        className="explorer-topbar-group explorer-topbar-group--index"
        aria-label="Index, export et runtime"
      >
        <div className="explorer-topbar-group__actions">
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
        <span className="explorer-topbar-sep explorer-topbar-sep--wide" aria-hidden="true" />
        <span className="explorer-device" title="Device job / runtime local">
          Device: <strong>{ex.deviceLabel}</strong>
          <span className="explorer-runtime-badges">
            {" "}
            Py {ex.runtimeBadges.python} · WX {ex.runtimeBadges.whisperx} · ff{" "}
            {ex.runtimeBadges.ffmpeg}
          </span>
        </span>
      </div>

      <div
        className="explorer-topbar-group explorer-topbar-group--nav"
        aria-label="Navigation temps et manifest"
      >
        <div className="explorer-topbar-nav-row">
          <button type="button" className="ghost" onClick={() => void ex.seekToNextPause()}>
            Pause suivante
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
        <StatsCard items={statsItems} />
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
  const setLayer = (key: keyof ExplorerLayerToggles) => () =>
    runInTransition(() => ex.toggleLayer(key));

  const layerItems = [
    {
      id: "turns",
      label: "Turns",
      checked: layers.turns,
      onChange: setLayer("turns"),
    },
    {
      id: "pauses",
      label: "Pauses",
      checked: layers.pauses,
      onChange: setLayer("pauses"),
    },
    {
      id: "ipus",
      label: "IPU",
      checked: layers.ipus,
      onChange: setLayer("ipus"),
    },
    {
      id: "words",
      label: "Mots",
      checked: layers.words,
      onChange: setLayer("words"),
    },
  ];

  return (
    <div className="explorer-panels explorer-panels--sidebar">
      <section className="explorer-card" aria-labelledby="explorer-layers-title">
        <h3 id="explorer-layers-title" className="explorer-card-title">
          Calques
        </h3>
        <p className="small explorer-card-hint">
          Préférences pour la session. Ces cases correspondent aux filtres <code>words</code>,{" "}
          <code>turns</code>, <code>pauses</code> et <code>ipus</code> de la requête SQLite{" "}
          <code>query_run_events_window</code> (index <code>events.sqlite</code> requis).
        </p>
        <LayerList aria-label="Calques événements indexés" items={layerItems} />
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
                    onChange={() =>
                      runInTransition(() => ex.toggleSpeakerVisible(row.id))
                    }
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
        <p className="small explorer-card-hint">
          <strong>IPU</strong> (unité inter-pausale) : bloc de parole continu entre deux pauses
          détectées. Les mots restent dans le même IPU tant qu&apos;aucun silence entre deux mots
          n&apos;atteint la durée &quot;Pause min&quot; ; au-delà, une ligne pause est créée et
          l&apos;IPU suivant commence. Les écarts très courts peuvent être ignorés
          (&quot;Ignorer sous&quot;) ou ramenés (&quot;Pause max&quot;).
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
