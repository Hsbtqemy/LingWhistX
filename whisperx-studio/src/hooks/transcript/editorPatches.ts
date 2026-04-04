/**
 * WX-658 — opérations sur les patches d'historique éditeur.
 *
 * Chaque `SegmentPatch` est une mutation atomique inversible sur un `EditorSnapshot`.
 * `applyPatch` applique le patch dans le sens forward.
 * `invertPatch` retourne le patch inverse (pour undo).
 */

import { buildEditorSnapshot, cloneEditableSegments } from "../../appUtils";
import type { EditorSnapshot, SegmentPatch } from "../../types";

/**
 * Applique un patch à un snapshot et retourne le snapshot résultant.
 * Retourne le snapshot inchangé si le patch ne peut pas s'appliquer (index hors bornes).
 */
export function applyPatch(snapshot: EditorSnapshot, patch: SegmentPatch): EditorSnapshot {
  switch (patch.kind) {
    case "text_change": {
      const segments = cloneEditableSegments(snapshot.segments);
      const seg = segments[patch.index];
      if (!seg) return snapshot;
      segments[patch.index] = { ...seg, text: patch.nextText };
      return buildEditorSnapshot(snapshot.language, segments);
    }

    case "timing_change": {
      const segments = cloneEditableSegments(snapshot.segments);
      const seg = segments[patch.index];
      if (!seg) return snapshot;
      segments[patch.index] = { ...seg, start: patch.nextStart, end: patch.nextEnd };
      return buildEditorSnapshot(snapshot.language, segments);
    }

    case "split": {
      const segments = cloneEditableSegments(snapshot.segments);
      if (!segments[patch.index]) return snapshot;
      segments.splice(patch.index, 1, { ...patch.left }, { ...patch.right });
      return buildEditorSnapshot(snapshot.language, segments);
    }

    case "merge": {
      const segments = cloneEditableSegments(snapshot.segments);
      if (!segments[patch.firstIndex] || !segments[patch.secondIndex]) return snapshot;
      segments.splice(patch.firstIndex, 2, { ...patch.merged });
      return buildEditorSnapshot(snapshot.language, segments);
    }

    case "language_change": {
      return buildEditorSnapshot(patch.nextLanguage, snapshot.segments);
    }

    case "speaker_change": {
      const segments = cloneEditableSegments(snapshot.segments);
      const seg = segments[patch.index];
      if (!seg) return snapshot;
      segments[patch.index] = { ...seg, speaker: patch.nextSpeaker };
      return buildEditorSnapshot(snapshot.language, segments);
    }

    case "insert_segment": {
      const segments = cloneEditableSegments(snapshot.segments);
      segments.splice(patch.index, 0, { ...patch.segment });
      return buildEditorSnapshot(snapshot.language, segments);
    }

    case "delete_segment": {
      const segments = cloneEditableSegments(snapshot.segments);
      if (!segments[patch.index]) return snapshot;
      segments.splice(patch.index, 1);
      return buildEditorSnapshot(snapshot.language, segments);
    }
  }
}

/**
 * Retourne le patch inverse — appliquer `invertPatch(p)` annule l'effet de `applyPatch(p)`.
 */
export function invertPatch(patch: SegmentPatch): SegmentPatch {
  switch (patch.kind) {
    case "text_change":
      return {
        kind: "text_change",
        index: patch.index,
        prevText: patch.nextText,
        nextText: patch.prevText,
      };

    case "timing_change":
      return {
        kind: "timing_change",
        index: patch.index,
        prevStart: patch.nextStart,
        prevEnd: patch.nextEnd,
        nextStart: patch.prevStart,
        nextEnd: patch.prevEnd,
      };

    case "split":
      // L'inverse d'un split est un merge.
      return {
        kind: "merge",
        firstIndex: patch.index,
        secondIndex: patch.index + 1,
        seg1: { ...patch.left },
        seg2: { ...patch.right },
        merged: { ...patch.original },
      };

    case "merge":
      // L'inverse d'un merge est un split.
      return {
        kind: "split",
        index: patch.firstIndex,
        original: { ...patch.merged },
        left: { ...patch.seg1 },
        right: { ...patch.seg2 },
      };

    case "language_change":
      return {
        kind: "language_change",
        prevLanguage: patch.nextLanguage,
        nextLanguage: patch.prevLanguage,
      };

    case "speaker_change":
      return {
        kind: "speaker_change",
        index: patch.index,
        prevSpeaker: patch.nextSpeaker,
        nextSpeaker: patch.prevSpeaker,
      };

    case "insert_segment":
      return { kind: "delete_segment", index: patch.index, segment: { ...patch.segment } };

    case "delete_segment":
      return { kind: "insert_segment", index: patch.index, segment: { ...patch.segment } };
  }
}
