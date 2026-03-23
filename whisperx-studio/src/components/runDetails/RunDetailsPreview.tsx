import { ErrorBanner } from "../ErrorBanner";

export type RunDetailsPreviewProps = {
  selectedPreviewPath: string;
  isPreviewLoading: boolean;
  previewError: string;
  previewContent: string;
};

export function RunDetailsPreview({
  selectedPreviewPath,
  isPreviewLoading,
  previewError,
  previewContent,
}: RunDetailsPreviewProps) {
  return (
    <>
      <h3>Aperçu fichier</h3>
      {!selectedPreviewPath ? (
        <p className="muted-hint">Sélectionne un fichier de sortie puis « Prévisualiser ».</p>
      ) : (
        <div className="preview-box">
          <p className="mono">{selectedPreviewPath}</p>
          {isPreviewLoading ? <p className="small">Chargement…</p> : null}
          {previewError ? (
            <ErrorBanner>
              <p className="error-banner-text">{previewError}</p>
            </ErrorBanner>
          ) : null}
          {previewContent ? <pre>{previewContent}</pre> : null}
        </div>
      )}
    </>
  );
}
