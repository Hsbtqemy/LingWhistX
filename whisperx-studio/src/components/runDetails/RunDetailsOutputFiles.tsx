import { useMemo, useState } from "react";
import type { Job } from "../../types";
import { runInTransition } from "../../whisperxOptionsTransitions";

export type RunDetailsOutputFilesProps = {
  job: Job;
  hasJsonOutput: boolean;
  onOpenPath: (path: string) => void;
  onPreview: (path: string) => void;
  onLoadTranscript: (path: string) => void;
};

type OutputCategory = "all" | "json" | "subtitles" | "data" | "media" | "other";

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function inferCategory(path: string): Exclude<OutputCategory, "all"> {
  const lower = path.toLowerCase();
  const base = basename(lower);
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (/\.(srt|vtt|txt|tsv)$/.test(lower)) {
    return "subtitles";
  }
  if (
    /\.(csv)$/.test(lower) ||
    base.includes("timeline") ||
    base.includes(".run.json") ||
    base.includes("words.") ||
    base.includes("pauses.") ||
    base.includes("ipu.")
  ) {
    return "data";
  }
  if (/\.(wav|mp3|m4a|flac|ogg|opus|aac|aud)$/.test(lower)) {
    return "media";
  }
  return "other";
}

const CATEGORY_LABELS: Record<Exclude<OutputCategory, "all">, string> = {
  json: "JSON",
  subtitles: "Sous-titres & texte",
  data: "Données & analyse",
  media: "Média",
  other: "Autre",
};

export function RunDetailsOutputFiles({
  job,
  hasJsonOutput,
  onOpenPath,
  onPreview,
  onLoadTranscript,
}: RunDetailsOutputFilesProps) {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<OutputCategory>("all");

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return job.outputFiles.filter((path) => {
      if (category !== "all" && inferCategory(path) !== category) {
        return false;
      }
      if (!q) {
        return true;
      }
      return basename(path).toLowerCase().includes(q);
    });
  }, [job.outputFiles, filter, category]);

  const groupedCounts = useMemo(() => {
    const counts: Record<Exclude<OutputCategory, "all">, number> = {
      json: 0,
      subtitles: 0,
      data: 0,
      media: 0,
      other: 0,
    };
    for (const path of job.outputFiles) {
      counts[inferCategory(path)] += 1;
    }
    return counts;
  }, [job.outputFiles]);

  return (
    <>
      <h3>Fichiers de sortie</h3>
      {job.outputFiles.length === 0 ? (
        <p className="small">Pas de fichier genere pour ce job.</p>
      ) : (
        <>
          {!hasJsonOutput ? (
            <p className="small">
              Aucun JSON detecte: l&apos;editeur transcript ne peut pas s&apos;afficher pour ce job.
            </p>
          ) : null}

          <div className="output-files-toolbar">
            <label className="output-files-filter">
              <span className="small">Filtrer par nom</span>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                placeholder="ex. aligned, timeline, srt..."
                aria-label="Filtrer les fichiers par nom"
              />
            </label>
            <label className="output-files-category">
              <span className="small">Type</span>
              <select
                value={category}
                onChange={(e) =>
                  runInTransition(() => setCategory(e.target.value as OutputCategory))
                }
                aria-label="Filtrer par type de fichier"
              >
                <option value="all">Tous ({job.outputFiles.length})</option>
                <option value="json">
                  {CATEGORY_LABELS.json} ({groupedCounts.json})
                </option>
                <option value="subtitles">
                  {CATEGORY_LABELS.subtitles} ({groupedCounts.subtitles})
                </option>
                <option value="data">
                  {CATEGORY_LABELS.data} ({groupedCounts.data})
                </option>
                <option value="media">
                  {CATEGORY_LABELS.media} ({groupedCounts.media})
                </option>
                <option value="other">
                  {CATEGORY_LABELS.other} ({groupedCounts.other})
                </option>
              </select>
            </label>
          </div>

          {filteredFiles.length === 0 ? (
            <p className="small">Aucun fichier ne correspond au filtre.</p>
          ) : (
            <ul className="file-list">
              {filteredFiles.map((path) => (
                <li key={path}>
                  <div className="file-list-row">
                    <span className="file-list-badge" title="Type detecte">
                      {CATEGORY_LABELS[inferCategory(path)]}
                    </span>
                    <span className="mono file-list-path">{path}</span>
                  </div>
                  <div className="file-actions">
                    <button type="button" className="ghost" onClick={() => onOpenPath(path)}>
                      Ouvrir
                    </button>
                    <button type="button" className="ghost" onClick={() => onPreview(path)}>
                      Prévisualiser
                    </button>
                    {path.toLowerCase().endsWith(".json") ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => onLoadTranscript(path)}
                      >
                        Editer transcript
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
