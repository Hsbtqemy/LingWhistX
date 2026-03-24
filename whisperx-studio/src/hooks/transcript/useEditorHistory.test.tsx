/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { buildEditorSnapshot, cloneEditorSnapshot } from "../../appUtils";
import type { EditableSegment } from "../../types";
import { trimEditorHistoryStack, useEditorHistory } from "./useEditorHistory";

const seg = (text: string): EditableSegment => ({ start: 0, end: 1, text });

describe("trimEditorHistoryStack", () => {
  it("ne tronque pas si la pile est plus courte que la limite", () => {
    const s = buildEditorSnapshot("fr", [seg("a")]);
    expect(trimEditorHistoryStack([s], 5)).toHaveLength(1);
  });

  it("conserve les snapshots les plus récents", () => {
    const s1 = buildEditorSnapshot("fr", [seg("1")]);
    const s2 = buildEditorSnapshot("fr", [seg("2")]);
    const s3 = buildEditorSnapshot("fr", [seg("3")]);
    const trimmed = trimEditorHistoryStack([s1, s2, s3], 2);
    expect(trimmed).toHaveLength(2);
    expect(trimmed[0].segments[0]?.text).toBe("2");
    expect(trimmed[1].segments[0]?.text).toBe("3");
  });
});

describe("useEditorHistory", () => {
  it("enregistre undo sur mutation puis restaure au undo", () => {
    const { result } = renderHook(() => {
      const currentRef = useRef(buildEditorSnapshot("fr", [seg("a")]));
      const history = useEditorHistory({
        getCurrentSnapshot: () => currentRef.current,
        applySnapshot: (s) => {
          currentRef.current = cloneEditorSnapshot(s);
        },
      });
      return { history, currentRef };
    });

    expect(result.current.history.canUndoEditor).toBe(false);

    act(() => {
      result.current.history.applyEditorSnapshotMutation((cur) =>
        buildEditorSnapshot(cur.language, [seg("b")]),
      );
    });

    expect(result.current.currentRef.current.segments[0]?.text).toBe("b");
    expect(result.current.history.canUndoEditor).toBe(true);

    act(() => {
      result.current.history.undoEditorChange();
    });

    expect(result.current.currentRef.current.segments[0]?.text).toBe("a");
    expect(result.current.history.canRedoEditor).toBe(true);
  });
});
