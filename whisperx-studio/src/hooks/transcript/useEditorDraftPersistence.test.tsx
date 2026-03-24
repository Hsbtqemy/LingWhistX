/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { MAX_DRAFT_AUTOSAVE_SEC, MIN_DRAFT_AUTOSAVE_SEC } from "../../constants";
import { buildEditorSnapshot } from "../../appUtils";
import type { EditableSegment } from "../../types";
import { useEditorDraftPersistence } from "./useEditorDraftPersistence";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const seg = (text: string): EditableSegment => ({ start: 0, end: 1, text });

describe("useEditorDraftPersistence", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("draftAutosaveSec borne MIN/MAX", () => {
    const { result, rerender } = renderHook(
      ({ dirty, path }) => {
        const snapRef = useRef(buildEditorSnapshot("fr", [seg("a")]));
        const draft = useEditorDraftPersistence({
          editorSourcePath: path,
          editorDirty: dirty,
          getCurrentSnapshot: () => snapRef.current,
        });
        return draft;
      },
      { initialProps: { dirty: false, path: "" } },
    );
    expect(result.current.draftAutosaveSec).toBeGreaterThanOrEqual(MIN_DRAFT_AUTOSAVE_SEC);

    act(() => {
      result.current.setDraftAutosaveSecInput("9999");
    });
    rerender({ dirty: false, path: "" });
    expect(result.current.draftAutosaveSec).toBe(MAX_DRAFT_AUTOSAVE_SEC);

    act(() => {
      result.current.setDraftAutosaveSecInput("1");
    });
    rerender({ dirty: false, path: "" });
    expect(result.current.draftAutosaveSec).toBe(MIN_DRAFT_AUTOSAVE_SEC);
  });

  it("autosave appelle save_transcript_draft quand dirty et chemin source", async () => {
    vi.mocked(invoke).mockResolvedValue({
      draftPath: "/tmp/draft.json",
      updatedAtMs: 1_700_000_000_000,
    });

    const { result } = renderHook(() => {
      const snapRef = useRef(buildEditorSnapshot("fr", [seg("x")]));
      return useEditorDraftPersistence({
        editorSourcePath: "/src/t.json",
        editorDirty: true,
        getCurrentSnapshot: () => snapRef.current,
      });
    });

    await act(async () => {
      const ok = await result.current.autosaveEditorDraft(false);
      expect(ok).toBe(true);
    });

    expect(vi.mocked(invoke).mock.calls[0]?.[0]).toBe("save_transcript_draft");
  });
});
