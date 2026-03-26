import { useCallback, useState } from "react";
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
 */
export function NewJobDropZone({ onPath, onError, selectedLabel, disabled }: NewJobDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);

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
        onPath(path);
      } else {
        onError(
          "Impossible d’obtenir le chemin du fichier. Utilise « Parcourir » ou vérifie que tu déposes un fichier (pas un dossier).",
        );
      }
    },
    [disabled, onError, onPath],
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
