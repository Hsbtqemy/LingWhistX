import { memo } from "react";
import { fileBasename } from "../appUtils";
import { runInTransition } from "../whisperxOptionsTransitions";
import { AnalysisTimingOptionsForm } from "./AnalysisTimingOptionsForm";
import { ErrorBanner } from "./ErrorBanner";
import { NewJobMediaPreview } from "./NewJobMediaPreview";
import { HfTokenQuickCard } from "./HfTokenQuickCard";
import { RunHfRequirementsSummary } from "./RunHfRequirementsSummary";
import { NewJobDropZone } from "./NewJobDropZone";
import { StudioAdvancedJobSection } from "./StudioAdvancedJobSection";
import { WhisperxOptionsForm } from "./WhisperxOptionsForm";
import type { NewJobFormApi } from "../hooks/useNewJobForm";

export type StudioNewJobSectionProps = {
  setError: (message: string) => void;
  runningJobs: number;
  errors: string[];
  jobForm: NewJobFormApi;
  refreshJobs: () => Promise<void>;
};

/** Header + aperçu média : isolé pour ne pas se re-rendre avec chaque changement d’option WhisperX. */
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

export function StudioNewJobSection({
  setError,
  runningJobs,
  errors,
  jobForm,
  refreshJobs,
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
    submitJob,
    applyProfile,
  } = jobForm;

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
            1. Import
          </button>
          <button
            type="button"
            className={`step-tab ${jobFormStep === "configure" ? "active" : ""}`}
            onClick={continueToConfigurationPanel}
          >
            2. Paramètres
          </button>
        </div>

        {jobFormStep === "import" ? (
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
              Chemin media local
              <div className="path-input-row">
                <input
                  value={inputPath}
                  onChange={(e) => setInputPath(e.currentTarget.value)}
                  placeholder="C:\\media\\audio.wav"
                  autoComplete="off"
                />
                <button className="ghost inline" type="button" onClick={pickInputPath}>
                  Parcourir
                </button>
              </div>
              <p className="field-help">Audio ou video local (wav, mp3, m4a, flac, mp4, mkv).</p>
            </label>

            <label>
              Dossier de sortie (optionnel)
              <div className="path-input-row">
                <input
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.currentTarget.value)}
                  placeholder="Laisser vide pour dossier app local"
                  autoComplete="off"
                />
                <button className="ghost inline" type="button" onClick={pickOutputDir}>
                  Dossier
                </button>
              </div>
              <p className="field-help">
                Si vide, dossier de run sous les donnees locales de l&apos;app. Sinon chemin absolu
                (Documents, Bureau, volume externe, etc.) — pas de dossiers systeme.
              </p>
            </label>

            <div className="actions">
              <button type="button" onClick={continueToConfigurationPanel}>
                Continuer vers parametres
              </button>
              <p className="field-help" style={{ marginTop: 8, marginBottom: 0 }}>
                Tu peux aussi ouvrir l&apos;étape 2 sans média pour parcourir les options (le
                lancement exige toujours un fichier valide).
              </p>
              <button type="button" className="ghost" onClick={() => void refreshJobs()}>
                Rafraichir
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="import-summary">
              {!inputPath.trim() ? (
                <p className="small import-summary-warning">
                  <strong>Aucun média</strong> — les options ci-dessous sont consultables ; indique
                  un fichier à l&apos;étape 1 (ou ci-dessous) avant de lancer un job.
                </p>
              ) : (
                <p className="small import-summary-preview-hint">
                  L&apos;aperçu du média (lecture + ondeforme) est affiché <strong>plus haut</strong>{" "}
                  dans ce panneau, au-dessus du formulaire.
                </p>
              )}
              <p className="small">
                <strong>Media:</strong>
              </p>
              <p className="mono">{inputPath.trim() ? inputPath : "—"}</p>
              <p className="small">
                <strong>Sortie:</strong>{" "}
                {outputDir.trim() ? outputDir : "auto (dossier de run local)"}
              </p>
              <button
                type="button"
                className="ghost inline"
                onClick={() => setJobFormStep("import")}
              >
                Modifier import
              </button>
            </div>

            <label>
              Mode d'execution
              <select
                value={mode}
                onChange={(e) =>
                  runInTransition(() =>
                    setMode(e.currentTarget.value as "mock" | "whisperx" | "analyze_only"),
                  )
                }
              >
                <option value="mock">mock (test rapide sans ASR)</option>
                <option value="whisperx">whisperx (transcription reelle)</option>
                <option value="analyze_only">analyze-only (recalcul metriques)</option>
              </select>
            </label>

            {mode === "whisperx" ? (
              <WhisperxOptionsForm
                whisperxOptions={whisperxOptions}
                setWhisperxOptions={setWhisperxOptions}
                selectedProfileId={selectedProfileId}
                onProfileChange={applyProfile}
                selectedProfile={selectedProfile}
              />
            ) : null}

            {mode === "whisperx" && whisperxOptions.diarize ? (
              <HfTokenQuickCard
                mode="whisperx"
                whisperxOptions={whisperxOptions}
                setWhisperxOptions={setWhisperxOptions}
              />
            ) : null}

            {mode === "analyze_only" ? (
              <p className="field-help">
                Analyze-only relit un JSON existant et recalcule pauses/IPU/transitions sans
                relancer ASR.
              </p>
            ) : null}

            {mode === "whisperx" || mode === "analyze_only" ? (
              <details className="advanced-job-panel job-form-analysis-advanced">
                <summary className="advanced-job-summary">
                  Analyse &amp; timing (pauses, IPU, tours de parole, timestamps mots)
                </summary>
                <div className="advanced-job-body">
                  <AnalysisTimingOptionsForm
                    whisperxOptions={whisperxOptions}
                    setWhisperxOptions={setWhisperxOptions}
                  />
                </div>
              </details>
            ) : null}

            <StudioAdvancedJobSection jobForm={jobForm} />

            {mode === "whisperx" ? (
              <RunHfRequirementsSummary whisperxOptions={whisperxOptions} />
            ) : null}

            <div className="actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Lancement..." : "Lancer le job"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setJobFormStep("import")}
                disabled={isSubmitting}
              >
                Retour import
              </button>
              <button type="button" className="ghost" onClick={() => void refreshJobs()}>
                Rafraichir
              </button>
            </div>
          </>
        )}
      </form>

      {errors.length > 0 ? (
        <ErrorBanner multiline>
          {errors.map((msg, i) => (
            <p key={`${i}-${msg.slice(0, 24)}`} className="error-banner-text">
              {msg}
            </p>
          ))}
        </ErrorBanner>
      ) : null}
    </section>
  );
}
