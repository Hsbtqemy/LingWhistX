import type { EditableSegment, EventTurnRow, QueryWindowResult } from "../../../types";

export const SPEAKER_COLORS = [
  "var(--lx-accent)",
  "#e67e22",
  "#27ae60",
  "#8e44ad",
  "#e74c3c",
  "#16a085",
  "#d35400",
  "#2980b9",
];

export function speakerColor(idx: number): string {
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

export function turnTextFromIpus(
  turn: EventTurnRow,
  ipus: QueryWindowResult["ipus"],
): string {
  const overlapping = ipus.filter(
    (ipu) => ipu.endMs > turn.startMs && ipu.startMs < turn.endMs,
  );
  if (overlapping.length === 0) return "";
  return overlapping
    .map((ipu) => ipu.text?.trim())
    .filter(Boolean)
    .join(" ");
}

export function turnTextFromSegments(
  turn: EventTurnRow,
  segments: EditableSegment[],
): string {
  const overlapping = segments.filter((seg) => {
    const sMs = Math.round(seg.start * 1000);
    const eMs = Math.round(seg.end * 1000);
    return eMs > turn.startMs && sMs < turn.endMs;
  });
  if (overlapping.length === 0) return "";
  return overlapping
    .map((seg) => seg.text?.trim())
    .filter(Boolean)
    .join(" ");
}

export function findSegmentIndexForTurn(
  turn: EventTurnRow,
  segments: EditableSegment[],
  ordinalIndex: Map<number, number> | null,
  allTurns: EventTurnRow[],
): number | null {
  for (let i = 0; i < segments.length; i++) {
    const sMs = Math.round(segments[i].start * 1000);
    const eMs = Math.round(segments[i].end * 1000);
    if (eMs > turn.startMs && sMs < turn.endMs) return i;
  }
  if (ordinalIndex) {
    const globalIdx = allTurns.indexOf(turn);
    const segIdx = ordinalIndex.get(globalIdx);
    if (segIdx != null) return segIdx;
  }
  return null;
}

/**
 * Pré-calcule un index ordinal turn→segment (global par ordre).
 * Fallback quand le matching temporel échoue (timestamps corrompus).
 */
export function buildOrdinalSegmentIndex(
  turns: EventTurnRow[],
  segments: EditableSegment[],
): Map<number, number> {
  const result = new Map<number, number>();
  for (let i = 0; i < turns.length && i < segments.length; i++) {
    result.set(i, i);
  }
  return result;
}
