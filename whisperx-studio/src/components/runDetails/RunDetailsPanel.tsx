import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { fileBasename, findPrimaryTranscriptJson } from "../../appUtils";
import type {
  AnnotationSegment,
  AnnotationTier,
  ImportAnnotationResult,
  Job,
  JobLogEvent,
  LiveTranscriptSegment,
} from "../../types";
import { WorkerErrorMessage } from "../../WorkerErrorMessage";
import { TabListBar, TabPanel } from "../ui";
import {
  AlignmentWorkspacePanel,
  type AlignmentWorkspacePanelProps,
} from "./AlignmentWorkspacePanel";
import { JobRunPipelineStrip } from "./JobRunPipelineStrip";
import { LiveTranscriptFeed } from "./LiveTranscriptFeed";
import { RunExpectedExportsStrip } from "./RunExpectedExportsStrip";
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
  /** Annule un job en file ou en cours (IPC `cancel_job`). */
  onCancelJob: (jobId: string) => void;
  openLocalPath: (path: string) => void;
  alignment: AlignmentWorkspacePanelProps | undefined;
  preview: RunDetailsPreviewProps;
  onPreviewOutput: (path: string) => void;
  onLoadTranscriptEditor: (path: string) => void;
  transcriptEditor: TranscriptEditorPanelProps | null;
  /** Ouvre le dossier de sortie dans le Player (onglet Player). */
  onOpenPlayerRun?: (outputDir: string, label?: string | null, editMode?: boolean) => void;
  /** WX-676 — Charge un tier d'annotation EAF/TextGrid dans l'éditeur de transcript. */
  onLoadAnnotationTier?: (tierId: string, segments: AnnotationSegment[]) => void;
  /** WX-696 — Dossier de sortie du run sélectionné (pour écriture dans events.sqlite). */
  selectedJobOutputDir?: string;
  /** WX-696 — Appelé après écriture des tiers dans events.sqlite (force refresh Player). */
  onAnnotationWrittenToPlayer?: () => void;
};

// ─── WX-676 : Annotation Import UI ──────────────────────────────────────────

