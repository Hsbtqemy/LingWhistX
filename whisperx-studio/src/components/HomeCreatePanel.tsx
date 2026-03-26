import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import type { LocalRuntimePanelProps } from "./LocalRuntimePanel";
import { StudioNewJobSection } from "./StudioNewJobSection";
import { StudioOpenRunSection } from "./StudioOpenRunSection";
import { useNewJobForm } from "../hooks/useNewJobForm";
import type { StudioView, UiWhisperxOptions } from "../types";

export type HomeCreatePanelProps = {
  setError: (message: string) => void;
  setActiveView: (view: StudioView) => void;
  setSelectedJobId: (id: string) => void;
  onOpenPlayer: (runDir: string, label?: string | null) => void;
  refreshJobs: () => Promise<void>;
  runtimeReady: boolean;
  runtimeCoreReady: boolean;
  runningJobs: number;
  errors: string[];
  runtime: LocalRuntimePanelProps;
  /** Ref partagée avec App : setter WhisperX pour l’injection WX-623 depuis l’Explorer. */
  whisperxSetterRef: MutableRefObject<Dispatch<SetStateAction<UiWhisperxOptions>> | null>;
};

/**
 * Colonne « Accueil » (runs récents + nouveau job) isolée du workspace pour éviter de re-rendre
 * tout l’éditeur / détails job à chaque frappe ou changement d’option WhisperX.
 */
export function HomeCreatePanel({
  setError,
  setActiveView,
  setSelectedJobId,
  onOpenPlayer,
  refreshJobs,
  runtimeReady,
  runtimeCoreReady,
  runningJobs,
  errors,
  runtime,
  whisperxSetterRef,
}: HomeCreatePanelProps) {
  const jobForm = useNewJobForm({
    setError,
    setSelectedJobId,
    refreshJobs,
    runtimeReady,
    runtimeCoreReady,
    onJobCreated: () => setActiveView("workspace"),
  });

  useEffect(() => {
    whisperxSetterRef.current = jobForm.setWhisperxOptions;
    return () => {
      whisperxSetterRef.current = null;
    };
  }, [jobForm.setWhisperxOptions, whisperxSetterRef]);

  return (
    <>
      <StudioOpenRunSection
        setError={setError}
        setActiveView={setActiveView}
        setSelectedJobId={setSelectedJobId}
        onOpenPlayer={onOpenPlayer}
      />
      <StudioNewJobSection
        runningJobs={runningJobs}
        errors={errors}
        refreshJobs={refreshJobs}
        jobForm={jobForm}
        runtime={runtime}
      />
    </>
  );
}
