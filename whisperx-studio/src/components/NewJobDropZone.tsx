import { useCallback, useEffect, useRef, useState } from "react";
import { resolveDroppedFilePathFromDragEvent } from "../utils/droppedFilePath";

export type NewJobDropZoneProps = {
  onPath: (absolutePath: string) => void;
  onError: (message: string) => void;
  /** Nom court du fichier déjà choisi (affichage dans la zone). */
  selectedLabel?: string;
  disabled?: boolean;
};

/**
 * Zone de dépôt média — étape Import ; complète « Parcourir » (chemins natifs Tauri / file://).
 * Sous Tauri, le drop HTML5 ne fournit souvent pas le chemin (ex. macOS) : on utilise
 * `webview.onDragDropEvent`. Ces événements ne concernent que le webview : la zone **effective**
 * de détection est donc toute la surface de la fenêtre (sans agrandir le rendu de la carte).
 */
export function NewJobDropZone({ onPath, onError, selectedLabel, disabled }: NewJobDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const tauriDropActiveRef = useRef(false);
  const lastEmittedRef = useRef<{ path: string; t: number } | null>(null);

  const emitPathOnce = useCallback(
    (path: string) => {
      const now = Date.now();
      const last = lastEmittedRef.current;
      if (last && last.path === path && now - last.t < 200) {
        return;
      }
      lastEmittedRef.current = { path, t: now };
      onPath(path);
    },
    [onPath],
  );

  useEffect(() => {
    let unlistenDrag: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const webview = getCurrentWebview();
        unlistenDrag = await webview.onDragDropEvent((event) => {
          if (cancelled || disabled) {
            return;
          }
          const payload = event.payload;

          if (payload.type === "leave") {
            setDragOver(false);
            return;
          }

          if (payload.type !== "enter" && payload.type !== "over" && payload.type !== "drop") {
            return;
          }

          if (payload.type === "enter" || payload.type === "over") {
            setDragOver(true);
          }

          if (payload.type === "drop" && payload.paths.length > 0) {
            const path = payload.paths[0];
            if (path) {
              emitPathOnce(path);
            }
          }
        });
        tauriDropActiveRef.current = true;
      } catch {
        tauriDropActiveRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      tauriDropActiveRef.current = false;
      unlistenDrag?.();
    };
  }, [disabled, emitPathOnce]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) {
      return;
    }
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (disabled) {
        return;
      }
      const path = resolveDroppedFilePathFromDragEvent(e.nativeEvent);
      if (path) {
        emitPathOnce(path);
        return;
      }
      if (!tauriDropActiveRef.current) {
        onError(
          "Impossible d’obtenir le chemin du fichier. Utilise « Parcourir » ou vérifie que tu déposes un fichier (pas un dossier).",
        );
      }
    },
    [disabled, emitPathOnce, onError],
  );

  return (
    <div
      role="region"
      aria-label="Zone de dépôt du média"
      className={`new-job-drop-zone${dragOver ? " new-job-drop-zone--active" : ""}${selectedLabel ? " new-job-drop-zone--has-file" : ""}`}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-disabled={disabled}
    >
      <p className="new-job-drop-zone__title">
        {selectedLabel ? selectedLabel : "Déposer un média ici"}
      </p>
      <p className="new-job-drop-zone__hint">
        {selectedLabel ? "Autre fichier pour remplacer." : "wav · mp3 · m4a · mp4 · mkv…"}
      </p>
    </div>
  );
}
