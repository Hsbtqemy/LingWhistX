/**
 * WX-665 — Panneau d'aperçu audio A/B (original vs prétraité).
 *
 * Génère un extrait de 30 s à partir du fichier média sélectionné,
 * applique les modules pipeline configurés, et permet le toggle A/B.
 */
import { useEffect, useRef } from "react";
import type { AudioPreviewSlot } from "../hooks/useAudioPreview";
import type { AudioPreviewState } from "../hooks/useAudioPreview";

export type AudioPreviewPanelProps = {
  inputPath: string;
  modulesJson: string;
  /** Total duration of the media in seconds (for "mid" button). Null = unknown. */
  mediaDurationSec?: number | null;
  state: AudioPreviewState;
  activeAudioSrc: string | null;
  onGenerate: (startSec: number) => void;
  onSetSlot: (slot: AudioPreviewSlot) => void;
};

export function AudioPreviewPanel({
  inputPath,
  modulesJson,
  mediaDurationSec,
  state,
  activeAudioSrc,
  onGenerate,
  onSetSlot,
}: AudioPreviewPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reload audio element when src changes (switching A/B slot).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.load();
  }, [activeAudioSrc]);

  const hasMedia = inputPath.trim().length > 0;
  const hasModules = (() => {
    try {
      const parsed = modulesJson.trim() ? JSON.parse(modulesJson) : {};
      return typeof parsed === "object" && parsed !== null && Object.keys(parsed).length > 0;
    } catch {
      return false;
    }
  })();
  const hasPreview = state.originalB64 !== null;
  const midSec =
    mediaDurationSec != null && Number.isFinite(mediaDurationSec)
      ? Math.max(0, mediaDurationSec / 2 - 15)
      : null;

  return (
    <div className="audio-preview-panel">
      <div className="audio-preview-panel__header">
        <span className="audio-preview-panel__title">Aperçu prétraité (WX-665)</span>
        {!hasModules && (
          <span className="field-help"> — configurez des modules pipeline pour comparer A/B</span>
        )}
      </div>

      <div className="audio-preview-panel__actions">
        <button
          type="button"
          className="ghost inline small"
          disabled={!hasMedia || state.isGenerating}
          onClick={() => onGenerate(0)}
          title="Extrait les 30 premières secondes"
        >
          {state.isGenerating ? "Génération…" : "Aperçu 30 s (début)"}
        </button>

        {midSec !== null && (
          <button
            type="button"
            className="ghost inline small"
            disabled={!hasMedia || state.isGenerating}
            onClick={() => onGenerate(midSec)}
            title={`Extrait 30 s à partir de ${Math.floor(midSec)}s (milieu du fichier)`}
          >
            Aperçu 30 s (milieu)
          </button>
        )}
      </div>

      {state.error && <p className="audio-preview-panel__error field-help">{state.error}</p>}

      {hasPreview && (
        <>
          {/* A/B toggle */}
          <div className="audio-preview-panel__ab-toggle" role="group" aria-label="Toggle A/B">
            <button
              type="button"
              className={`audio-preview-panel__ab-btn${state.activeSlot === "original" ? " active" : ""}`}
              onClick={() => onSetSlot("original")}
              aria-pressed={state.activeSlot === "original"}
            >
              Original
            </button>
            <button
              type="button"
              className={`audio-preview-panel__ab-btn${state.activeSlot === "processed" ? " active" : ""}`}
              onClick={() => onSetSlot("processed")}
              aria-pressed={state.activeSlot === "processed"}
              disabled={!state.isProcessed}
              title={
                !state.isProcessed ? "Aucun module actif — audio identique à l'original" : undefined
              }
            >
              Traité
            </button>
          </div>

          {!state.isProcessed && (
            <p className="field-help audio-preview-panel__no-module-hint">
              Aucun module actif — l'audio traité est identique à l'original.
            </p>
          )}

          {/* Audio player */}
          {activeAudioSrc && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio
              ref={audioRef}
              src={activeAudioSrc}
              controls
              className="audio-preview-panel__player"
              aria-label={`Aperçu audio — ${state.activeSlot === "original" ? "original" : "prétraité"}`}
            />
          )}
        </>
      )}
    </div>
  );
}
