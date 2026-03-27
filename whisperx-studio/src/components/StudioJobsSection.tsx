import { JobsHistoryPanel, type JobsHistoryPanelProps } from "./JobsHistoryPanel";

export type StudioJobsSectionProps = {
  jobsHistory: JobsHistoryPanelProps;
};

/** Onglet Historique — liste des jobs en pleine largeur (hors colonne Studio). */
export function StudioJobsSection({ jobsHistory }: StudioJobsSectionProps) {
  return (
    <div className="studio-jobs-page">
      <JobsHistoryPanel {...jobsHistory} />
    </div>
  );
}
