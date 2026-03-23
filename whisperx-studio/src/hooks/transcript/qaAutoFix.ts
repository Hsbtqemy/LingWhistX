import { MIN_SEGMENT_DURATION_SEC } from "../../constants";
import {
  buildEditorSnapshot,
  cloneEditableSegments,
  countSegmentWords,
  roundSecondsMs,
} from "../../appUtils";
import type { EditorSnapshot, TranscriptQaIssue } from "../../types";

export type QaAutoFixContext = {
  /** Duree media ; si absente ou <= 0, pas de plafond temporel. */
  waveformDurationSec: number | null | undefined;
  qaMinWps: number;
  qaMaxWps: number;
};

/**
 * Applique une correction automatique pour une anomalie QA sur un snapshot d'editeur.
 * Retourne `null` si aucun changement (segment introuvable ou regle non applicable).
 */
export function applyQaAutoFixSnapshot(
  current: EditorSnapshot,
  issue: TranscriptQaIssue,
  ctx: QaAutoFixContext,
): EditorSnapshot | null {
  const maxWps = Math.max(ctx.qaMinWps, ctx.qaMaxWps);
  const nextSegments = cloneEditableSegments(current.segments);
  const index = issue.segmentIndex;
  const segment = nextSegments[index];
  if (!segment) {
    return null;
  }
  const prev = index > 0 ? nextSegments[index - 1] : undefined;
  const next = index + 1 < nextSegments.length ? nextSegments[index + 1] : undefined;
  const maxDuration =
    ctx.waveformDurationSec && ctx.waveformDurationSec > 0
      ? ctx.waveformDurationSec
      : Number.POSITIVE_INFINITY;

  switch (issue.type) {
    case "invalid_duration": {
      const nextEnd = roundSecondsMs(segment.start + MIN_SEGMENT_DURATION_SEC);
      nextSegments[index] = { ...segment, end: nextEnd };
      break;
    }
    case "overlap":
    case "gap": {
      if (!prev) {
        return null;
      }
      const nextStart = roundSecondsMs(Math.max(0, prev.end));
      let nextEnd = Math.max(segment.end, nextStart + MIN_SEGMENT_DURATION_SEC);
      if (Number.isFinite(maxDuration)) {
        nextEnd = Math.min(nextEnd, maxDuration);
      }
      nextSegments[index] = {
        ...segment,
        start: nextStart,
        end: roundSecondsMs(Math.max(nextStart + MIN_SEGMENT_DURATION_SEC, nextEnd)),
      };
      break;
    }
    case "empty_text": {
      nextSegments[index] = { ...segment, text: "[inaudible]" };
      break;
    }
    case "speech_rate_high": {
      const words = countSegmentWords(segment.text);
      if (words === 0) {
        return null;
      }
      const desiredDuration = words / maxWps;
      let nextEnd = Math.max(segment.end, segment.start + desiredDuration);
      if (next) {
        nextEnd = Math.min(nextEnd, next.start - MIN_SEGMENT_DURATION_SEC);
      }
      if (Number.isFinite(maxDuration)) {
        nextEnd = Math.min(nextEnd, maxDuration);
      }
      nextEnd = Math.max(segment.start + MIN_SEGMENT_DURATION_SEC, nextEnd);
      if (nextEnd <= segment.end + 0.000001) {
        return null;
      }
      nextSegments[index] = { ...segment, end: roundSecondsMs(nextEnd) };
      break;
    }
    case "speech_rate_low": {
      const words = countSegmentWords(segment.text);
      if (words === 0) {
        return null;
      }
      const desiredDuration = words / ctx.qaMinWps;
      let nextEnd = Math.max(
        segment.start + MIN_SEGMENT_DURATION_SEC,
        segment.start + desiredDuration,
      );
      if (next) {
        nextEnd = Math.min(nextEnd, next.start - MIN_SEGMENT_DURATION_SEC);
      }
      nextEnd = Math.min(segment.end, nextEnd);
      if (nextEnd >= segment.end - 0.000001) {
        return null;
      }
      nextSegments[index] = { ...segment, end: roundSecondsMs(nextEnd) };
      break;
    }
    default:
      return null;
  }

  return buildEditorSnapshot(current.language, nextSegments);
}