function AnnotationImportSection({
  onLoadAnnotationTier,
  outputDir,
  onAnnotationWrittenToPlayer,
}: {
  onLoadAnnotationTier: (tierId: string, segments: AnnotationSegment[]) => void;
  outputDir?: string;
  onAnnotationWrittenToPlayer?: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<ImportAnnotationResult | null>(null);
  const [selectedTierIds, setSelectedTierIds] = useState<Set<string>>(new Set());

  // WX-696 — Écrit les tiers sélectionnés dans events.sqlite et notifie le Player.
  const writeToPlayer = useCallback(
    async (tiersToWrite: AnnotationTier[]) => {
      if (!outputDir || tiersToWrite.length === 0) return;
      try {
        await invoke("write_annotation_tiers_to_events", {
          runDir: outputDir,
          tiers: tiersToWrite.map((t) => ({ tierId: t.tierId, segments: t.segments })),
        });
        onAnnotationWrittenToPlayer?.();
      } catch (err) {
        setImportError(`Player : ${String(err)}`);
      }
    },
    [outputDir, onAnnotationWrittenToPlayer],
  );

  const handlePickFile = useCallback(async () => {
    setImportError(null);
    const selected = await openDialog({
      title: "Importer un fichier d'annotation",
      filters: [{ name: "Annotation", extensions: ["eaf", "TextGrid"] }],
      multiple: false,
      directory: false,
    });
    if (!selected || typeof selected !== "string") return;

    setImporting(true);
    try {
      const result = await invoke<ImportAnnotationResult>("import_annotation_file", {
        path: selected,
      });
      if (result.tiers.length === 0) {
        setImportError("Aucun tier trouvé dans ce fichier.");
        return;
      }
      if (result.tiers.length === 1) {
        // Single tier: load directly
        const tier = result.tiers[0];
        onLoadAnnotationTier(tier.tierId, tier.segments);
        void writeToPlayer([tier]);
      } else {
        // Multiple tiers: show picker
        setPendingResult(result);
        setSelectedTierIds(new Set(result.tiers.map((t: AnnotationTier) => t.tierId)));
      }
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
    }
  }, [onLoadAnnotationTier, writeToPlayer]);

  const handleConfirmTiers = useCallback(() => {
    if (!pendingResult) return;
    const toLoad = pendingResult.tiers.filter((t) => selectedTierIds.has(t.tierId));
    for (const tier of toLoad) {
      onLoadAnnotationTier(tier.tierId, tier.segments);
    }
    void writeToPlayer(toLoad);
    setPendingResult(null);
    setSelectedTierIds(new Set());
  }, [pendingResult, selectedTierIds, onLoadAnnotationTier, writeToPlayer]);

  const toggleTier = useCallback((tierId: string) => {
    setSelectedTierIds((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) {
        next.delete(tierId);
      } else {
        next.add(tierId);
      }
      return next;
    });
  }, []);

  return (
    <div className="annotation-import-section">
      <button
        type="button"
        className="ghost"
        disabled={importing}
        onClick={() => void handlePickFile()}
        title="Importer un fichier EAF (ELAN) ou TextGrid (Praat) comme segments"
      >
        {importing ? "Import…" : "Importer annotation (.eaf / .TextGrid)"}
      </button>
      {importError ? (
        <p className="annotation-import-error small field-help">{importError}</p>
      ) : null}
      {pendingResult ? (
        <div className="annotation-tier-picker" role="dialog" aria-label="Sélection des tiers">
          <p className="small">
            {pendingResult.tiers.length} tiers détectés — sélectionne ceux à charger :
          </p>
          <ul className="annotation-tier-picker__list">
            {pendingResult.tiers.map((tier: AnnotationTier) => (
              <li key={tier.tierId} className="annotation-tier-picker__item">
                <label>
                  <input
                    type="checkbox"
                    checked={selectedTierIds.has(tier.tierId)}
                    onChange={() => toggleTier(tier.tierId)}
                  />
                  <span className="annotation-tier-picker__id">{tier.tierId}</span>
                  <span className="annotation-tier-picker__count small">
                    {tier.segments.length} segment(s)
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {pendingResult.warnings.length > 0 ? (
            <ul className="annotation-import-warnings small">
              {pendingResult.warnings.map((w, i) => (
                <li key={i} className="annotation-import-warnings__item">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="annotation-tier-picker__actions">
            <button
              type="button"
              className="primary"
              disabled={selectedTierIds.size === 0}
              onClick={handleConfirmTiers}
            >
              Charger {selectedTierIds.size} tier(s)
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPendingResult(null);
                setSelectedTierIds(new Set());
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const RUN_DETAILS_TABS = [
  { id: "meta", label: "Méta" },
  { id: "fichiers", label: "Fichiers" },
  { id: "alignement", label: "Alignement" },
  { id: "verification", label: "Vérification" },
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
      onCancelJob,
      openLocalPath,
      alignment,
      preview,
      onPreviewOutput,
      onLoadTranscriptEditor,
      transcriptEditor,
      onOpenPlayerRun,
      onLoadAnnotationTier,
      selectedJobOutputDir,
      onAnnotationWrittenToPlayer,
    },
    ref,
  ) {
    const [tab, setTab] = useState<RunDetailsTabId>("meta");
    /** Évite de forcer l’onglet à chaque rendu : `transcriptEditor` est un nouvel objet à chaque render parent. */
    const prevJobIdRef = useRef<string | null>(null);
    const hadTranscriptOnJobRef = useRef(false);

    const canCancelJob =
      selectedJob &&
      (selectedJob.status === "queued" || selectedJob.status === "running");

    const [reportExporting, setReportExporting] = useState(false);
    const [reportPath, setReportPath] = useState<string | null>(null);
    const [reportError, setReportError] = useState<string | null>(null);

    const canExportReport =
      selectedJob &&
      selectedJob.status === "done" &&
      Boolean(selectedJob.outputDir?.trim());

    const handleExportReport = useCallback(async () => {
      if (!selectedJob?.outputDir) return;
      setReportExporting(true);
      setReportError(null);
      try {
        const res = await invoke<{ outputPath: string }>("export_prosody_report", {
          runDir: selectedJob.outputDir,
        });
        setReportPath(res.outputPath);
        openLocalPath(res.outputPath);
      } catch (err) {
        setReportError(String(err));
      } finally {
        setReportExporting(false);
      }
    }, [selectedJob, openLocalPath]);

    const liveTranscriptPreview = useMemo(() => {
      if (!liveTranscriptSegments.length) {
        return null;
      }
      const last = liveTranscriptSegments[liveTranscriptSegments.length - 1];
      const t = last.text?.trim();
      return t || null;
    }, [liveTranscriptSegments]);

    const scrollRunDetailsTabsAnchor = useCallback(() => {
      requestAnimationFrame(() => {
        document.getElementById("run-details-tabs-anchor")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    }, []);

    const autoLoadedForJobRef = useRef<string | null>(null);

    useEffect(() => {
      if (!selectedJob) {
        setTab("meta");
        prevJobIdRef.current = null;
        hadTranscriptOnJobRef.current = false;
        autoLoadedForJobRef.current = null;
        return;
      }

      const jobId = selectedJob.id;
      const jobChanged = prevJobIdRef.current !== jobId;
      const hasTranscriptEditor = transcriptEditor != null;

      if (jobChanged) {
        prevJobIdRef.current = jobId;
        hadTranscriptOnJobRef.current = hasTranscriptEditor;
        autoLoadedForJobRef.current = null;
        if (selectedJob.status === "error") {
          setTab("meta");
        } else if (hasTranscriptEditor) {
          setTab("transcript");
        } else if (selectedJobHasJsonOutput) {
          setTab("fichiers");
        } else {
          setTab("meta");
        }
        return;
      }

      /* Transcript disponible après coup : ne pas écraser Alignement / Vérification / etc. */
      if (!hadTranscriptOnJobRef.current && hasTranscriptEditor) {
        setTab((prev) => (prev === "meta" ? "transcript" : prev));
      }
      hadTranscriptOnJobRef.current = hasTranscriptEditor;

      if (
        selectedJob.status === "done" &&
        !hasTranscriptEditor &&
        autoLoadedForJobRef.current !== jobId
      ) {
        const primary = findPrimaryTranscriptJson(selectedJob.outputFiles);
        if (primary) {
          autoLoadedForJobRef.current = jobId;
          onLoadTranscriptEditor(primary);
        }
      }
    }, [selectedJob, selectedJobHasJsonOutput, transcriptEditor, onLoadTranscriptEditor]);

    const panelClass =
      selectedJob?.status === "error"
        ? "panel panel--run-workspace panel--job-error"
        : "panel panel--run-workspace";

    return (
      <section className={panelClass} ref={ref}>
        <header className="panel-header">
          <h2>Détail du run</h2>
          {selectedJob ? (
            <div className="run-details-panel__header-actions">
              <span
                className="job-count-pill job-count-pill--active panel-header-job-id"
                title="Identifiant du job"
              >
                {selectedJob.id}
              </span>
              {canCancelJob ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => void onCancelJob(selectedJob.id)}
                >
                  Annuler le run
                </button>
              ) : null}
              {canExportReport ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={reportExporting}
                  onClick={() => void handleExportReport()}
                  title={reportPath ? `Rapport : ${reportPath}` : "Générer et ouvrir le rapport HTML prosodique"}
                >
                  {reportExporting ? "Export…" : "Exporter rapport"}
                </button>
              ) : null}
              {reportPath ? (
                <button
                  type="button"
                  className="ghost inline"
                  onClick={() => void invoke("open_html_report_for_print", { htmlPath: reportPath })}
                  title="Ouvrir le rapport dans une fenêtre d'impression (PDF)"
                >
                  Imprimer PDF
                </button>
              ) : null}
              {reportError ? (
                <span className="run-details-report-error field-help">{reportError}</span>
              ) : null}
            </div>
          ) : (
            <span className="job-count-pill">Aucune sélection</span>
          )}
        </header>

        {selectedJob && alignment ? (
          <RunSourceMediaHero
            alignment={alignment}
            onOpenSource={() => openLocalPath(selectedJob.inputPath)}
            onGoAlignment={() => {
              setTab("alignement");
              scrollRunDetailsTabsAnchor();
            }}
            onGoVerification={() => {
              setTab("verification");
              scrollRunDetailsTabsAnchor();
            }}
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
              Clique sur « Voir détails » dans l&apos;historique ou lance un job depuis le bloc{" "}
              <strong>Nouveau job</strong> en haut du Studio : tu seras placé ici sur le détail du
              run, puis le transcript dès qu&apos;un JSON est disponible.
            </p>
          </div>
        ) : (
          <div className="details-layout details-layout--stacked">
            {selectedJob.status === "error" && selectedJob.error ? (
              <div className="run-details-error-hero" role="alert" aria-live="assertive">
                <h3 className="run-details-error-hero__title">Le run a échoué</h3>
                <p className="run-details-error-hero__lead">
                  Le message technique ci-dessous inclut souvent des blocs « [Aide …] » (HF, SSL,
                  GPU…). Suis-les puis relance un job depuis le Studio.
                </p>
                <WorkerErrorMessage text={selectedJob.error} />
              </div>
            ) : null}
            <div className="details-column">
              <JobRunPipelineStrip
                job={selectedJob}
                logs={selectedJobLogs}
                onCancelJob={
                  canCancelJob ? () => void onCancelJob(selectedJob.id) : undefined
                }
              />
              {selectedJob.mode === "whisperx" ? (
                <RunExpectedExportsStrip job={selectedJob} />
              ) : null}
              <LiveTranscriptFeed job={selectedJob} segments={liveTranscriptSegments} />
              <div id="run-details-tabs-anchor" className="run-details-tabs-anchor">
                <TabListBar
                  tabs={RUN_DETAILS_TABS}
                  value={tab}
                  onValueChange={(id) => setTab(id as RunDetailsTabId)}
                  idPrefix={RUN_DETAILS_TAB_PREFIX}
                  aria-label="Sections des détails du run"
                />
              </div>

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
                  onOpenPlayerRun={onOpenPlayerRun}
                />
                <RunDetailsPreview {...preview} />
              </TabPanel>

              <TabPanel
                tabId="alignement"
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                hidden={tab !== "alignement"}
              >
                {alignment ? (
                  <AlignmentWorkspacePanel
                    {...alignment}
                    liveTranscriptPreview={liveTranscriptPreview}
                  />
                ) : (
                  <p className="small run-details-tab-empty">
                    Aucun panneau d&apos;alignement pour ce contexte. Charge un fichier JSON de
                    sortie ou sélectionne un job avec média pour l&apos;alignement.
                  </p>
                )}
              </TabPanel>

              <TabPanel
                tabId="verification"
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                hidden={tab !== "verification"}
              >
                <div className="run-details-verification">
                  <header className="run-details-verification__intro">
                    <h3>Vérification → Player</h3>
                    <p className="small">
                      La vérification et l&apos;édition du transcript se font désormais dans le{" "}
                      <strong>Player</strong> en <strong>mode édition</strong>. Le Player offre un
                      affichage synchronisé (chat, rythmo, mots) avec édition inline du texte et
                      des bornes temporelles.
                    </p>
                  </header>
                  <div className="run-details-tab-empty">
                    {selectedJobOutputDir && onOpenPlayerRun ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          onOpenPlayerRun(
                            selectedJobOutputDir,
                            selectedJob ? fileBasename(selectedJob.inputPath) : undefined,
                            true,
                          );
                        }}
                      >
                        Ouvrir dans le Player (mode édition)
                      </button>
                    ) : (
                      <p className="small">
                        Aucun dossier de sortie disponible. Lance un run ou vérifie l&apos;onglet
                        Fichiers.
                      </p>
                    )}
                  </div>
                </div>
              </TabPanel>

              <TabPanel
                tabId="transcript"
                idPrefix={RUN_DETAILS_TAB_PREFIX}
                hidden={tab !== "transcript"}
              >
                <div className="transcript-section-header">
                  <div>
                    <h3>Transcript</h3>
                    <p className="small transcript-section-hint">
                      Édition segment par segment et contrôle qualité. Pour une vue
                      synchronisée (média + waveform + texte), utilise le{" "}
                      <strong>Player en mode édition</strong>.
                    </p>
                  </div>
                </div>
                {!transcriptEditor ? (
                  <p className="small">
                    Charge un fichier `.json` de sortie pour activer l&apos;edition segment par
                    segment.
                  </p>
                ) : (
                  <TranscriptEditorPanel {...transcriptEditor} />
                )}
                {onLoadAnnotationTier ? (
                  <AnnotationImportSection
                    onLoadAnnotationTier={onLoadAnnotationTier}
                    outputDir={selectedJobOutputDir}
                    onAnnotationWrittenToPlayer={onAnnotationWrittenToPlayer}
                  />
                ) : null}
              </TabPanel>
            </div>
          </div>
        )}
      </section>
    );
  },
);
