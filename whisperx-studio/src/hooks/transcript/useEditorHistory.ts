import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_EDITOR_HISTORY_LIMIT,
  MAX_EDITOR_HISTORY_LIMIT,
  MIN_EDITOR_HISTORY_LIMIT,
} from "../../constants";
import { areEditorSnapshotsEqual, clampNumber, cloneEditorSnapshot } from "../../appUtils";
import type { EditorSnapshot, HistoryEntry, SegmentPatch } from "../../types";
import { applyPatch, invertPatch } from "./editorPatches";

export function trimEditorHistoryStack<T>(stack: T[], limit: number): T[] {
  if (stack.length <= limit) {
    return stack;
  }
  return stack.slice(stack.length - limit);
}

/**
 * Applique une `HistoryEntry` à un snapshot.
 * - Patch → `applyPatch` (économique en mémoire et CPU).
 * - Snapshot → retourne directement le snapshot stocké.
 */
function applyHistoryEntry(snapshot: EditorSnapshot, entry: HistoryEntry): EditorSnapshot {
  if (entry.kind === "patch") {
    return applyPatch(snapshot, entry.patch);
  }
  return cloneEditorSnapshot(entry.snapshot);
}

/**
 * Construit l'entrée inverse d'une `HistoryEntry` (pour alimenter la pile opposée).
 * - Patch → `invertPatch` (pas de snapshot nécessaire).
 * - Snapshot → on capture l'état courant (snapshot complet, comportement legacy).
 */
function invertHistoryEntry(entry: HistoryEntry, currentSnapshot: EditorSnapshot): HistoryEntry {
  if (entry.kind === "patch") {
    return { kind: "patch", patch: invertPatch(entry.patch) };
  }
  return { kind: "snapshot", snapshot: cloneEditorSnapshot(currentSnapshot) };
}

export type UseEditorHistoryArgs = {
  getCurrentSnapshot: () => EditorSnapshot;
  applySnapshot: (snapshot: EditorSnapshot) => void;
  onUndoRedo?: (kind: "undo" | "redo") => void;
};

