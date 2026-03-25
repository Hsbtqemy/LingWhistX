import { MIN_SEGMENT_DURATION_SEC } from "../../constants";
import { joinSegmentTexts, roundSecondsMs, splitSegmentText } from "../../appUtils";
import type { EditableSegment } from "../../types";

export type SplitAtCursorFailure = "segment_too_short" | "invalid_position";

/**
 * Calcule le temps de coupe pour un split au curseur (même règles que l’éditeur).
 */
export function computeSplitAtCursor(
  segment: EditableSegment,
  cursorTimeSec: number,
  applySnap: (seconds: number) => number,
): { ok: true; splitAt: number } | { ok: false; reason: SplitAtCursorFailure } {
  const lowerBound = segment.start + MIN_SEGMENT_DURATION_SEC;
  const upperBound = segment.end - MIN_SEGMENT_DURATION_SEC;
  if (upperBound <= lowerBound) {
    return { ok: false, reason: "segment_too_short" };
  }

  const rawCursor = Number.isFinite(cursorTimeSec)
    ? cursorTimeSec
    : segment.start + (segment.end - segment.start) / 2;
  let splitAt = Math.min(upperBound, Math.max(lowerBound, applySnap(rawCursor)));
  splitAt = Math.min(upperBound, Math.max(lowerBound, splitAt));
  splitAt = roundSecondsMs(splitAt);
  if (splitAt <= segment.start || splitAt >= segment.end) {
    return { ok: false, reason: "invalid_position" };
  }

  return { ok: true, splitAt };
}

export function buildSplitPair(
  segment: EditableSegment,
  splitAt: number,
): [EditableSegment, EditableSegment] {
  const [leftText, rightText] = splitSegmentText(segment.text);
  const left: EditableSegment = {
    ...segment,
    end: splitAt,
    text: leftText,
  };
  const right: EditableSegment = {
    ...segment,
    start: splitAt,
    text: rightText,
  };
  return [left, right];
}

export function mergeTwoEditableSegments(
  first: EditableSegment,
  second: EditableSegment,
): EditableSegment {
  const leftSpeaker = first.speaker?.trim() || "";
  const rightSpeaker = second.speaker?.trim() || "";
  const mergedSpeaker = leftSpeaker || rightSpeaker || undefined;
  return {
    start: roundSecondsMs(Math.min(first.start, second.start)),
    end: roundSecondsMs(Math.max(first.end, second.end)),
    text: joinSegmentTexts(first.text, second.text),
    speaker: mergedSpeaker,
  };
}
