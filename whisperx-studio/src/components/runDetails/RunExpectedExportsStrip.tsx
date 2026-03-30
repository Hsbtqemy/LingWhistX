import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Job } from "../../types";
import {
  expectedAnnotationExtensions,
  expectedWhisperxStemExtensions,
  hasStemExtensionFile,
  mediaStemFromInputPath,
} from "../../utils/expectedOutputFormats";

export type RunExpectedExportsStripProps = {
  job: Job;
};

/**
 * Formats d’export attendus (options WhisperX) + suivi disque pendant le run.
 * Les exports principaux sont écrits en fin de pipeline WhisperX, pas fichier par fichier en direct.
 */
export function RunExpectedExportsStrip({ job }: RunExpectedExportsStripProps) {
  const [polledPaths, setPolledPaths] = useState<string[]>([]);
  const [pollError, setPollError] = useState(false);

  const stem = useMemo(() => mediaStemFromInputPath(job.inputPath), [job.inputPath]);
  const extensions = useMemo(
    () => [
      ...expectedWhisperxStemExtensions(job.whisperxOptions?.outputFormat),
      ...expectedAnnotationExtensions(job.whisperxOptions),
    ],
    [job.whisperxOptions],
  );

  const mergedPaths = useMemo(() => {
    const s = new Set<string>();
    for (const p of job.outputFiles) {
      s.add(p);
    }
    for (const p of polledPaths) {
      s.add(p);
    }
    return Array.from(s);
  }, [job.outputFiles, polledPaths]);

  const shouldPoll =
    job.mode === "whisperx" && (job.status === "queued" || job.status === "running");

  useEffect(() => {
    if (!shouldPoll || !job.outputDir.trim()) {
      setPolledPaths([]);
      setPollError(false);
      return;
    }

    let cancelled = false;

    async function tick() {
      try {
        const paths = await invoke<string[]>("list_directory_files", {
          dirPath: job.outputDir,
        });
        if (!cancelled) {
          setPolledPaths(paths);
          setPollError(false);
        }
      } catch {
        if (!cancelled) {
          setPollError(true);
        }
      }
    }

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 2800);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [shouldPoll, job.outputDir]);

  if (job.mode !== "whisperx") {
    return null;
  }

  return (
    <div className="run-expected-exports" data-job-status={job.status}>
      <h4 className="run-expected-exports__title">Exports prévus (WhisperX)</h4>
      <p className="run-expected-exports__hint field-help">
        Les fichiers principaux listés ci-dessous sont produits <strong>à la fin</strong> du pipeline
        (transcription, alignement, diarisation si activée, puis écriture). D’autres fichiers
        (.timeline.json, .csv, etc.) peuvent apparaître selon les options d’analyse.
      </p>
      <ul className="run-expected-exports__chips" aria-label="Formats attendus et état">
        {extensions.map((ext) => {
          const ready = hasStemExtensionFile(mergedPaths, stem, ext);
          return (
            <li key={ext}>
              <span
                className={`run-expected-exports__chip ${ready ? "run-expected-exports__chip--ready" : ""}`}
                title={
                  ready
                    ? `Fichier détecté : ${stem}.${ext}`
                    : `En attente : ${stem}.${ext}`
                }
              >
                <span className="run-expected-exports__status" aria-hidden>
                  {ready ? "✓" : "…"}
                </span>
                <span className="mono">{stem}.{ext}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {pollError && shouldPoll ? (
        <p className="field-help run-expected-exports__warn">
          Impossible de lister le dossier de sortie (vérifie les droits ou le chemin).
        </p>
      ) : null}
    </div>
  );
}
