import type { MouseEvent } from "react";
import { describe, expect, it } from "vitest";
import type { EditableSegment } from "../../types";
import { hitTestFocusedSegmentEdge, secondsFromWaveformPointer } from "./waveformPointer";

function canvasEvent(clientX: number, rectLeft: number, rectWidth: number) {
  return {
    clientX,
    currentTarget: {
      getBoundingClientRect: () => ({
        left: rectLeft,
        width: rectWidth,
        top: 0,
        height: 40,
        right: rectLeft + rectWidth,
        bottom: 40,
        x: rectLeft,
        y: 0,
        toJSON: () => ({}),
      }),
    },
  } as unknown as MouseEvent<HTMLCanvasElement>;
}

describe("secondsFromWaveformPointer", () => {
  it("mappe le clic au temps avec snap et clamp", () => {
    const ctx = {
      waveform: { durationSec: 10 },
      waveformVisibleDurationSec: 10,
      waveformViewStartSec: 0,
      applySnap: (s: number) => Math.round(s * 10) / 10,
    };
    const ev = canvasEvent(50, 0, 100);
    const sec = secondsFromWaveformPointer(ctx, ev);
    expect(sec).toBe(5);
  });

  it("retourne null si pas de waveform", () => {
    const ctx = {
      waveform: null,
      waveformVisibleDurationSec: 10,
      waveformViewStartSec: 0,
      applySnap: (s: number) => s,
    };
    const ev = canvasEvent(0, 0, 100);
    expect(secondsFromWaveformPointer(ctx, ev)).toBeNull();
  });
});

describe("hitTestFocusedSegmentEdge", () => {
  const segments: EditableSegment[] = [
    { start: 1, end: 3, text: "a" },
    { start: 5, end: 7, text: "b" },
  ];

  it("detecte le bord start", () => {
    const ctx = {
      waveform: { durationSec: 10 },
      waveformVisibleDurationSec: 10,
      waveformViewStartSec: 0,
      applySnap: (s: number) => s,
    };
    const ev = canvasEvent(10, 0, 100);
    const edge = hitTestFocusedSegmentEdge(ctx, segments, 0, ev);
    expect(edge).toBe("start");
  });

  it("retourne null hors zone de bord", () => {
    const ctx = {
      waveform: { durationSec: 10 },
      waveformVisibleDurationSec: 10,
      waveformViewStartSec: 0,
      applySnap: (s: number) => s,
    };
    const ev = canvasEvent(50, 0, 100);
    const edge = hitTestFocusedSegmentEdge(ctx, segments, 0, ev);
    expect(edge).toBeNull();
  });
});
