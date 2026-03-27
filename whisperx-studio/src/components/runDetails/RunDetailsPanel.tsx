import { forwardRef, useEffect, useState } from "react";
import { fileBasename } from "../../appUtils";
import type { Job, JobLogEvent, LiveTranscriptSegment } from "../../types";
import { WorkerErrorMessage } from "../../WorkerErrorMessage";
import { TabListBar, TabPanel } from "../ui";
import {
  AlignmentWorkspacePanel,
  type AlignmentWorkspacePanelProps,
} from "./AlignmentWorkspacePanel";
import { JobTimelineLogs } from "./JobTimelineLogs";
import { JobRunPipelineStrip } from "./JobRunPipelineStrip";
import { LiveTranscriptFeed } from "./LiveTranscriptFeed";
import { RunDetailsMetaSection } from "./RunDetailsMetaSection";
import { RunDetailsOutputFiles } from "./RunDetailsOutputFiles";
import { RunDetailsPreview, type RunDetailsPreviewProps } from "./RunDetailsPreview";
import { RunSourceMediaHero } from "./RunSourceMediaHero";
import { TranscriptEditorPanel, type TranscriptEditorPanelProps } from "./TranscriptEditorPanel";

export type RunDetailsPanelProps = {
  selectedJob: Job | null;
  selectedJobLogs: JobLogEvent[];
  liveTranscriptSegments: LiveTranscriptSegment[];
  selectedJobHasJsonOutput: boolean;
  openLocalPath: (path: string) => void;
  alignment: AlignmentWorkspacePanelProps | undefined;
  preview: RunDetailsPreviewProps;
  onPreviewOutput: (path: string) => void;
  onLoadTranscriptEditor: (path: string) => void;
  transcriptEditor: TranscriptEditorPanelProps | null;
  editorFocusMode: boolean;
  onToggleEditorFocusMode: () => void;
};

const RUN_DETAILS_TABS = [
  { id: "meta", label: "Méta" },
  { id: "fichiers", label: "Fichiers" },
  { id: "alignement", label: "Alignement" },
  { id: "transcript", label: "Transcript" },
] as const;

type RunDetailsTabId = (typeof RUN_DETAILS_TABS)[number]["id"];

const RUN_DETAILS_TAB_PREFIX = "run-details";

