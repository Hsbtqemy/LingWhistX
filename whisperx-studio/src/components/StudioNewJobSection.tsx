import { memo, useMemo } from "react";
import { fileBasename } from "../appUtils";
import { WHISPER_MODEL_CHOICES } from "../constants";
import { runInTransition } from "../whisperxOptionsTransitions";
import { useAudioPreview } from "../hooks/useAudioPreview";
import { AnalysisTimingOptionsForm } from "./AnalysisTimingOptionsForm";
import { AudioPreviewPanel } from "./AudioPreviewPanel";
import { ErrorBanner } from "./ErrorBanner";
import { NewJobMediaPreview } from "./NewJobMediaPreview";
import { HfTokenQuickCard } from "./HfTokenQuickCard";
import { RunHfRequirementsSummary } from "./RunHfRequirementsSummary";
import { NewJobDropZone } from "./NewJobDropZone";
import { WhisperxAdvancedForm } from "./WhisperxOptionsForm";
import { JobRunPipelineStrip } from "./runDetails/JobRunPipelineStrip";
import { LiveTranscriptFeed } from "./runDetails/LiveTranscriptFeed";
import { RunDetailsOutputFiles } from "./runDetails/RunDetailsOutputFiles";
import { RunDetailsPreview, type RunDetailsPreviewProps } from "./runDetails/RunDetailsPreview";
import type { NewJobFormApi } from "../hooks/useNewJobForm";
import type { Job, JobLogEvent, LiveTranscriptSegment, UiWhisperxOptions } from "../types";
import { setWhisperxOptionsDeferred } from "../whisperxOptionsTransitions";
import { HfScopeBadge } from "./HfScopeBadge";

export type StudioNewJobSectionProps = {
  setError: (message: string) => void;
  runningJobs: number;
  errors: string[];
  jobForm: NewJobFormApi;
  selectedJob: Job | null;
  selectedJobLogs: JobLogEvent[];
  liveTranscriptSegments: LiveTranscriptSegment[];
  selectedJobHasJsonOutput: boolean;
  onCancelJob: (jobId: string) => void;
  openLocalPath: (path: string) => void;
  preview: RunDetailsPreviewProps;
  onPreviewOutput: (path: string) => void;
  onLoadTranscriptEditor: (path: string) => void;
  onOpenPlayerRun?: (outputDir: string, label?: string | null) => void;
  onOpenEditor?: (runDir: string) => void;
};

const JobPanelTop = memo(function JobPanelTop({
  runningJobs,
  inputPath,
}: {
  runningJobs: number;
  inputPath: string;
}) {
  return (
    <>
      <header className="panel-header">
        <h2>Nouveau job</h2>
        <span
          className={`job-count-pill ${runningJobs > 0 ? "job-count-pill--active" : ""}`}
          aria-live="polite"
          title={runningJobs === 0 ? "Aucune tâche en file" : `${runningJobs} tâche(s) en cours`}
        >
          {runningJobs === 0 ? "Aucun job en cours" : `${runningJobs} en cours`}
        </span>
      </header>

      {inputPath.trim() ? <NewJobMediaPreview inputPath={inputPath} /> : null}
    </>
  );
});

const MODE_LABELS: Record<string, string> = {
  mock: "Mock (test)",
  whisperx: "WhisperX",
  analyze_only: "Analyze-only",
};

function JobReviewSummary({
  inputPath,
  outputDir,
  mode,
  whisperxOptions,
  selectedProfileLabel,
  onEditStep,
}: {
  inputPath: string;
  outputDir: string;
  mode: string;
  whisperxOptions: UiWhisperxOptions;
  selectedProfileLabel: string | undefined;
  onEditStep: (step: "import" | "configure") => void;
}) {
  return (
    <div className="job-review-summary">
      <h3>Récapitulatif</h3>
      <dl className="job-review-dl">
        <dt>Fichier</dt>
        <dd className="mono">{inputPath.trim() || "—"}</dd>
        <dt>Sortie</dt>
        <dd>{outputDir.trim() || "auto (dossier local)"}</dd>
        <dt>Mode</dt>
        <dd>{MODE_LABELS[mode] ?? mode}</dd>
        {mode === "whisperx" && (
          <>
            <dt>Profil</dt>
            <dd>{selectedProfileLabel ?? "—"}</dd>
            <dt>Modèle</dt>
            <dd className="mono">{whisperxOptions.model || "small"}</dd>
            <dt>Langue</dt>
            <dd>{whisperxOptions.language || "auto"}</dd>
            <dt>Diarization</dt>
            <dd>{whisperxOptions.diarize ? "Oui" : "Non"}</dd>
          </>
        )}
      </dl>
      <div className="job-review-actions">
        <button type="button" className="ghost inline" onClick={() => onEditStep("import")}>
          Modifier le fichier
        </button>
        <button type="button" className="ghost inline" onClick={() => onEditStep("configure")}>
          Modifier les paramètres
        </button>
      </div>
    </div>
  );
}

