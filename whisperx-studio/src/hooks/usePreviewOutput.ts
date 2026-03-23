import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPreviewableFile } from "../appUtils";

export function usePreviewOutput() {
  const [selectedPreviewPath, setSelectedPreviewPath] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const clearPreview = useCallback(() => {
    setSelectedPreviewPath("");
    setPreviewContent("");
    setPreviewError("");
  }, []);

  const previewOutput = useCallback(async (path: string) => {
    setSelectedPreviewPath(path);
    setPreviewError("");
    if (!isPreviewableFile(path)) {
      setPreviewContent("");
      setPreviewError("Prévisualisation indisponible pour ce type de fichier. Utilise « Ouvrir ».");
      return;
    }

    setIsPreviewLoading(true);
    try {
      const content = await invoke<string>("read_text_preview", {
        path,
        maxBytes: 300000,
      });
      setPreviewContent(content);
    } catch (e) {
      setPreviewContent("");
      setPreviewError(String(e));
    } finally {
      setIsPreviewLoading(false);
    }
  }, []);

  return {
    selectedPreviewPath,
    previewContent,
    previewError,
    isPreviewLoading,
    previewOutput,
    clearPreview,
  };
}
