import { invoke } from "@tauri-apps/api/core";
import { joinPathSegments } from "../../appUtils";

export type PlayerRunArtifactsStripProps = {
  runDir: string;
  artifactKeys: string[];
};

/**
 * Raccourcis pour ouvrir les fichiers listés dans le manifest (clés relatives au dossier de run).
 */
export function PlayerRunArtifactsStrip({ runDir, artifactKeys }: PlayerRunArtifactsStripProps) {
  if (artifactKeys.length === 0) {
    return null;
  }

  const openKey = async (key: string) => {
    const path = joinPathSegments(runDir, key);
    try {
      await invoke("open_local_path", { path });
    } catch {
      /* ignoré : feedback minimal ; le shell peut refuser */
    }
  };

  const shown = artifactKeys.slice(0, 14);

  return (
    <div className="player-artifacts-strip" role="region" aria-label="Fichiers du manifest">
      <span className="player-artifacts-strip__label">Artefacts</span>
      <div className="player-artifacts-strip__keys">
        {shown.map((k) => (
          <button
            key={k}
            type="button"
            className="ghost player-artifacts-strip__key"
            title={joinPathSegments(runDir, k)}
            onClick={() => void openKey(k)}
          >
            {k}
          </button>
        ))}
        {artifactKeys.length > shown.length ? (
          <span className="small player-artifacts-strip__more" title={artifactKeys.join(", ")}>
            +{artifactKeys.length - shown.length}…
          </span>
        ) : null}
      </div>
    </div>
  );
}
