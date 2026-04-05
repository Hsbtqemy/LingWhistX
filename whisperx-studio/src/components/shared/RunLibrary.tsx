import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef } from "react";
import { useRunLibrary, type LibraryEntry } from "../../hooks/useRunLibrary";

type RunLibraryProps = {
  open: boolean;
  onClose: () => void;
  onOpenPlayer: (runDir: string, label?: string) => void;
  onOpenEditor: (runDir: string, label?: string) => void;
};

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function RunEntry({
  entry,
  onOpenPlayer,
  onOpenEditor,
}: {
  entry: LibraryEntry;
  onOpenPlayer: (runDir: string, label?: string) => void;
  onOpenEditor: (runDir: string, label?: string) => void;
}) {
  const { manifest, label, lastOpenedAtMs } = entry;

  return (
    <div className="run-library-entry">
      <div className="run-library-entry__header">
        <span className="run-library-entry__label" title={entry.runDir}>
          {label}
        </span>
        <span className="run-library-entry__date">{fmtDate(lastOpenedAtMs)}</span>
      </div>
      <div className="run-library-entry__meta">
        {manifest?.durationSec != null && (
          <span className="run-library-entry__chip">{fmtDuration(manifest.durationSec)}</span>
        )}
        {manifest?.statsNSegments != null && (
          <span className="run-library-entry__chip">{manifest.statsNSegments} seg.</span>
        )}
        {manifest?.statsNWords != null && (
          <span className="run-library-entry__chip">{manifest.statsNWords} mots</span>
        )}
        {manifest?.artifactCount != null && manifest.artifactCount > 0 && (
          <span className="run-library-entry__chip">{manifest.artifactCount} fichiers</span>
        )}
      </div>
      <div className="run-library-entry__actions">
        <button
          type="button"
          className="run-library-entry__btn run-library-entry__btn--primary"
          onClick={() => onOpenPlayer(entry.runDir, label)}
        >
          Player
        </button>
        <button
          type="button"
          className="run-library-entry__btn"
          onClick={() => onOpenEditor(entry.runDir, label)}
        >
          Éditeur
        </button>
      </div>
    </div>
  );
}

export function RunLibrary({ open, onClose, onOpenPlayer, onOpenEditor }: RunLibraryProps) {
  const { entries, loading, error, query, setQuery, refresh } = useRunLibrary(open);
  const searchRef = useRef<HTMLInputElement>(null);

  // Wrap callbacks so clicking an entry also closes the panel
  const handleOpenPlayer = useCallback(
    (dir: string, lbl?: string) => {
      onOpenPlayer(dir, lbl);
      onClose();
    },
    [onOpenPlayer, onClose],
  );
  const handleOpenEditor = useCallback(
    (dir: string, lbl?: string) => {
      onOpenEditor(dir, lbl);
      onClose();
    },
    [onOpenEditor, onClose],
  );

  useEffect(() => {
    if (!open) return;
    // Focus search input after the panel has rendered (~1 frame)
    const id = setTimeout(() => searchRef.current?.focus(), 80);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const panel = (
    <>
      <div className="run-library-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="run-library-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Bibliothèque de runs"
      >
        <div className="run-library-header">
          <span className="run-library-title">Bibliothèque</span>
          <div className="run-library-header-actions">
            <button
              type="button"
              className="run-library-refresh-btn"
              onClick={refresh}
              title="Recharger la liste des runs depuis le disque"
              aria-label="Actualiser la liste des runs"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              <span className="run-library-refresh-label">Actualiser</span>
            </button>
            <button
              type="button"
              className="run-library-close-btn"
              onClick={onClose}
              title="Fermer (Échap)"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>
        </div>

        <div className="run-library-search">
          <input
            ref={searchRef}
            type="search"
            className="run-library-search-input"
            placeholder="Nom du média, ID du run… (vide = tout afficher)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filtrer la bibliothèque par nom de fichier ou identifiant de run"
            aria-describedby="run-library-search-hint"
          />
          <p id="run-library-search-hint" className="run-library-search-hint small">
            Saisissez une partie du <strong>nom du fichier source</strong> ou de l’
            <strong>identifiant du run</strong>. Laissez le champ vide pour voir tous les runs
            récents.
          </p>
        </div>

        <div className="run-library-body">
          {loading && <div className="run-library-state">Chargement…</div>}
          {!loading && error && (
            <div className="run-library-state run-library-state--error">{error}</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="run-library-state">
              {query ? "Aucun résultat." : "Aucun run récent."}
            </div>
          )}
          {!loading &&
            !error &&
            entries.map((entry) => (
              <RunEntry
                key={entry.runDir}
                entry={entry}
                onOpenPlayer={handleOpenPlayer}
                onOpenEditor={handleOpenEditor}
              />
            ))}
        </div>
      </div>
    </>
  );

  return createPortal(panel, document.body);
}
