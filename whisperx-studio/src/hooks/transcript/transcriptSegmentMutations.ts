import { DEFAULT_INSERT_SEGMENT_DURATION_SEC, MIN_SEGMENT_DURATION_SEC } from "../../constants";
import { buildEditorSnapshot, cloneEditableSegments, roundSecondsMs } from "../../appUtils";
import type { EditableSegment, EditorSnapshot, SegmentEdge } from "../../types";

/** Mutations pures sur un `EditorSnapshot` (tests sans React). */

export function resizeSegmentBoundaryInSnapshot(
  current: EditorSnapshot,
  index: number,
  edge: SegmentEdge,
  rawSeconds: number,
  maxDurationSec: number,
  applySnap: (seconds: number) => number,
): EditorSnapshot {
  const nextSegments = cloneEditableSegments(current.segments);
  const segment = nextSegments[index];
  if (!segment) {
    return current;
  }

  const maxDuration =
    Number.isFinite(maxDurationSec) && maxDurationSec > 0
      ? maxDurationSec
      : Number.POSITIVE_INFINITY;

  let start = segment.start;
  let end = segment.end;
  const snappedInput = applySnap(Number.isFinite(rawSeconds) ? rawSeconds : 0);
  const clampedInput = Math.max(0, snappedInput);

  if (edge === "start") {
    start = Math.min(clampedInput, end - MIN_SEGMENT_DURATION_SEC);
    if (start < 0) {
      start = 0;
    }
    if (start > maxDuration - MIN_SEGMENT_DURATION_SEC) {
      start = Math.max(0, maxDuration - MIN_SEGMENT_DURATION_SEC);
    }
  } else {
    end = Math.max(clampedInput, start + MIN_SEGMENT_DURATION_SEC);
    if (end > maxDuration) {
      end = maxDuration;
    }
  }

  if (end < start + MIN_SEGMENT_DURATION_SEC) {
    end = start + MIN_SEGMENT_DURATION_SEC;
  }
  start = Math.max(0, start);
  end = Math.max(start + MIN_SEGMENT_DURATION_SEC, end);

  nextSegments[index] = {
    ...segment,
    start: roundSecondsMs(start),
    end: roundSecondsMs(end),
  };
  return buildEditorSnapshot(current.language, nextSegments);
}

export function mutateSegmentText(
  current: EditorSnapshot,
  index: number,
  text: string,
): EditorSnapshot {
  const nextSegments = cloneEditableSegments(current.segments);
  const segment = nextSegments[index];
  if (!segment) {
    return current;
  }
  nextSegments[index] = { ...segment, text };
  return buildEditorSnapshot(current.language, nextSegments);
}

export function mutateEditorLanguage(
  current: EditorSnapshot,
  nextLanguage: string,
): EditorSnapshot {
  if (current.language === nextLanguage) {
    return current;
  }
  return buildEditorSnapshot(nextLanguage, current.segments);
}

export function replaceSegmentWithPair(
  current: EditorSnapshot,
  targetIndex: number,
  left: EditableSegment,
  right: EditableSegment,
): EditorSnapshot {
  const nextSegments = cloneEditableSegments(current.segments);
  if (!nextSegments[targetIndex]) {
    return current;
  }
  nextSegments.splice(targetIndex, 1, left, right);
  return buildEditorSnapshot(current.language, nextSegments);
}

/**
 * Insère un segment vide après `afterIndex` (ou au début si `afterIndex` est null).
 * Le segment est positionné sur `atSec` (position curseur) avec une durée par défaut.
 * Si un segment adjacent existe, les bornes sont clampées pour éviter les overlaps.
 */
export function insertBlankSegmentInSnapshot(
  current: EditorSnapshot,
  afterIndex: number | null,
  atSec: number,
  maxDurationSec: number,
): { snapshot: EditorSnapshot; insertedIndex: number; segment: EditableSegment } {
  const segments = cloneEditableSegments(current.segments);
  const insertIndex = afterIndex === null ? 0 : afterIndex + 1;

  const prevSeg = afterIndex !== null ? segments[afterIndex] : undefined;
  const nextSeg = segments[insertIndex];

  // Borne le début sur la fin du segment précédent
  const start = roundSecondsMs(Math.max(atSec, prevSeg ? prevSeg.end : 0));

  // Borne la fin sur le début du segment suivant, ou durée média
  const maxEnd = nextSeg
    ? nextSeg.start
    : Number.isFinite(maxDurationSec) && maxDurationSec > 0
      ? maxDurationSec
      : start + DEFAULT_INSERT_SEGMENT_DURATION_SEC;

  const end = roundSecondsMs(
    Math.min(
      start + DEFAULT_INSERT_SEGMENT_DURATION_SEC,
      Math.max(maxEnd, start + MIN_SEGMENT_DURATION_SEC),
    ),
  );

  // Réutilise le locuteur du segment précédent ou suivant pour minimiser la saisie
  const speaker = prevSeg?.speaker ?? nextSeg?.speaker ?? "SPEAKER_00";

  const segment: EditableSegment = { start, end, text: "", speaker };
  segments.splice(insertIndex, 0, segment);
  return {
    snapshot: buildEditorSnapshot(current.language, segments),
    insertedIndex: insertIndex,
    segment,
  };
}

export function mergeTwoSegmentsAt(
  current: EditorSnapshot,
  firstIndex: number,
  secondIndex: number,
  merged: EditableSegment,
): EditorSnapshot {
  const nextSegments = cloneEditableSegments(current.segments);
  if (!nextSegments[firstIndex] || !nextSegments[secondIndex]) {
    return current;
  }
  nextSegments.splice(firstIndex, 2, merged);
  return buildEditorSnapshot(current.language, nextSegments);
}
