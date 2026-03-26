import { describe, expect, it } from "vitest";
import { resolveDroppedFilePathFromDragEvent } from "./droppedFilePath";

function fileListFrom(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (i: number) => files[i] ?? null,
  } as FileList;
}

function mockDragEvent(dt: {
  files: FileList;
  getData: (type: string) => string;
}): DragEvent {
  return { dataTransfer: dt as unknown as DataTransfer } as DragEvent;
}

describe("resolveDroppedFilePathFromDragEvent", () => {
  it("priorise File.path (Tauri / WebView)", () => {
    const file = { path: "/media/x.wav" } as unknown as File;
    const ev = mockDragEvent({
      files: fileListFrom([file]),
      getData: () => "",
    });
    expect(resolveDroppedFilePathFromDragEvent(ev)).toBe("/media/x.wav");
  });

  it("utilise text/uri-list (file://) si pas de path", () => {
    const file = new File([], "x.wav");
    const ev = mockDragEvent({
      files: fileListFrom([file]),
      getData: (type: string) => (type === "text/uri-list" ? "file:///Users/a/b.wav\n" : ""),
    });
    expect(resolveDroppedFilePathFromDragEvent(ev)).toBe("/Users/a/b.wav");
  });

  it("normalise file:///C:/… sous Windows", () => {
    const ev = mockDragEvent({
      files: fileListFrom([]),
      getData: (type: string) => (type === "text/uri-list" ? "file:///C:/foo/bar.wav" : ""),
    });
    expect(resolveDroppedFilePathFromDragEvent(ev)).toBe("C:/foo/bar.wav");
  });

  it("retourne null si aucune source", () => {
    const ev = mockDragEvent({
      files: fileListFrom([]),
      getData: () => "",
    });
    expect(resolveDroppedFilePathFromDragEvent(ev)).toBeNull();
  });
});
