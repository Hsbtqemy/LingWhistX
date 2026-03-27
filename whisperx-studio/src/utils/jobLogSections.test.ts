import { describe, expect, it } from "vitest";
import type { Job, JobLogEvent } from "../types";
import {
  groupJobLogsIntoSections,
  inferSectionFromMessage,
  stageToSectionId,
} from "./jobLogSections";

const baseJob = { mode: "whisperx" } as Job;

describe("stageToSectionId", () => {
  it("mappe les stages wx_*", () => {
    expect(stageToSectionId("wx_prep")).toBe("prep");
    expect(stageToSectionId("wx_transcribe")).toBe("transcribe");
    expect(stageToSectionId("wx_align")).toBe("align");
    expect(stageToSectionId("wx_diarize")).toBe("diarize");
    expect(stageToSectionId("wx_finalize")).toBe("finalize");
  });
});

describe("inferSectionFromMessage", () => {
  it("aligne les motifs sur le worker Python", () => {
    expect(inferSectionFromMessage('Failed to align segment ("x"): no')).toBe("align");
    expect(inferSectionFromMessage("Loading diarization model: pyannote/x")).toBe("diarize");
    expect(inferSectionFromMessage("Using model: pyannote/foo")).toBe("diarize");
    expect(inferSectionFromMessage("Using media chunking: duration=10s")).toBe("transcribe");
    expect(inferSectionFromMessage("Analyze-only completed. Artifacts written")).toBe("analyze");
  });
});

describe("groupJobLogsIntoSections", () => {
  it("regroupe par changement de section (ordre chrono)", () => {
    const logs: JobLogEvent[] = [
      {
        jobId: "j1",
        tsMs: 1,
        stream: "stdout",
        level: "info",
        stage: "wx_prep",
        message: "Commande",
      },
      {
        jobId: "j1",
        tsMs: 2,
        stream: "stdout",
        level: "info",
        stage: "wx_transcribe",
        message: "Performing transcription...",
      },
      {
        jobId: "j1",
        tsMs: 3,
        stream: "stdout",
        level: "info",
        stage: "wx_transcribe",
        message: "Progress: 10%",
      },
      {
        jobId: "j1",
        tsMs: 4,
        stream: "stdout",
        level: "info",
        stage: "wx_diarize",
        message: "Performing diarization...",
      },
    ];
    const groups = groupJobLogsIntoSections(logs, baseJob);
    expect(groups.map((g) => g.id)).toEqual(["prep", "transcribe", "diarize"]);
    expect(groups[1].logs).toHaveLength(2);
  });

  it("infère la section depuis le message si stage = other", () => {
    const logs: JobLogEvent[] = [
      {
        jobId: "j1",
        tsMs: 1,
        stream: "stdout",
        level: "info",
        stage: null,
        message: "Performing alignment",
      },
    ];
    const groups = groupJobLogsIntoSections(logs, baseJob);
    expect(groups[0]?.id).toBe("align");
  });
});
