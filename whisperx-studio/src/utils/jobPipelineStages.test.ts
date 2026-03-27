import { describe, expect, it } from "vitest";
import type { Job, JobLogEvent } from "../types";
import {
  buildPipelineSteps,
  resolveActivePipelineStepId,
  resolveActiveStepIndex,
} from "./jobPipelineStages";

function baseJob(over: Partial<Job>): Job {
  return {
    id: "j1",
    inputPath: "/a.wav",
    outputDir: "/out",
    mode: "whisperx",
    status: "running",
    progress: 40,
    message: "Running",
    createdAtMs: 0,
    updatedAtMs: 0,
    outputFiles: [],
    ...over,
  };
}

describe("jobPipelineStages", () => {
  it("buildPipelineSteps respecte noAlign et diarize", () => {
    const withAll = baseJob({
      whisperxOptions: {
        model: "small",
        language: "",
        device: "cpu",
        computeType: "float32",
        batchSize: 8,
        diarize: true,
        noAlign: false,
        printProgress: false,
        hfToken: "",
        vadMethod: "",
      },
    });
    const ids = buildPipelineSteps(withAll).map((s) => s.id);
    expect(ids[0]).toBe("runtime");
    expect(ids).toContain("align");
    expect(ids).toContain("diarize");

    const noAlign = baseJob({
      whisperxOptions: {
        ...withAll.whisperxOptions!,
        noAlign: true,
        diarize: false,
      },
    });
    const ids2 = buildPipelineSteps(noAlign).map((s) => s.id);
    expect(ids2).not.toContain("align");
    expect(ids2).not.toContain("diarize");
  });

  it("resolveActivePipelineStepId lit les stages wx_*", () => {
    const job = baseJob({ status: "running", progress: 50 });
    const logs: JobLogEvent[] = [
      {
        jobId: "j1",
        tsMs: 1,
        stream: "stdout",
        level: "info",
        stage: "wx_align",
        message: "Performing alignment...",
      },
    ];
    expect(resolveActivePipelineStepId(job, logs)).toBe("align");
  });

  it("resolveActivePipelineStepId en file pointe sur runtime", () => {
    const job = baseJob({ status: "queued", progress: 0 });
    expect(resolveActivePipelineStepId(job, [])).toBe("runtime");
  });

  it("resolveActiveStepIndex marque terminé quand job done", () => {
    const job = baseJob({ status: "done", progress: 100 });
    const steps = buildPipelineSteps(job);
    const r = resolveActiveStepIndex(job, steps, "finalize");
    expect(r.allComplete).toBe(true);
    expect(r.activeIndex).toBe(-1);
  });
});
