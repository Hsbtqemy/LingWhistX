import { fileBasename, formatClockSeconds } from "../../appUtils";
import type { AlignmentWorkspacePanelProps } from "./AlignmentWorkspacePanel";
import { WaveformOverviewStrip } from "./WaveformOverviewStrip";

export type RunSourceMediaHeroProps = {
  alignment: AlignmentWorkspacePanelProps;
  onOpenSource: () => void;
  onGoAlignment: () => void;
};

/**
 * Fichier source mis en avant dans le workspace (nom, chemin, type, ondeforme overview).
 * Réutilise le même état ondeforme que l’onglet Alignement.
 */
export function RunSourceMediaHero({
  alignment,
  onOpenSource,
  onGoAlignment,
}: RunSourceMediaHeroProps) {
  const job = alignment.selectedJob;
  const waveform = alignment.waveform;
  const durationSec = waveform && waveform.durationSec > 0 ? waveform.durationSec : 0;

  return (
    <section
      className="run-source-media-hero"
      data-job-status={job.status}
      aria-label="Fichier source transcrit et aperçu ondeforme"
    >
      <header className="run-source-media-hero__header">
        <div className="run-source-media-hero__title-row">
          <h3 className="run-source-media-hero__filename">
            {fileBasename(job.inputPath) || job.id}
          </h3>
          <span className={`status-pill ${job.status}`}>{job.status}</span>
          <span className="run-source-media-hero__chip">
            {alignment.selectedIsVideo ? "Vidéo" : "Audio"}
          </span>
          <span className="run-source-media-hero__chip run-source-media-hero__chip--muted">
            {job.mode}
          </span>
        </div>
        <p className="run-source-media-hero__path mono" title={job.inputPath}>
          {job.inputPath}
        </p>
        <div className="run-source-media-hero__actions">
          <button type="button" className="ghost" onClick={onOpenSource}>
            Ouvrir le média
          </button>
          <button type="button" className="ghost" onClick={onGoAlignment}>
            Alignement &amp; ondeforme
          </button>
        </div>
      </header>

      <div className="run-source-media-hero__wave">
        {waveform && durationSec > 0 ? (
          <>
            <WaveformOverviewStrip
              durationSec={durationSec}
              viewStartSec={alignment.waveformViewStartSec}
              viewEndSec={alignment.waveformViewEndSec}
              maxViewStartSec={alignment.waveformMaxViewStartSec}
              overview={alignment.overviewEnvelope}
              isLoading={alignment.isOverviewLoading}
              setViewStartSec={alignment.setWaveformViewStart}
            />
            <p className="run-source-media-hero__wave-meta small">
              Durée {formatClockSeconds(durationSec)} · tête de lecture{" "}
              {formatClockSeconds(alignment.mediaCurrentSec)}
            </p>
          </>
        ) : (
          <div className="run-source-media-hero__wave-empty">
            <p className="small">
              Charge l&apos;ondeforme pour confirmer visuellement le média (même graphe que
              l&apos;onglet Alignement).
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => alignment.loadWaveformForSelectedJob()}
              disabled={alignment.isWaveformLoading}
            >
              {alignment.isWaveformLoading ? "Génération…" : "Charger l’ondeforme"}
            </button>
            {alignment.waveformError ? (
              <p className="run-source-media-hero__wave-err small">{alignment.waveformError}</p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
