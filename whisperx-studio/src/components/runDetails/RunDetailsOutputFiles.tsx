import { useMemo, useState } from "react";
import { fileBasename } from "../../appUtils";
import type { Job } from "../../types";
import { runInTransition } from "../../whisperxOptionsTransitions";

export type RunDetailsOutputFilesProps = {
  job: Job;
  hasJsonOutput: boolean;
  onOpenPath: (path: string) => void;
  onPreview: (path: string) => void;
  onLoadTranscript: (path: string) => void;
  /** Passe au lecteur multi-pistes (manifest + média dans le dossier de sortie). */
  onOpenPlayerRun?: (outputDir: string, label?: string | null) => void;
};

type OutputCategory = "all" | "json" | "subtitles" | "data" | "media" | "other";

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Libellé court pour le badge « format » (lisibilité : extension ou fichier composé).
 */
function outputFormatBadgeLabel(path: string): string {
  const base = basename(path);
  const l = base.toLowerCase();

  const compound: [string, string][] = [
    [".timeline.json", "timeline.json"],
    [".run.json", "run.json"],
    [".words.ctm", "words.ctm"],
    [".words.csv", "words.csv"],
    [".pauses.csv", "pauses.csv"],
    [".ipu.csv", "ipu.csv"],
  ];
  for (const [suffix, label] of compound) {
    if (l.endsWith(suffix)) {
      return label;
    }
  }

  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0) {
    return "—";
  }
  const ext = base.slice(lastDot + 1);
  if (ext.length <= 5) {
    return ext.toUpperCase();
  }
  return ext;
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

const CATEGORY_ORDER: Exclude<OutputCategory, "all">[] = [
  "json",
  "subtitles",
  "data",
  "media",
  "other",
];

type FileRowProps = {
  path: string;
  onOpenPath: (path: string) => void;
  onPreview: (path: string) => void;
  onLoadTranscript: (path: string) => void;
};