export function StudioNewJobSection({
  setError,
  runningJobs,
  errors,
  jobForm,
  selectedJob,
  selectedJobLogs,
  liveTranscriptSegments,
  selectedJobHasJsonOutput,
  onCancelJob,
  openLocalPath,
  preview,
  onPreviewOutput,
  onLoadTranscriptEditor,
  onOpenPlayerRun,
  onOpenEditor,
}: StudioNewJobSectionProps) {
  const {
    inputPath,
    setInputPath,
    outputDir,
    setOutputDir,
    mode,
    setMode,
    whisperxOptions,
    setWhisperxOptions,
    selectedProfileId,
    isSubmitting,
    jobFormStep,
    setJobFormStep,
    selectedProfile,
    pickInputPath,
    pickOutputDir,
    continueToConfigurationPanel,
    continueToReviewPanel,
    submitJob,
    applyProfile,
  } = jobForm;

  const {
    state: previewState,
    activeAudioSrc,
    generate: generatePreview,
    setSlot: setPreviewSlot,
  } = useAudioPreview(inputPath, whisperxOptions.audioPipelineModulesJson);

  const modelValue = whisperxOptions.model.trim() || "small";
  const modelIsListed = useMemo(
    () => WHISPER_MODEL_CHOICES.some((c) => c.value === modelValue),
    [modelValue],
  );

  const patchWhisperx = (partial: Partial<UiWhisperxOptions>) => {
    setWhisperxOptions((prev) => ({ ...prev, ...partial }));
  };

  return (
    <section id="home-new-job" className="panel panel--home panel--home-primary">
      <JobPanelTop runningJobs={runningJobs} inputPath={inputPath} />

      <form className="job-form" onSubmit={submitJob}>
        <div className="job-stepper">
          <button
            type="button"
            className={`step-tab ${jobFormStep === "import" ? "active" : ""}`}
            onClick={() => setJobFormStep("import")}
          >
            1. Fichier
          </button>
          <button
            type="button"
            className={`step-tab ${jobFormStep === "configure" ? "active" : ""}`}
            onClick={continueToConfigurationPanel}
          >
            2. Paramètres
          </button>
          <button
            type="button"
            className={`step-tab ${jobFormStep === "review" ? "active" : ""}`}
            onClick={continueToReviewPanel}
          >
            3. Lancer
          </button>
          <button
            type="button"
            className={`step-tab ${jobFormStep === "results" ? "active" : ""}`}
            onClick={() => selectedJob && setJobFormStep("results")}
            disabled={!selectedJob}
          >
            4. Résultats
          </button>
        </div>

        {/* ── Étape 1 : Fichier ── */}
        {jobFormStep === "import" && (
          <>
            <NewJobDropZone
              selectedLabel={inputPath.trim() ? fileBasename(inputPath) : undefined}
              disabled={isSubmitting}
              onPath={(path: string) => {
                setInputPath(path);
                setError("");
                setJobFormStep("configure");
              }}
              onError={setError}
            />

            <label>
              Chemin média local
              <div className="path-input-row">
                <input
                  value={inputPath}
                  onChange={(e) => setInputPath(e.currentTarget.value)}
                  placeholder="/chemin/vers/audio.wav"
                  autoComplete="off"
                />
                <button className="ghost inline" type="button" onClick={pickInputPath}>
                  Parcourir
                </button>
              </div>
              <p className="field-help">wav, mp3, m4a, flac, mp4, mkv.</p>
            </label>

            <label>
              Dossier de sortie (optionnel)
              <div className="path-input-row">
                <input
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.currentTarget.value)}
                  placeholder="Vide = dossier app local"
                  autoComplete="off"
                />
                <button className="ghost inline" type="button" onClick={pickOutputDir}>
                  Dossier
                </button>
              </div>
              <p className="field-help">Chemin absolu, ou vide pour le dossier par défaut.</p>
            </label>

            <div className="actions">
              <button type="button" onClick={continueToConfigurationPanel}>
                Continuer
              </button>
            </div>
          </>
        )}

        {/* ── Étape 2 : Paramètres essentiels ── */}
        {jobFormStep === "configure" && (
          <>
            {inputPath.trim() ? (
              <p className="small import-summary-compact">
                <strong>Fichier :</strong> <span className="mono">{fileBasename(inputPath)}</span>
                <button
                  type="button"
                  className="ghost inline"
                  onClick={() => setJobFormStep("import")}
                >
                  Modifier
                </button>
              </p>
            ) : (
              <p className="small import-summary-warning">
                <strong>Aucun média</strong> — sélectionne un fichier à l&apos;étape 1.
              </p>
            )}

            <label>
              Mode
              <select
                value={mode}
                onChange={(e) =>
                  runInTransition(() =>
                    setMode(e.currentTarget.value as "mock" | "whisperx" | "analyze_only"),
                  )
                }
              >
                <option value="mock">Mock (test rapide sans ASR)</option>
                <option value="whisperx">WhisperX (transcription)</option>
                <option value="analyze_only">Analyze-only (recalcul métriques)</option>
              </select>
            </label>

            {mode === "whisperx" && (
              <>
                <label>
                  Profil
                  <select
                    value={selectedProfileId}
                    onChange={(e) => runInTransition(() => applyProfile(e.currentTarget.value))}
                  >
                    {jobForm.profilePresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  {selectedProfile?.description && (
                    <p className="field-help">{selectedProfile.description}</p>
                  )}
                </label>

                <div className="option-grid job-form-whisperx-basic">
                  <label>
                    Modèle Whisper
                    <select
                      value={modelValue}
                      onChange={(e) => patchWhisperx({ model: e.currentTarget.value })}
                    >
                      {!modelIsListed && (
                        <option value={modelValue}>{modelValue} (hors liste)</option>
                      )}
                      {WHISPER_MODEL_CHOICES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Langue
                    <input
                      value={whisperxOptions.language}
                      onChange={(e) => patchWhisperx({ language: e.currentTarget.value })}
                      placeholder="fr, en… (vide = auto)"
                    />
                    <p className="field-help">Vide = autodétection (plus lent).</p>
                  </label>
                </div>

                <label className="checkbox-row checkbox-row--diarize">
                  <input
                    type="checkbox"
                    checked={whisperxOptions.diarize}
                    onChange={(e) =>
                      setWhisperxOptionsDeferred(setWhisperxOptions, {
                        diarize: e.currentTarget.checked,
                      })
                    }
                  />
                  <span className="checkbox-row__label-with-badge">
                    Diarization (qui parle ?)
                    <HfScopeBadge variant="hf_required" />
                  </span>
                </label>

                {whisperxOptions.diarize && (
                  <div className="option-grid job-form-diarize-speakers">
                    <label>
                      Min locuteurs
                      <input
                        value={whisperxOptions.minSpeakers}
                        onChange={(e) => patchWhisperx({ minSpeakers: e.currentTarget.value })}
                        placeholder="auto"
                      />
                    </label>
                    <label>
                      Max locuteurs
                      <input
                        value={whisperxOptions.maxSpeakers}
                        onChange={(e) => patchWhisperx({ maxSpeakers: e.currentTarget.value })}
                        placeholder="auto"
                      />
                    </label>
                  </div>
                )}

                {whisperxOptions.diarize && (
                  <HfTokenQuickCard
                    mode="whisperx"
                    whisperxOptions={whisperxOptions}
                    setWhisperxOptions={setWhisperxOptions}
                  />
                )}
              </>
            )}

            {mode === "analyze_only" && (
              <p className="field-help">
                Recalcule pauses / IPU / transitions depuis un JSON existant.
              </p>
            )}

            {/* ── Options avancées : un seul panneau plat ── */}
            {(mode === "whisperx" || mode === "analyze_only") && (
              <details className="advanced-job-panel">
                <summary className="advanced-job-summary">Options avancées</summary>
                <div className="advanced-job-body advanced-job-body--flat">
                  {mode === "whisperx" && (
                    <WhisperxAdvancedForm
                      whisperxOptions={whisperxOptions}
                      setWhisperxOptions={setWhisperxOptions}
                    />
                  )}

                  {mode === "whisperx" && (
                    <AudioPreviewPanel
                      inputPath={inputPath}
                      modulesJson={whisperxOptions.audioPipelineModulesJson}
                      state={previewState}
                      activeAudioSrc={activeAudioSrc}
                      onGenerate={generatePreview}
                      onSetSlot={setPreviewSlot}
                    />
                  )}

                  <AnalysisTimingOptionsForm
                    whisperxOptions={whisperxOptions}
                    setWhisperxOptions={setWhisperxOptions}
                  />
                </div>
              </details>
            )}

            {mode === "whisperx" && <RunHfRequirementsSummary whisperxOptions={whisperxOptions} />}

            <div className="actions">
              <button type="submit" disabled={isSubmitting}>
                Continuer
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setJobFormStep("import")}
                disabled={isSubmitting}
              >
                Retour
              </button>
            </div>
          </>
        )}

        {/* ── Étape 3 : Récapitulatif & lancement ── */}
        {jobFormStep === "review" && (
          <>
            <JobReviewSummary
              inputPath={inputPath}
              outputDir={outputDir}
              mode={mode}
              whisperxOptions={whisperxOptions}
              selectedProfileLabel={selectedProfile?.label}
              onEditStep={setJobFormStep}
            />
            <div className="actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Lancement…" : "Lancer le job"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setJobFormStep("configure")}
                disabled={isSubmitting}
              >
                Retour aux paramètres
              </button>
            </div>
          </>
        )}

        {/* ── Étape 4 : Résultats ── */}
        {jobFormStep === "results" && (
          <div className="job-results-step">
            {selectedJob ? (
              <>
                <JobRunPipelineStrip
                  job={selectedJob}
                  logs={selectedJobLogs}
                  onCancelJob={() => onCancelJob(selectedJob.id)}
                />

                {selectedJob.status === "running" && liveTranscriptSegments.length > 0 && (
                  <LiveTranscriptFeed job={selectedJob} segments={liveTranscriptSegments} />
                )}

                {(selectedJob.status === "done" || selectedJob.status === "error") && (
                  <RunDetailsOutputFiles
                    job={selectedJob}
                    hasJsonOutput={selectedJobHasJsonOutput}
                    onOpenPath={openLocalPath}
                    onPreview={onPreviewOutput}
                    onLoadTranscript={onLoadTranscriptEditor}
                    onOpenPlayerRun={onOpenPlayerRun}
                  />
                )}

                {preview.selectedPreviewPath && <RunDetailsPreview {...preview} />}

                <div className="job-results-nav">
                  {selectedJob.status === "done" && onOpenPlayerRun && (
                    <button
                      type="button"
                      onClick={() => onOpenPlayerRun(selectedJob.outputDir, selectedJob.inputPath)}
                    >
                      Ouvrir dans le Player
                    </button>
                  )}
                  {selectedJob.status === "done" && onOpenEditor && (
                    <button type="button" onClick={() => onOpenEditor(selectedJob.outputDir)}>
                      Ouvrir dans l'Éditeur
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setJobFormStep("import");
                    }}
                  >
                    Nouveau job
                  </button>
                </div>
              </>
            ) : (
              <p className="field-help">Aucun job sélectionné. Lance un job depuis l'étape 3.</p>
            )}
          </div>
        )}
      </form>

      {errors.length > 0 && (
        <ErrorBanner multiline>
          {errors.map((msg, i) => (
            <p key={`${i}-${msg.slice(0, 24)}`} className="error-banner-text">
              {msg}
            </p>
          ))}
        </ErrorBanner>
      )}
    </section>
  );
}
