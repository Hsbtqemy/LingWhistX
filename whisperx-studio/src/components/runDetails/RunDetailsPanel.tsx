import { forwardRef, useEffect, useState } from "react";
import type { Job, JobLogEvent } from "../../types";
import { TabListBar, TabPanel } from "../ui";
import {
  AlignmentWorkspacePanel,
  type AlignmentWorkspacePanelProps,
} from "./AlignmentWorkspacePanel";
import { JobTimelineLogs } from "./JobTimelineLogs";
import { RunDetailsMetaSection } from "./RunDetailsMetaSection";
import { RunDetailsOutputFiles } from "./RunDetailsOutputFiles";
import { RunDetailsPreview, type RunDetailsPreviewProps } from "./RunDetailsPreview";
import { TranscriptEditorPanel, type TranscriptEditorPanelProps } from "./TranscriptEditorPanel";

export type RunDetailsPanelProps = {
  selectedJob: Job | null;
  selectedJobLogs: JobLogEvent[];
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
      setTab("meta");
    }, [selectedJob?.id]);

    return (
      <section className="panel" ref={ref}>
        <header className="panel-header">
          <h2>Détails du run</h2>
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

        {!selectedJob ? (
          <div className="empty-state-card empty-state-card--compact" role="status">
            <div className="empty-state-card-icon empty-state-card-icon--muted" aria-hidden />
            <h3 className="empty-state-card-title">Sélectionne un job</h3>
            <p className="empty-state-card-text">
              Clique sur « Voir détails » dans la liste des jobs ci-dessus pour afficher les
              fichiers de sortie, la waveform, les logs et l&apos;éditeur de transcript.
            </p>
          </div>
        ) : (
          <div className="details-layout">
            <div className="details-column">
              <TabListBar
                tabs={RUN_DETAILS_TABS}
                value={tab}
                onValueChange={(id) => setTab(id as RunDetailsTabId)}
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                aria-label="Sections des détails du run"
              />

              <TabPanel
                tabId="meta"
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                hidden={tab !== "meta"}
              >
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

            <JobTimelineLogs logs={selectedJobLogs} />
          </div>
        )}
      </section>
    );
  },
);