function OutputFileRow({ path, onOpenPath, onPreview, onLoadTranscript }: FileRowProps) {
  const cat = inferCategory(path);
  const formatLabel = outputFormatBadgeLabel(path);
  return (
    <li className="file-list__item">
      <div className="file-list-row">
        <div className="file-list-badges">
          <span className={`file-list-badge file-list-badge--${cat}`} title="Catégorie détectée">
            {CATEGORY_LABELS[cat]}
          </span>
          <span
            className="file-list-badge file-list-badge--format"
            title="Format de sortie (extension ou type de fichier)"
          >
            {formatLabel}
          </span>
        </div>
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
          <button type="button" className="ghost" onClick={() => onLoadTranscript(path)}>
            Éditer transcript
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function RunDetailsOutputFiles({
  job,
  hasJsonOutput,
  onOpenPath,
  onPreview,
  onLoadTranscript,
  onOpenPlayerRun,
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

  /** Regroupement visuel par type (sans filtre texte, vue « Tous »). */
  const groupedByCategory = useMemo(() => {
    const buckets: Record<Exclude<OutputCategory, "all">, string[]> = {
      json: [],
      subtitles: [],
      data: [],
      media: [],
      other: [],
    };
    for (const path of job.outputFiles) {
      buckets[inferCategory(path)].push(path);
    }
    return CATEGORY_ORDER.map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      paths: buckets[id],
    })).filter((g) => g.paths.length > 0);
  }, [job.outputFiles]);

  const useGroupedLayout = category === "all" && filter.trim() === "" && job.outputFiles.length > 0;

  const rowProps = { onOpenPath, onPreview, onLoadTranscript };

  const canOpenPlayer = Boolean(
    onOpenPlayerRun && job.outputDir?.trim() && job.status !== "queued" && job.status !== "running",
  );

  return (
    <div className="output-files-section">
      <div className="output-files-section__head">
        <h3 className="output-files-section__title">Fichiers de sortie</h3>
        {job.outputFiles.length > 0 ? (
          <span className="output-files-section__meta">{job.outputFiles.length} fichier(s)</span>
        ) : null}
      </div>

      {job.outputFiles.length === 0 ? (
        <p className="small output-files-section__empty">Pas de fichier généré pour ce job.</p>
      ) : (
        <>
          {!hasJsonOutput ? (
            <p className="small output-files-section__hint">
              Aucun JSON détecté : l&apos;éditeur transcript ne peut pas s&apos;afficher pour ce
              job.
            </p>
          ) : null}

          <div className="output-files-quick-actions">
            <button type="button" className="ghost" onClick={() => onOpenPath(job.outputDir)}>
              Ouvrir le dossier de sortie
            </button>
            {canOpenPlayer ? (
              <button
                type="button"
                className="primary"
                onClick={() =>
                  onOpenPlayerRun?.(job.outputDir, fileBasename(job.inputPath) || job.id)
                }
              >
                Ouvrir dans le Player
              </button>
            ) : null}
          </div>

          <details className="output-files-guide">
            <summary className="output-files-guide__summary">
              Exploiter les sorties, vérifier les pauses (guide)
            </summary>
            <div className="output-files-guide__body">
              <p className="output-files-guide__lead">
                Une fois le job terminé, tu peux combiner <strong>prévisualisation</strong> ici, le{" "}
                <strong>lecteur</strong> (timeline) et l’<strong>Explorer</strong> (analyse
                fenêtrée) sur le même dossier de sortie.
              </p>
              <ul className="output-files-guide__list">
                <li>
                  <strong>JSON</strong> (<code>*.timeline.json</code>, <code>*.run.json</code>,
                  etc.) : structure du run et de la timeline — prévisualiser ou charger dans
                  l’éditeur transcript.
                </li>
                <li>
                  <strong>CSV</strong> (<code>words</code>, <code>pauses</code>, <code>ipu</code>…)
                  : ouvrir dans un tableur ou « Prévisualiser » pour contrôle rapide des colonnes.
                </li>
                <li>
                  <strong>Sous-titres</strong> (SRT, VTT, …) : lecture dans un lecteur vidéo ou
                  import outil.
                </li>
              </ul>
              <p className="output-files-guide__subhead">Vérifier les pauses dans Studio</p>
              <ol className="output-files-guide__list output-files-guide__list--numbered">
                <li>
                  Depuis le <strong>Studio</strong> (section « Ouvrir un run sur disque » ou
                  explorateur avancé) : ouvrir le dossier de sortie comme <strong>run</strong>{" "}
                  (dossier contenant un <code>run_manifest.json</code> si pipeline orchestré).
                </li>
                <li>
                  <strong>Indexer les événements</strong> (SQLite) pour importer mots / pauses / IPU
                  depuis la timeline.
                </li>
                <li>
                  Utiliser <strong>Pause suivante</strong>, le recalcul léger{" "}
                  <strong>Pauses / IPU</strong> (sliders) sans relancer WhisperX, ou le{" "}
                  <strong>Player</strong> pour la lecture avec vues mots / pauses.
                </li>
              </ol>
              <p className="output-files-guide__note">
                Le <strong>Player</strong> attend un répertoire de run valide (manifest + média). Si
                le manifest est dans un sous-dossier <code>runs/…</code>, ouvre ce dossier depuis le
                Studio (« Ouvrir un run sur disque »).
              </p>
            </div>
          </details>

          <div className="output-files-toolbar">
            <label className="output-files-filter">
              <span className="output-files-toolbar__label">Filtrer par nom</span>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                placeholder="ex. aligned, timeline, srt…"
                aria-label="Filtrer les fichiers par nom"
              />
            </label>
            <label className="output-files-category">
              <span className="output-files-toolbar__label">Type</span>
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
            <p className="small output-files-section__empty">
              Aucun fichier ne correspond au filtre.
            </p>
          ) : useGroupedLayout ? (
            <div
              className="output-files-groups"
              role="region"
              aria-label="Fichiers groupés par type"
            >
              {groupedByCategory.map((group) => (
                <section
                  key={group.id}
                  className="output-files-group"
                  aria-labelledby={`output-group-${group.id}`}
                >
                  <h4 className="output-files-group__title" id={`output-group-${group.id}`}>
                    <span className="output-files-group__label">{group.label}</span>
                    <span className="output-files-group__count">{group.paths.length}</span>
                  </h4>
                  <ul className="file-list">
                    {group.paths.map((path) => (
                      <OutputFileRow key={path} path={path} {...rowProps} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="file-list">
              {filteredFiles.map((path) => (
                <OutputFileRow key={path} path={path} {...rowProps} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