export function useEditorHistory({
  getCurrentSnapshot,
  applySnapshot,
  onUndoRedo,
}: UseEditorHistoryArgs) {
  // WX-658 : stacks stockent des HistoryEntry (patch ou snapshot) au lieu de snapshots complets.
  const [editorUndoStack, setEditorUndoStack] = useState<HistoryEntry[]>([]);
  const [editorRedoStack, setEditorRedoStack] = useState<HistoryEntry[]>([]);
  const editorUndoStackRef = useRef<HistoryEntry[]>([]);
  const editorRedoStackRef = useRef<HistoryEntry[]>([]);
  const [editorHistoryLimitInput, setEditorHistoryLimitInput] = useState(
    String(DEFAULT_EDITOR_HISTORY_LIMIT),
  );

  const editorHistoryLimit = useMemo(() => {
    const parsed = Number(editorHistoryLimitInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_EDITOR_HISTORY_LIMIT;
    }
    return clampNumber(Math.floor(parsed), MIN_EDITOR_HISTORY_LIMIT, MAX_EDITOR_HISTORY_LIMIT);
  }, [editorHistoryLimitInput]);

  function setHistoryStacks(nextUndo: HistoryEntry[], nextRedo: HistoryEntry[]) {
    editorUndoStackRef.current = nextUndo;
    editorRedoStackRef.current = nextRedo;
    setEditorUndoStack(nextUndo);
    setEditorRedoStack(nextRedo);
  }

  /** Pousse un snapshot complet (legacy / opérations complexes non patchables). */
  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    const entry: HistoryEntry = { kind: "snapshot", snapshot: cloneEditorSnapshot(snapshot) };
    const nextUndo = trimEditorHistoryStack(
      [...editorUndoStackRef.current, entry],
      editorHistoryLimit,
    );
    setHistoryStacks(nextUndo, []);
  }

  /**
   * WX-658 — applique un patch forward, enregistre `invertPatch(patch)` dans l'undo stack.
   * Retourne `false` si le patch n'a pas modifié le document.
   */
  function applyEditorPatch(patch: SegmentPatch): boolean {
    const currentSnapshot = getCurrentSnapshot();
    const nextSnapshot = applyPatch(currentSnapshot, patch);
    if (areEditorSnapshotsEqual(currentSnapshot, nextSnapshot)) {
      return false;
    }
    const undoEntry: HistoryEntry = { kind: "patch", patch: invertPatch(patch) };
    const nextUndo = trimEditorHistoryStack(
      [...editorUndoStackRef.current, undoEntry],
      editorHistoryLimit,
    );
    setHistoryStacks(nextUndo, []);
    applySnapshot(nextSnapshot);
    return true;
  }

  function applyEditorSnapshotMutation(
    mutator: (current: EditorSnapshot) => EditorSnapshot,
    options?: { recordHistory?: boolean; clearRedo?: boolean },
  ): boolean {
    const recordHistory = options?.recordHistory ?? true;
    const clearRedo = options?.clearRedo ?? true;
    const currentSnapshot = getCurrentSnapshot();
    const candidateSnapshot = cloneEditorSnapshot(mutator(currentSnapshot));
    if (areEditorSnapshotsEqual(currentSnapshot, candidateSnapshot)) {
      return false;
    }

    if (recordHistory) {
      const entry: HistoryEntry = {
        kind: "snapshot",
        snapshot: cloneEditorSnapshot(currentSnapshot),
      };
      const nextUndo = trimEditorHistoryStack(
        [...editorUndoStackRef.current, entry],
        editorHistoryLimit,
      );
      setHistoryStacks(nextUndo, []);
    } else if (clearRedo) {
      setHistoryStacks(editorUndoStackRef.current, []);
    }

    applySnapshot(candidateSnapshot);
    return true;
  }

  function undoEditorChange() {
    if (editorUndoStackRef.current.length === 0) {
      return;
    }
    const undoStack = [...editorUndoStackRef.current];
    const undoEntry = undoStack.pop();
    if (!undoEntry) {
      return;
    }
    const current = getCurrentSnapshot();
    // L'entrée redo est l'inverse de l'undo (pour pouvoir ré-appliquer).
    const redoEntry = invertHistoryEntry(undoEntry, current);
    const nextRedo = trimEditorHistoryStack(
      [...editorRedoStackRef.current, redoEntry],
      editorHistoryLimit,
    );
    setHistoryStacks(undoStack, nextRedo);
    applySnapshot(applyHistoryEntry(current, undoEntry));
    onUndoRedo?.("undo");
  }

  function redoEditorChange() {
    if (editorRedoStackRef.current.length === 0) {
      return;
    }
    const redoStack = [...editorRedoStackRef.current];
    const redoEntry = redoStack.pop();
    if (!redoEntry) {
      return;
    }
    const current = getCurrentSnapshot();
    const undoEntry = invertHistoryEntry(redoEntry, current);
    const nextUndo = trimEditorHistoryStack(
      [...editorUndoStackRef.current, undoEntry],
      editorHistoryLimit,
    );
    setHistoryStacks(nextUndo, redoStack);
    applySnapshot(applyHistoryEntry(current, redoEntry));
    onUndoRedo?.("redo");
  }

  useEffect(() => {
    const trimmedUndo = trimEditorHistoryStack(editorUndoStackRef.current, editorHistoryLimit);
    const trimmedRedo = trimEditorHistoryStack(editorRedoStackRef.current, editorHistoryLimit);
    if (
      trimmedUndo.length !== editorUndoStackRef.current.length ||
      trimmedRedo.length !== editorRedoStackRef.current.length
    ) {
      setHistoryStacks(trimmedUndo, trimmedRedo);
    }
  }, [editorHistoryLimit]);

  const canUndoEditor = editorUndoStack.length > 0;
  const canRedoEditor = editorRedoStack.length > 0;

  return {
    editorUndoStack,
    editorRedoStack,
    editorHistoryLimitInput,
    setEditorHistoryLimitInput,
    editorHistoryLimit,
    setHistoryStacks,
    applyEditorSnapshotMutation,
    applyEditorPatch,
    pushUndoSnapshot,
    undoEditorChange,
    redoEditorChange,
    canUndoEditor,
    canRedoEditor,
  };
}