export const RunDetailsPanel = forwardRef<HTMLElement, RunDetailsPanelProps>(
  function RunDetailsPanel(
    {
      selectedJob,
      selectedJobLogs,
      liveTranscriptSegments,
      selectedJobHasJsonOutput,
      openLocalPath,
      alignment,
      preview,
      onPreviewOutput,
      onLoadTranscriptEditor,
      transcriptEditor,
      editorFocusMode,
      onToggleEditorFocusMode,
    },
    ref,
  ) {
    const [tab, setTab] = useState<RunDetailsTabId>("meta");

    useEffect(() => {
      if (!selectedJob) {
        setTab("meta");
        return;
      }
      if (selectedJob.status === "error") {
        setTab("meta");
        return;
      }
      if (transcriptEditor) {
        setTab("transcript");
        return;
      }
      if (selectedJobHasJsonOutput) {
        setTab("fichiers");
        return;
      }
      setTab("meta");
    }, [selectedJob, selectedJobHasJsonOutput, transcriptEditor]);

    const panelClass =
      selectedJob?.status === "error"
        ? "panel panel--run-workspace panel--job-error"
        : "panel panel--run-workspace";

    return (
      <section className={panelClass} ref={ref}>
        <header className="panel-header">
          <h2>Détail du run</h2>
          {selectedJob ? (
            <span
              className="job-count-pill job-count-pill--active panel-header-job-id"
              title="Identifiant du job"
            >
              {selectedJob.id}
            </span>
          ) : (
            <span className="job-count-pill">Aucune sélection</span>
          )}
        </header>

        {selectedJob && alignment ? (
          <RunSourceMediaHero
            alignment={alignment}
            onOpenSource={() => openLocalPath(selectedJob.inputPath)}
            onGoAlignment={() => setTab("alignement")}
          />
        ) : selectedJob ? (
          <div
            className="run-details-context"
            data-job-status={selectedJob.status}
            aria-label="Fichier source et état du run"
          >
            <span className="run-details-context__file" title={selectedJob.inputPath}>
              {fileBasename(selectedJob.inputPath) || selectedJob.id}
            </span>
            <span className={`status-pill ${selectedJob.status}`}>{selectedJob.status}</span>
          </div>
        ) : null}

        {!selectedJob ? (
          <div className="empty-state-card empty-state-card--compact" role="status">
            <div className="empty-state-card-icon empty-state-card-icon--muted" aria-hidden />
            <h3 className="empty-state-card-title">Sélectionne un job</h3>
            <p className="empty-state-card-text">
              Clique sur « Voir détails » dans l&apos;historique (colonne de droite dans Studio) ou
              lance un job depuis l&apos;accueil : tu seras placé ici sur le détail du run, puis le
              transcript dès qu&apos;un JSON est disponible.
            </p>
          </div>
        ) : (
          <div className="details-layout details-layout--stacked">
            {selectedJob.status === "error" && selectedJob.error ? (
              <div className="run-details-error-hero" role="alert" aria-live="assertive">
                <h3 className="run-details-error-hero__title">Le run a échoué</h3>
                <p className="run-details-error-hero__lead">
                  Le message technique ci-dessous inclut souvent des blocs « [Aide …] » (HF, SSL,
                  GPU…). Suis-les puis relance un job depuis l&apos;accueil, ou annule ce run dans
                  l&apos;historique.
                </p>
                <WorkerErrorMessage text={selectedJob.error} />
              </div>
            ) : null}
            <div className="details-column">
              <JobRunPipelineStrip job={selectedJob} logs={selectedJobLogs} />
              <LiveTranscriptFeed job={selectedJob} segments={liveTranscriptSegments} />
              <TabListBar
                tabs={RUN_DETAILS_TABS}
                value={tab}
                onValueChange={(id) => setTab(id as RunDetailsTabId)}
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                aria-label="Sections des détails du run"
              />

              <TabPanel tabId="meta" idPrefix={RUN_DETAILS_TAB_PREFIX} hidden={tab !== "meta"}>
                <RunDetailsMetaSection
                  job={selectedJob}
                  onOpenInput={() => openLocalPath(selectedJob.inputPath)}
                  onOpenOutput={() => openLocalPath(selectedJob.outputDir)}
                />
              </TabPanel>

              <TabPanel
                tabId="fichiers"
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                hidden={tab !== "fichiers"}
              >
                <RunDetailsOutputFiles
                  job={selectedJob}
                  hasJsonOutput={selectedJobHasJsonOutput}
                  onOpenPath={openLocalPath}
                  onPreview={onPreviewOutput}
                  onLoadTranscript={onLoadTranscriptEditor}
                />
                <RunDetailsPreview {...preview} />
              </TabPanel>

              <TabPanel
                tabId="alignement"
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                hidden={tab !== "alignement"}
              >
                {alignment ? (
                  <AlignmentWorkspacePanel {...alignment} />
                ) : (
                  <p className="small run-details-tab-empty">
                    Aucun panneau d&apos;alignement pour ce contexte. Charge un fichier JSON de
                    sortie ou sélectionne un job avec média pour l&apos;alignement.
                  </p>
                )}
              </TabPanel>

              <TabPanel
                tabId="transcript"
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                hidden={tab !== "transcript"}
              >
                <div className="transcript-section-header">
                  <h3>Transcript Editor</h3>
                  {transcriptEditor ? (
                    <button
                      type="button"
                      className={editorFocusMode ? "primary" : "ghost"}
                      onClick={onToggleEditorFocusMode}
                    >
                      {editorFocusMode ? "Quitter le mode focus" : "Mode focus éditeur"}
                    </button>
                  ) : null}
                </div>
                {!transcriptEditor ? (
                  <p className="small">
                    Charge un fichier `.json` de sortie pour activer l&apos;edition segment par
                    segment.
                  </p>
                ) : (
                  <TranscriptEditorPanel {...transcriptEditor} />
                )}
              </TabPanel>
            </div>

            <JobTimelineLogs job={selectedJob} logs={selectedJobLogs} />
          </div>
        )}
      </section>
    );
  },
);
