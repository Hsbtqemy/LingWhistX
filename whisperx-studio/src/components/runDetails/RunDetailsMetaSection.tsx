import { formatTimestamp } from "../../appUtils";
import type { Job } from "../../types";
import { WorkerErrorMessage } from "../../WorkerErrorMessage";
import { ErrorBanner } from "../ErrorBanner";

export type RunDetailsMetaSectionProps = {
  job: Job;
  onOpenInput: () => void;
  onOpenOutput: () => void;
};

export function RunDetailsMetaSection({
  job,
  onOpenInput,
  onOpenOutput,
}: RunDetailsMetaSectionProps) {
  return (
    <>
      <div className="details-meta">
        <p>
          <strong>Entrée :</strong> {job.inputPath}
        </p>
        <p>
          <strong>Sortie :</strong> {job.outputDir}
        </p>
        <p>
          <strong>Créé le :</strong> {formatTimestamp(job.createdAtMs)}
        </p>
        <p>
          <strong>Statut :</strong> {job.status}
        </p>
      </div>

      {job.error ? (
        <ErrorBanner multiline className="details-error-banner">
          <h3 className="error-banner-heading">Échec du pipeline</h3>
          <WorkerErrorMessage text={job.error} />
        </ErrorBanner>
      ) : null}

      <div className="details-actions">
        <button type="button" className="ghost" onClick={onOpenInput}>
          Ouvrir media source
        </button>
        <button type="button" className="ghost" onClick={onOpenOutput}>
          Exporter (ouvrir dossier)
        </button>
      </div>
    </>
  );
}
