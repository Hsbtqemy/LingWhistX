import { clampNumber, closestSegmentIndex } from "../../appUtils";
import type { EditableSegment } from "../../types";

/**
 * Index du segment voisin pour navigation clavier (±1), aligné sur l’éditeur.
 */
export function relativeSegmentIndex(
  segments: EditableSegment[],
  actionSegmentIndex: number | null,
  cursorTimeSec: number,
  delta: -1 | 1,
): number | null {
  if (segments.length === 0) {
    return null;
  }
  const baseIndex =
    actionSegmentIndex ?? closestSegmentIndex(segments, cursorTimeSec) ?? 0;
  return clampNumber(baseIndex + delta, 0, segments.length - 1);
}
