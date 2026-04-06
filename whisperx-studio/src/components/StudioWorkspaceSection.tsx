import type { NewJobFormApi } from "../hooks/useNewJobForm";
import type { StudioView } from "../types";
import type { RunDetailsPanelProps } from "./runDetails/RunDetailsPanel";
import { SessionRestoreBanner } from "./SessionRestoreBanner";
import type { SessionRestoreBannerProps } from "./SessionRestoreBanner";
import { StudioNewJobSection } from "./StudioNewJobSection";
import { StudioOpenRunSection } from "./StudioOpenRunSection";

export type StudioWorkspaceSectionProps = {
  runDetails: RunDetailsPanelProps;
  sessionRestore: Pick<SessionRestoreBannerProps, "prompt" | "onRestore" | "onDismiss">;
  setError: (message: string) => void;
  setActiveView: (view: StudioView) => void;
  setSelectedJobId: (id: string) => void;
  onOpenPlayer: (runDir: string, label?: string | null) => void;
  runningJobs: number;
  errors: string[];
  jobForm: NewJobFormApi;
};

export function StudioWorkspaceSection({
  runDetails,
  sessionRestore,
  setError,
  setActiveView,
  setSelectedJobId,
  onOpenPlayer,
  runningJobs,
  errors,
  jobForm,
}: StudioWorkspaceSectionProps) {
  return (
    <div className="studio-workspace-layout">
      <SessionRestoreBanner
        prompt={sessionRestore.prompt}
        onRestore={sessionRestore.onRestore}
        onDismiss={sessionRestore.onDismiss}
      />
      <div className="studio-workspace-workbench" aria-label="Nouveau job et ouverture de run">
        <StudioNewJobSection
          setError={setError}
          runningJobs={runningJobs}
          errors={errors}
          jobForm={jobForm}
          selectedJob={runDetails.selectedJob}
          selectedJobLogs={runDetails.selectedJobLogs}
          liveTranscriptSegments={runDetails.liveTranscriptSegments}
          selectedJobHasJsonOutput={runDetails.selectedJobHasJsonOutput}
          onCancelJob={runDetails.onCancelJob}
          openLocalPath={runDetails.openLocalPath}
          preview={runDetails.preview}
          onPreviewOutput={runDetails.onPreviewOutput}
          onLoadTranscriptEditor={runDetails.onLoadTranscriptEditor}
          onOpenPlayerRun={runDetails.onOpenPlayerRun}
        />
        <details className="studio-workspace-open-run-details">
          <summary className="studio-workspace-open-run-details__summary">
            Ouvrir un run existant
          </summary>
          <div className="studio-workspace-open-run-details__body">
            <StudioOpenRunSection
              setError={setError}
              setActiveView={setActiveView}
              setSelectedJobId={setSelectedJobId}
              onOpenPlayer={onOpenPlayer}
            />
          </div>
        </details>
      </div>
    </div>
  );
}
