import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_EDITOR_HISTORY_LIMIT,
  MAX_EDITOR_HISTORY_LIMIT,
  MIN_EDITOR_HISTORY_LIMIT,
} from "../../constants";
import { areEditorSnapshotsEqual, clampNumber, cloneEditorSnapshot } from "../../appUtils";
import type { EditorSnapshot } from "../../types";

export function trimEditorHistoryStack(stack: EditorSnapshot[], limit: number): EditorSnapshot[] {
  if (stack.length <= limit) {
    return stack;
  }
  return stack.slice(stack.length - limit);
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
  const [editorUndoStack, setEditorUndoStack] = useState<EditorSnapshot[]>([]);
  const [editorRedoStack, setEditorRedoStack] = useState<EditorSnapshot[]>([]);
  const editorUndoStackRef = useRef<EditorSnapshot[]>([]);
  const editorRedoStackRef = useRef<EditorSnapshot[]>([]);
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

  function setHistoryStacks(nextUndo: EditorSnapshot[], nextRedo: EditorSnapshot[]) {
    editorUndoStackRef.current = nextUndo;
    editorRedoStackRef.current = nextRedo;
    setEditorUndoStack(nextUndo);
    setEditorRedoStack(nextRedo);
  }

  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    const nextUndo = trimEditorHistoryStack(
      [...editorUndoStackRef.current, cloneEditorSnapshot(snapshot)],
      editorHistoryLimit,
    );
    setHistoryStacks(nextUndo, []);
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
      const nextUndo = trimEditorHistoryStack(
        [...editorUndoStackRef.current, cloneEditorSnapshot(currentSnapshot)],
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
    const previous = undoStack.pop();
    if (!previous) {
      return;
    }
    const current = getCurrentSnapshot();
    const nextRedo = trimEditorHistoryStack(
      [...editorRedoStackRef.current, current],
      editorHistoryLimit,
    );
    setHistoryStacks(undoStack, nextRedo);
    applySnapshot(previous);
    onUndoRedo?.("undo");
  }

  function redoEditorChange() {
    if (editorRedoStackRef.current.length === 0) {
      return;
    }
    const redoStack = [...editorRedoStackRef.current];
    const next = redoStack.pop();
    if (!next) {
      return;
    }
    const current = getCurrentSnapshot();
    const nextUndo = trimEditorHistoryStack(
      [...editorUndoStackRef.current, current],
      editorHistoryLimit,
    );
    setHistoryStacks(nextUndo, redoStack);
    applySnapshot(next);
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
    pushUndoSnapshot,
    undoEditorChange,
    redoEditorChange,
    canUndoEditor,
    canRedoEditor,
  };
}
