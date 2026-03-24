import type { ExplorerLayerToggles } from "../../types";

export const EXPLORER_LAYERS_STORAGE_KEY = "lingwhistx-explorer-layers-v1";

export const DEFAULT_EXPLORER_LAYERS: ExplorerLayerToggles = {
  turns: true,
  pauses: true,
  ipus: true,
  overlap: false,
  words: true,
  wordsAutoZoom: false,
  segments: true,
};

export function loadExplorerLayers(): ExplorerLayerToggles {
  try {
    const raw = sessionStorage.getItem(EXPLORER_LAYERS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_EXPLORER_LAYERS };
    }
    const parsed = JSON.parse(raw) as Partial<ExplorerLayerToggles>;
    return { ...DEFAULT_EXPLORER_LAYERS, ...parsed };
  } catch {
    return { ...DEFAULT_EXPLORER_LAYERS };
  }
}
