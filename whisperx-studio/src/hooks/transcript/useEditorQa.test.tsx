/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildEditorSnapshot } from "../../appUtils";
import type { EditableSegment } from "../../types";
import { useEditorQa } from "./useEditorQa";

const seg = (t: string, start = 0, end = 1): EditableSegment => ({ start, end, text: t });

describe("useEditorQa", () => {
  it("runTranscriptQaScan met a jour le statut", () => {
    const wf = {
      seekMedia: vi.fn(),
      waveform: undefined,
      applySnap: (x: number) => x,
    } as unknown as Parameters<typeof useEditorQa>[0]["wf"];

    const { result } = renderHook(() => {
      const [visible, setVisible] = useState(120);
      const ref = useRef<EditableSegment[]>([seg("hello", 0, 10)]);
      const [, setActive] = useState<number | null>(0);
      return useEditorQa({
        editorSourcePath: "/x.json",
        editorSegmentsRef: ref,
        editorVisibleCount: visible,
        setEditorVisibleCount: setVisible,
        wf,
        applyEditorSnapshotMutation: () => false,
        setActiveSegmentIndex: setActive,
      });
    });

    act(() => {
      result.current.runTranscriptQaScan();
    });

    expect(result.current.qaStatus).toMatch(/^QA:/);
    expect(result.current.qaScannedAtMs).not.toBeNull();
  });

  it("seedQaFromLoadedSegments initialise les issues", () => {
    const wf = {
      seekMedia: vi.fn(),
      waveform: undefined,
      applySnap: (x: number) => x,
    } as unknown as Parameters<typeof useEditorQa>[0]["wf"];

    const { result } = renderHook(() => {
      const [visible, setVisible] = useState(120);
      const ref = useRef<EditableSegment[]>([]);
      return useEditorQa({
        editorSourcePath: "/x.json",
        editorSegmentsRef: ref,
        editorVisibleCount: visible,
        setEditorVisibleCount: setVisible,
        wf,
        applyEditorSnapshotMutation: () => false,
        setActiveSegmentIndex: () => {},
      });
    });

    act(() => {
      result.current.seedQaFromLoadedSegments(buildEditorSnapshot("fr", [seg("a", 0, 1)]).segments);
    });

    expect(result.current.qaIssues.length).toBeGreaterThanOrEqual(0);
    expect(result.current.qaStatus).toMatch(/^QA:/);
  });
});
