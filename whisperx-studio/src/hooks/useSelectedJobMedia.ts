import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isVideoFile } from "../appUtils";
import type { Job } from "../types";

export function useSelectedJobMedia(selectedJob: Job | null) {
  const selectedMediaSrc = useMemo(
    () => (selectedJob ? convertFileSrc(selectedJob.inputPath) : ""),
    [selectedJob],
  );
  const selectedIsVideo = useMemo(
    () => (selectedJob ? isVideoFile(selectedJob.inputPath) : false),
    [selectedJob],
  );
  return { selectedMediaSrc, selectedIsVideo };
}
