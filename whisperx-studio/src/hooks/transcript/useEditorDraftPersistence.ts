import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_DRAFT_AUTOSAVE_SEC,
  MAX_DRAFT_AUTOSAVE_SEC,
  MIN_DRAFT_AUTOSAVE_SEC,
} from "../../constants";
import { areEditorSnapshotsEqual, clampNumber, cloneEditorSnapshot } from "../../appUtils";
import type { EditorSnapshot, SaveDraftRequest, SaveDraftResponse } from "../../types";

export type UseEditorDraftPersistenceArgs = {
  editorSourcePath: string;
  editorDirty: boolean;
  getCurrentSnapshot: () => EditorSnapshot;
};

export function useEditorDraftPersistence({
  editorSourcePath,
  editorDirty,
  getCurrentSnapshot,
}: UseEditorDraftPersistenceArgs) {
  const [draftAutosaveSecInput, setDraftAutosaveSecInput] = useState(
    String(DEFAULT_DRAFT_AUTOSAVE_SEC),
  );
  const [editorDraftPath, setEditorDraftPath] = useState("");
  const [editorDraftUpdatedAtMs, setEditorDraftUpdatedAtMs] = useState<number | null>(null);
  const [editorAutosaveMessage, setEditorAutosaveMessage] = useState("");
  const [editorAutosaveError, setEditorAutosaveError] = useState("");
  const [isAutosavingDraft, setIsAutosavingDraft] = useState(false);

  const lastAutosavedSnapshotRef = useRef<EditorSnapshot | null>(null);
  const autosaveInFlightRef = useRef(false);
  const autosaveEditorDraftRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false);

  const draftAutosaveSec = useMemo(() => {
    const parsed = Number(draftAutosaveSecInput);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_DRAFT_AUTOSAVE_SEC;
    }
    return clampNumber(Math.floor(parsed), MIN_DRAFT_AUTOSAVE_SEC, MAX_DRAFT_AUTOSAVE_SEC);
  }, [draftAutosaveSecInput]);

  async function autosaveEditorDraft(force = false): Promise<boolean> {
    if (!editorSourcePath) {
      return false;
    }
    if (autosaveInFlightRef.current) {
      return false;
    }

    const snapshot = getCurrentSnapshot();
    if (!force && !editorDirty) {
      return false;
    }

    const lastSaved = lastAutosavedSnapshotRef.current;
    if (!force && lastSaved && areEditorSnapshotsEqual(snapshot, lastSaved)) {
      return false;
    }

    autosaveInFlightRef.current = true;
    setIsAutosavingDraft(true);
    try {
      const response = await invoke<SaveDraftResponse>("save_transcript_draft", {
        request: {
          path: editorSourcePath,
          language: snapshot.language.trim() || null,
          segments: snapshot.segments,
        } as SaveDraftRequest,
      });
      lastAutosavedSnapshotRef.current = cloneEditorSnapshot(snapshot);
      setEditorDraftPath(response.draftPath);
      setEditorDraftUpdatedAtMs(response.updatedAtMs);
      setEditorAutosaveError("");
      setEditorAutosaveMessage(
        `Brouillon autosauve: ${new Date(response.updatedAtMs).toLocaleString()}`,
      );
      return true;
    } catch (e) {
      setEditorAutosaveError(String(e));
      return false;
    } finally {
      autosaveInFlightRef.current = false;
      setIsAutosavingDraft(false);
    }
  }

  autosaveEditorDraftRef.current = autosaveEditorDraft;

  async function purgeTranscriptDraft(manual: boolean) {
    if (!editorSourcePath) {
      return;
    }
    try {
      const deleted = await invoke<boolean>("delete_transcript_draft", {
        path: editorSourcePath,
      });
      if (deleted) {
        setEditorDraftPath("");
        setEditorDraftUpdatedAtMs(null);
        setEditorAutosaveError("");
        setEditorAutosaveMessage(manual ? "Brouillon purge." : "");
        lastAutosavedSnapshotRef.current = manual ? cloneEditorSnapshot(getCurrentSnapshot()) : null;
      } else if (manual) {
        setEditorAutosaveMessage("Aucun brouillon a purger.");
        lastAutosavedSnapshotRef.current = cloneEditorSnapshot(getCurrentSnapshot());
      }
    } catch (e) {
      setEditorAutosaveError(String(e));
    }
  }

  function clearDraftAutosaveUi() {
    setEditorAutosaveError("");
    setEditorAutosaveMessage("");
  }

  function resetDraftAfterSuccessfulJsonSave() {
    lastAutosavedSnapshotRef.current = null;
    setEditorDraftPath("");
    setEditorDraftUpdatedAtMs(null);
    setEditorAutosaveError("");
    setEditorAutosaveMessage("");
  }

  function resetDraftMetaOnLoadError() {
    lastAutosavedSnapshotRef.current = null;
    setEditorDraftPath("");
    setEditorDraftUpdatedAtMs(null);
  }

  function markDraftLoadedFromDisk(draftPath: string, updatedAtMs: number, snapshot: EditorSnapshot) {
    setEditorDraftPath(draftPath);
    setEditorDraftUpdatedAtMs(updatedAtMs);
    lastAutosavedSnapshotRef.current = cloneEditorSnapshot(snapshot);
  }

  function clearDraftBecauseNoDraftFileOnDisk() {
    setEditorDraftPath("");
    setEditorDraftUpdatedAtMs(null);
    lastAutosavedSnapshotRef.current = null;
  }

  useEffect(() => {
    if (!editorSourcePath) {
      return;
    }
    const intervalMs = draftAutosaveSec * 1000;
    const timer = window.setInterval(() => {
      void autosaveEditorDraftRef.current(false);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [editorSourcePath, draftAutosaveSec]);

  return {
    draftAutosaveSecInput,
    setDraftAutosaveSecInput,
    draftAutosaveSec,
    editorDraftPath,
    editorDraftUpdatedAtMs,
    editorAutosaveMessage,
    editorAutosaveError,
    isAutosavingDraft,
    lastAutosavedSnapshotRef,
    autosaveEditorDraft,
    purgeTranscriptDraft,
    clearDraftAutosaveUi,
    resetDraftAfterSuccessfulJsonSave,
    resetDraftMetaOnLoadError,
    markDraftLoadedFromDisk,
    clearDraftBecauseNoDraftFileOnDisk,
  };
}
