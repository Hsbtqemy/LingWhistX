import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import "./App.css";

type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

type WhisperxOptions = {
  model?: string;
  language?: string;
  device?: string;
  computeType?: string;
  batchSize?: number;
  diarize?: boolean;
  hfToken?: string;
  outputFormat?: string;
  noAlign?: boolean;
  vadMethod?: string;
  printProgress?: boolean;
};

type UiWhisperxOptions = {
  model: string;
  language: string;
  device: "auto" | "cpu" | "cuda";
  computeType: "default" | "float16" | "float32" | "int8";
  batchSize: string;
  diarize: boolean;
  hfToken: string;
  outputFormat: "all" | "json" | "srt" | "vtt" | "txt" | "tsv" | "aud";
  noAlign: boolean;
  vadMethod: "pyannote" | "silero";
  printProgress: boolean;
};

type Job = {
  id: string;
  inputPath: string;
  outputDir: string;
  mode: "mock" | "whisperx" | string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAtMs: number;
  updatedAtMs: number;
  error?: string | null;
  outputFiles: string[];
  whisperxOptions?: WhisperxOptions | null;
};

type JobLogEvent = {
  jobId: string;
  tsMs: number;
  stream: string;
  level: string;
  stage?: string | null;
  message: string;
};

type RuntimeStatus = {
  pythonCommand: string;
  pythonOk: boolean;
  whisperxOk: boolean;
  ffmpegOk: boolean;
  whisperxVersion?: string | null;
  details: string[];
};

type RuntimeSetupStatus = {
  running: boolean;
};

type RuntimeSetupLogEvent = {
  tsMs: number;
  stream: string;
  message: string;
};

type RuntimeSetupFinishedEvent = {
  success: boolean;
  message: string;
};

type WaveformPeaks = {
  sourcePath: string;
  durationSec: number;
  binsPerSecond: number;
  sampleRate: number;
  peaks: number[];
  generatedAtMs: number;
  cached: boolean;
};

type ExportTimingRules = {
  minDurationSec: number;
  minGapSec: number;
  fixOverlaps: boolean;
};

type ExportCorrectionReport = {
  inputSegments: number;
  outputSegments: number;
  minDurationSec: number;
  minGapSec: number;
  fixOverlaps: boolean;
  reorderedSegments: boolean;
  overlapsFixed: number;
  minGapAdjustments: number;
  minDurationAdjustments: number;
  totalAdjustments: number;
  notes: string[];
};

type ExportTranscriptResponse = {
  outputPath: string;
  report: ExportCorrectionReport;
};

type SegmentEdge = "start" | "end";

type SegmentDragState = {
  segmentIndex: number;
  edge: SegmentEdge;
};

type EditableSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
};

type TranscriptDocument = {
  path: string;
  language?: string | null;
  segments: EditableSegment[];
};

type CreateJobRequest = {
  inputPath: string;
  outputDir?: string | null;
  mode?: "mock" | "whisperx";
  whisperxOptions?: WhisperxOptions;
};

type ProfilePreset = {
  id: string;
  label: string;
  description: string;
  options: UiWhisperxOptions;
};

const defaultWhisperxOptions: UiWhisperxOptions = {
  model: "small",
  language: "",
  device: "auto",
  computeType: "default",
  batchSize: "8",
  diarize: false,
  hfToken: "",
  outputFormat: "all",
  noAlign: false,
  vadMethod: "pyannote",
  printProgress: false,
};

const profilePresets: ProfilePreset[] = [
  {
    id: "balanced",
    label: "Equilibre (recommande)",
    description: "Bon compromis vitesse/qualite pour la plupart des fichiers audio.",
    options: { ...defaultWhisperxOptions, model: "small", batchSize: "8", device: "auto" },
  },
  {
    id: "cpu_fast",
    label: "CPU rapide",
    description: "Pour machines sans GPU, priorite a la vitesse et a la stabilite.",
    options: {
      ...defaultWhisperxOptions,
      model: "base",
      device: "cpu",
      computeType: "int8",
      batchSize: "4",
      vadMethod: "silero",
    },
  },
  {
    id: "quality_gpu",
    label: "Qualite GPU",
    description: "Optimise precision (GPU requis, plus lent et plus gourmand).",
    options: {
      ...defaultWhisperxOptions,
      model: "large-v3",
      device: "cuda",
      computeType: "float16",
      batchSize: "8",
    },
  },
  {
    id: "meeting_diarize",
    label: "Reunion + speakers",
    description: "Active diarization, utile pour reunions/interviews multi-intervenants.",
    options: {
      ...defaultWhisperxOptions,
      model: "small",
      diarize: true,
      vadMethod: "pyannote",
      outputFormat: "all",
    },
  },
];

const MIN_SEGMENT_DURATION_SEC = 0.02;

const defaultExportRules: ExportTimingRules = {
  minDurationSec: 0.02,
  minGapSec: 0,
  fixOverlaps: true,
};

function formatTimestamp(ms: number): string {
  if (!ms) {
    return "-";
  }
  return new Date(ms).toLocaleString();
}

function upsertJobInList(current: Job[], incoming: Job): Job[] {
  const next = [...current];
  const index = next.findIndex((job) => job.id === incoming.id);
  if (index >= 0) {
    next[index] = incoming;
  } else {
    next.push(incoming);
  }
  next.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return next;
}

function normalizeWhisperxOptions(source: UiWhisperxOptions): WhisperxOptions {
  const batchSize = Number(source.batchSize);
  return {
    model: source.model.trim() || undefined,
    language: source.language.trim() || undefined,
    device: source.device === "auto" ? undefined : source.device,
    computeType: source.computeType,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : undefined,
    diarize: source.diarize,
    hfToken: source.hfToken.trim() || undefined,
    outputFormat: source.outputFormat,
    noAlign: source.noAlign,
    vadMethod: source.vadMethod,
    printProgress: source.printProgress,
  };
}

function normalizeExportRules(source: ExportTimingRules): ExportTimingRules {
  const minDurationSec = Number.isFinite(source.minDurationSec)
    ? Math.min(10, Math.max(0.001, source.minDurationSec))
    : defaultExportRules.minDurationSec;
  const minGapSec = Number.isFinite(source.minGapSec)
    ? Math.min(10, Math.max(0, source.minGapSec))
    : defaultExportRules.minGapSec;
  return {
    minDurationSec: Math.round(minDurationSec * 1000) / 1000,
    minGapSec: Math.round(minGapSec * 1000) / 1000,
    fixOverlaps: source.fixOverlaps,
  };
}

function isPreviewableFile(path: string): boolean {
  const lower = path.toLowerCase();
  return [
    ".json",
    ".srt",
    ".vtt",
    ".txt",
    ".tsv",
    ".aud",
    ".log",
    ".md",
    ".csv",
  ].some((ext) => lower.endsWith(ext));
}

function isVideoFile(path: string): boolean {
  const lower = path.toLowerCase();
  return [".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v"].some((ext) => lower.endsWith(ext));
}

function formatClockSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00.000";
  }
  const totalMs = Math.round(seconds * 1000);
  const mins = Math.floor(totalMs / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function closestSegmentIndex(segments: EditableSegment[], timeSec: number): number | null {
  if (segments.length === 0) {
    return null;
  }
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    let distance = 0;
    if (timeSec < segment.start) {
      distance = segment.start - timeSec;
    } else if (timeSec > segment.end) {
      distance = timeSec - segment.end;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      if (distance === 0) {
        break;
      }
    }
  }
  return bestIndex;
}

function roundSecondsMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function splitSegmentText(text: string): [string, string] {
  const trimmed = text.trim();
  if (!trimmed) {
    return ["", ""];
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return [trimmed, ""];
  }
  const pivot = Math.ceil(words.length / 2);
  return [words.slice(0, pivot).join(" "), words.slice(pivot).join(" ")];
}

function joinSegmentTexts(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return `${a} ${b}`;
}

function isRuntimeReady(status: RuntimeStatus | null): boolean {
  if (!status) {
    return false;
  }
  return status.pythonOk && status.whisperxOk && status.ffmpegOk;
}

function App() {
  const [inputPath, setInputPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [mode, setMode] = useState<"mock" | "whisperx">("mock");
  const [whisperxOptions, setWhisperxOptions] = useState<UiWhisperxOptions>(defaultWhisperxOptions);
  const [selectedProfileId, setSelectedProfileId] = useState("balanced");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobLogs, setJobLogs] = useState<Record<string, JobLogEvent[]>>({});
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [runtimeSetupRunning, setRuntimeSetupRunning] = useState(false);
  const [runtimeSetupLogs, setRuntimeSetupLogs] = useState<RuntimeSetupLogEvent[]>([]);
  const [runtimeSetupMessage, setRuntimeSetupMessage] = useState("");
  const [waveform, setWaveform] = useState<WaveformPeaks | null>(null);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const [waveformError, setWaveformError] = useState("");
  const [waveformBinsPerSecond, setWaveformBinsPerSecond] = useState("50");
  const [waveformCursorSec, setWaveformCursorSec] = useState<number | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [hoveredSegmentEdge, setHoveredSegmentEdge] = useState<SegmentEdge | null>(null);
  const [dragSegmentState, setDragSegmentState] = useState<SegmentDragState | null>(null);
  const [mediaCurrentSec, setMediaCurrentSec] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string>("");
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewError, setPreviewError] = useState<string>("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [editorSourcePath, setEditorSourcePath] = useState<string>("");
  const [editorLanguage, setEditorLanguage] = useState<string>("");
  const [editorSegments, setEditorSegments] = useState<EditableSegment[]>([]);
  const [editorVisibleCount, setEditorVisibleCount] = useState<number>(120);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorStatus, setEditorStatus] = useState<string>("");
  const [editorError, setEditorError] = useState<string>("");
  const [editorLastOutputPath, setEditorLastOutputPath] = useState<string>("");
  const [exportRules, setExportRules] = useState<ExportTimingRules>(defaultExportRules);
  const [lastExportReport, setLastExportReport] = useState<ExportCorrectionReport | null>(null);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const selectedProfile = useMemo(
    () => profilePresets.find((preset) => preset.id === selectedProfileId),
    [selectedProfileId],
  );

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const selectedJobLogs = useMemo(() => {
    if (!selectedJob) {
      return [];
    }
    return jobLogs[selectedJob.id] ?? [];
  }, [selectedJob, jobLogs]);

  const selectedMediaSrc = useMemo(
    () => (selectedJob ? convertFileSrc(selectedJob.inputPath) : ""),
    [selectedJob],
  );

  const selectedIsVideo = useMemo(
    () => (selectedJob ? isVideoFile(selectedJob.inputPath) : false),
    [selectedJob],
  );

  const displayedEditorSegments = useMemo(
    () => editorSegments.slice(0, editorVisibleCount),
    [editorSegments, editorVisibleCount],
  );

  const hasMoreEditorSegments = editorSegments.length > editorVisibleCount;

  const runningJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running").length,
    [jobs],
  );

  const runtimeReady = useMemo(() => isRuntimeReady(runtimeStatus), [runtimeStatus]);

  const cursorTimeSec = waveformCursorSec ?? mediaCurrentSec;

  function getActiveMediaElement(): HTMLMediaElement | null {
    return selectedIsVideo ? videoRef.current : audioRef.current;
  }

  const nearestSegmentIndex = useMemo(
    () => closestSegmentIndex(editorSegments, cursorTimeSec),
    [cursorTimeSec, editorSegments],
  );

  const focusedSegmentIndex = useMemo(() => {
    if (activeSegmentIndex !== null && editorSegments[activeSegmentIndex]) {
      return activeSegmentIndex;
    }
    return nearestSegmentIndex;
  }, [activeSegmentIndex, editorSegments, nearestSegmentIndex]);

  const focusedSegment = useMemo(() => {
    if (focusedSegmentIndex === null) {
      return null;
    }
    const segment = editorSegments[focusedSegmentIndex];
    if (!segment) {
      return null;
    }
    let distance = 0;
    if (cursorTimeSec < segment.start) {
      distance = segment.start - cursorTimeSec;
    } else if (cursorTimeSec > segment.end) {
      distance = cursorTimeSec - segment.end;
    }
    return {
      index: focusedSegmentIndex,
      segment,
      distanceSec: distance,
    };
  }, [cursorTimeSec, editorSegments, focusedSegmentIndex]);

  const waveformCursorStyle = dragSegmentState
    ? "grabbing"
    : hoveredSegmentEdge
      ? "ew-resize"
      : "crosshair";

  const actionSegmentIndex = useMemo(() => {
    if (activeSegmentIndex !== null && editorSegments[activeSegmentIndex]) {
      return activeSegmentIndex;
    }
    return focusedSegmentIndex;
  }, [activeSegmentIndex, editorSegments, focusedSegmentIndex]);

  const canSplitActiveSegment = useMemo(() => {
    if (actionSegmentIndex === null) {
      return false;
    }
    const segment = editorSegments[actionSegmentIndex];
    if (!segment) {
      return false;
    }
    return segment.end - segment.start > MIN_SEGMENT_DURATION_SEC * 2;
  }, [actionSegmentIndex, editorSegments]);

  const canMergePrev = actionSegmentIndex !== null && actionSegmentIndex > 0;
  const canMergeNext =
    actionSegmentIndex !== null && actionSegmentIndex < editorSegments.length - 1;

  async function refreshJobs() {
    try {
      const nextJobs = await invoke<Job[]>("list_jobs");
      setJobs(nextJobs);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshRuntimeStatus() {
    setIsRuntimeLoading(true);
    try {
      const status = await invoke<RuntimeStatus>("get_runtime_status");
      setRuntimeStatus(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsRuntimeLoading(false);
    }
  }

  async function refreshRuntimeSetupStatus() {
    try {
      const status = await invoke<RuntimeSetupStatus>("get_runtime_setup_status");
      setRuntimeSetupRunning(status.running);
    } catch (e) {
      setError(String(e));
    }
  }

  async function startRuntimeSetup() {
    setError("");
    setRuntimeSetupMessage("");
    setRuntimeSetupLogs([]);
    try {
      await invoke("start_runtime_setup");
      setRuntimeSetupRunning(true);
    } catch (e) {
      setError(String(e));
    }
  }

  function seekMedia(seconds: number) {
    const clamped = Math.max(0, seconds);
    setWaveformCursorSec(clamped);
    setMediaCurrentSec(clamped);
    const media = getActiveMediaElement();
    if (media) {
      media.currentTime = clamped;
    }
  }

  function updateEditorSegmentBoundary(index: number, edge: SegmentEdge, rawSeconds: number) {
    setEditorSegments((current) => {
      const next = [...current];
      const segment = next[index];
      if (!segment) {
        return current;
      }

      const maxDuration = waveform?.durationSec && waveform.durationSec > 0
        ? waveform.durationSec
        : Number.POSITIVE_INFINITY;

      let start = segment.start;
      let end = segment.end;
      const clampedInput = Math.max(0, Number.isFinite(rawSeconds) ? rawSeconds : 0);

      if (edge === "start") {
        start = Math.min(clampedInput, end - MIN_SEGMENT_DURATION_SEC);
        if (start < 0) {
          start = 0;
        }
        if (start > maxDuration - MIN_SEGMENT_DURATION_SEC) {
          start = Math.max(0, maxDuration - MIN_SEGMENT_DURATION_SEC);
        }
      } else {
        end = Math.max(clampedInput, start + MIN_SEGMENT_DURATION_SEC);
        if (end > maxDuration) {
          end = maxDuration;
        }
      }

      if (end < start + MIN_SEGMENT_DURATION_SEC) {
        end = start + MIN_SEGMENT_DURATION_SEC;
      }
      start = Math.max(0, start);
      end = Math.max(start + MIN_SEGMENT_DURATION_SEC, end);

      next[index] = {
        ...segment,
        start: roundSecondsMs(start),
        end: roundSecondsMs(end),
      };
      return next;
    });
    setEditorDirty(true);
  }

  function secondsFromWaveformPointer(event: MouseEvent<HTMLCanvasElement>): number | null {
    if (!waveform || waveform.durationSec <= 0) {
      return null;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return null;
    }
    const ratio = (event.clientX - rect.left) / rect.width;
    return waveform.durationSec * Math.min(1, Math.max(0, ratio));
  }

  function hitTestFocusedSegmentEdge(event: MouseEvent<HTMLCanvasElement>): SegmentEdge | null {
    if (!waveform || waveform.durationSec <= 0 || focusedSegmentIndex === null) {
      return null;
    }
    const segment = editorSegments[focusedSegmentIndex];
    if (!segment) {
      return null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return null;
    }

    const x = event.clientX - rect.left;
    const startX = (segment.start / waveform.durationSec) * rect.width;
    const endX = (segment.end / waveform.durationSec) * rect.width;
    const thresholdPx = 7;
    if (Math.abs(x - startX) <= thresholdPx) {
      return "start";
    }
    if (Math.abs(x - endX) <= thresholdPx) {
      return "end";
    }
    return null;
  }

  function onWaveformMouseDown(event: MouseEvent<HTMLCanvasElement>) {
    const edge = hitTestFocusedSegmentEdge(event);
    if (edge && focusedSegmentIndex !== null) {
      setDragSegmentState({ segmentIndex: focusedSegmentIndex, edge });
      setHoveredSegmentEdge(edge);
      setActiveSegmentIndex(focusedSegmentIndex);
      return;
    }

    const seconds = secondsFromWaveformPointer(event);
    if (seconds === null) {
      return;
    }
    seekMedia(seconds);
    const nearest = closestSegmentIndex(editorSegments, seconds);
    if (nearest !== null) {
      setActiveSegmentIndex(nearest);
    }
  }

  function onWaveformMouseMove(event: MouseEvent<HTMLCanvasElement>) {
    if (dragSegmentState) {
      const seconds = secondsFromWaveformPointer(event);
      if (seconds === null) {
        return;
      }
      updateEditorSegmentBoundary(dragSegmentState.segmentIndex, dragSegmentState.edge, seconds);
      setWaveformCursorSec(seconds);
      return;
    }

    const edge = hitTestFocusedSegmentEdge(event);
    setHoveredSegmentEdge(edge);
  }

  function stopWaveformDrag() {
    setDragSegmentState(null);
    setHoveredSegmentEdge(null);
  }

  function onWaveformMouseUp() {
    if (dragSegmentState) {
      stopWaveformDrag();
    }
  }

  function onWaveformMouseLeave() {
    if (dragSegmentState) {
      stopWaveformDrag();
      return;
    }
    setHoveredSegmentEdge(null);
  }

  async function loadWaveformForSelectedJob() {
    if (!selectedJob) {
      setWaveformError("Aucun job selectionne.");
      return;
    }

    const parsedBins = Number(waveformBinsPerSecond);
    const binsPerSecond =
      Number.isFinite(parsedBins) && parsedBins > 0 ? Math.floor(parsedBins) : 50;

    setWaveformError("");
    setIsWaveformLoading(true);
    try {
      const result = await invoke<WaveformPeaks>("build_waveform_peaks", {
        path: selectedJob.inputPath,
        binsPerSecond,
        sampleRate: 16000,
      });
      setWaveform(result);
      const playerTime = getActiveMediaElement()?.currentTime ?? 0;
      setMediaCurrentSec(playerTime);
      setWaveformCursorSec(playerTime);
    } catch (e) {
      setWaveform(null);
      setWaveformError(String(e));
    } finally {
      setIsWaveformLoading(false);
    }
  }

  async function pickInputPath() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Selectionner un media",
    });
    if (typeof selected === "string") {
      setInputPath(selected);
    }
  }

  async function pickOutputDir() {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Selectionner un dossier de sortie",
    });
    if (typeof selected === "string") {
      setOutputDir(selected);
    }
  }

  async function openLocalPath(path: string) {
    try {
      await openPath(path);
    } catch (e) {
      setError(String(e));
    }
  }

  async function previewOutput(path: string) {
    setSelectedPreviewPath(path);
    setPreviewError("");
    if (!isPreviewableFile(path)) {
      setPreviewContent("");
      setPreviewError("Preview indisponible pour ce type de fichier. Utilise Ouvrir.");
      return;
    }

    setIsPreviewLoading(true);
    try {
      const content = await invoke<string>("read_text_preview", {
        path,
        maxBytes: 300000,
      });
      setPreviewContent(content);
    } catch (e) {
      setPreviewContent("");
      setPreviewError(String(e));
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function loadTranscriptEditor(path: string) {
    setEditorError("");
    setEditorStatus("");
    setEditorLastOutputPath("");
    setLastExportReport(null);
    setIsEditorLoading(true);
    try {
      const doc = await invoke<TranscriptDocument>("load_transcript_document", { path });
      setEditorSourcePath(doc.path);
      setEditorLanguage(doc.language ?? "");
      setEditorSegments(doc.segments);
      setEditorVisibleCount(120);
      setActiveSegmentIndex(doc.segments.length > 0 ? 0 : null);
      setEditorDirty(false);
      setEditorStatus(`Transcript charge: ${doc.segments.length} segment(s).`);
    } catch (e) {
      setEditorSourcePath("");
      setEditorLanguage("");
      setEditorSegments([]);
      setActiveSegmentIndex(null);
      setLastExportReport(null);
      setEditorError(String(e));
    } finally {
      setIsEditorLoading(false);
    }
  }

  function updateEditorSegmentText(index: number, text: string) {
    setEditorSegments((current) => {
      const next = [...current];
      if (!next[index]) {
        return current;
      }
      next[index] = { ...next[index], text };
      return next;
    });
    setEditorDirty(true);
  }

  function focusSegment(index: number) {
    const segment = editorSegments[index];
    if (!segment) {
      return;
    }
    setActiveSegmentIndex(index);
    seekMedia(segment.start);
  }

  function editableTargetSegmentIndex(): number | null {
    return actionSegmentIndex;
  }

  function splitActiveSegmentAtCursor() {
    const targetIndex = editableTargetSegmentIndex();
    if (targetIndex === null) {
      setEditorError("Aucun segment actif a split.");
      return;
    }
    const segment = editorSegments[targetIndex];
    if (!segment) {
      setEditorError("Segment actif introuvable.");
      return;
    }

    const lowerBound = segment.start + MIN_SEGMENT_DURATION_SEC;
    const upperBound = segment.end - MIN_SEGMENT_DURATION_SEC;
    if (upperBound <= lowerBound) {
      setEditorError("Segment trop court pour un split.");
      return;
    }

    const rawCursor = Number.isFinite(cursorTimeSec)
      ? cursorTimeSec
      : segment.start + (segment.end - segment.start) / 2;
    let splitAt = Math.min(upperBound, Math.max(lowerBound, rawCursor));
    splitAt = roundSecondsMs(splitAt);
    if (splitAt <= segment.start || splitAt >= segment.end) {
      setEditorError("Position de split invalide.");
      return;
    }

    const [leftText, rightText] = splitSegmentText(segment.text);
    const leftSegment: EditableSegment = {
      ...segment,
      end: splitAt,
      text: leftText,
    };
    const rightSegment: EditableSegment = {
      ...segment,
      start: splitAt,
      text: rightText,
    };

    setEditorSegments((current) => {
      const next = [...current];
      if (!next[targetIndex]) {
        return current;
      }
      next.splice(targetIndex, 1, leftSegment, rightSegment);
      return next;
    });
    setActiveSegmentIndex(targetIndex + 1);
    setWaveformCursorSec(splitAt);
    setEditorError("");
    setEditorStatus(`Segment #${targetIndex + 1} split a ${splitAt.toFixed(3)}s.`);
    setEditorDirty(true);
  }

  function mergeActiveSegment(direction: "prev" | "next") {
    const targetIndex = editableTargetSegmentIndex();
    if (targetIndex === null) {
      setEditorError("Aucun segment actif a fusionner.");
      return;
    }

    const neighborIndex = direction === "prev" ? targetIndex - 1 : targetIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= editorSegments.length) {
      setEditorError("Fusion impossible: segment voisin manquant.");
      return;
    }

    const firstIndex = Math.min(targetIndex, neighborIndex);
    const secondIndex = Math.max(targetIndex, neighborIndex);
    const first = editorSegments[firstIndex];
    const second = editorSegments[secondIndex];
    if (!first || !second) {
      setEditorError("Fusion impossible: segment introuvable.");
      return;
    }

    const leftSpeaker = first.speaker?.trim() || "";
    const rightSpeaker = second.speaker?.trim() || "";
    const mergedSpeaker = leftSpeaker || rightSpeaker || undefined;
    const mergedSegment: EditableSegment = {
      start: roundSecondsMs(Math.min(first.start, second.start)),
      end: roundSecondsMs(Math.max(first.end, second.end)),
      text: joinSegmentTexts(first.text, second.text),
      speaker: mergedSpeaker,
    };

    setEditorSegments((current) => {
      const next = [...current];
      if (!next[firstIndex] || !next[secondIndex]) {
        return current;
      }
      next.splice(firstIndex, 2, mergedSegment);
      return next;
    });
    setActiveSegmentIndex(firstIndex);
    setWaveformCursorSec(mergedSegment.start);
    setEditorError("");
    setEditorStatus(
      `Segments #${firstIndex + 1} et #${secondIndex + 1} fusionnes.`,
    );
    setEditorDirty(true);
  }

  async function saveEditedJson(overwrite: boolean) {
    if (!editorSourcePath || editorSegments.length === 0) {
      setEditorError("Aucun transcript charge dans l'editeur.");
      return;
    }
    if (overwrite) {
      const confirmed = window.confirm("Ecraser le JSON source avec les modifications ?");
      if (!confirmed) {
        return;
      }
    }

    setEditorError("");
    setEditorStatus("");
    setIsEditorSaving(true);
    try {
      const outPath = await invoke<string>("save_transcript_json", {
        request: {
          path: editorSourcePath,
          language: editorLanguage.trim() || null,
          segments: editorSegments,
          overwrite,
        },
      });
      setEditorDirty(false);
      setEditorLastOutputPath(outPath);
      setEditorStatus(`JSON sauvegarde: ${outPath}`);
      await refreshJobs();
    } catch (e) {
      setEditorError(String(e));
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function exportEditedTranscript(format: "json" | "srt" | "vtt" | "txt") {
    if (!editorSourcePath || editorSegments.length === 0) {
      setEditorError("Aucun transcript charge dans l'editeur.");
      return;
    }
    const normalizedRules = normalizeExportRules(exportRules);
    setExportRules(normalizedRules);
    setEditorError("");
    setEditorStatus("");
    setIsEditorSaving(true);
    try {
      const result = await invoke<ExportTranscriptResponse>("export_transcript", {
        request: {
          path: editorSourcePath,
          language: editorLanguage.trim() || null,
          segments: editorSegments,
          format,
          rules: normalizedRules,
        },
      });
      setEditorLastOutputPath(result.outputPath);
      setLastExportReport(result.report);
      setEditorStatus(`Export ${format.toUpperCase()} genere: ${result.outputPath}`);
      await refreshJobs();
      if (isPreviewableFile(result.outputPath)) {
        void previewOutput(result.outputPath);
      }
    } catch (e) {
      setEditorError(String(e));
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function cancelJob(jobId: string) {
    setError("");
    try {
      await invoke("cancel_job", { jobId });
      await refreshJobs();
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refreshJobs();
    void refreshRuntimeStatus();
    void refreshRuntimeSetupStatus();
    const timer = window.setInterval(refreshJobs, 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unlistenJobPromise = listen<Job>("job-updated", (event) => {
      setJobs((current) => upsertJobInList(current, event.payload));
    });

    const unlistenLogPromise = listen<JobLogEvent>("job-log", (event) => {
      setJobLogs((current) => {
        const existing = current[event.payload.jobId] ?? [];
        const nextLogs = [...existing, event.payload].slice(-600);
        return { ...current, [event.payload.jobId]: nextLogs };
      });
    });

    const unlistenRuntimeSetupLogPromise = listen<RuntimeSetupLogEvent>(
      "runtime-setup-log",
      (event) => {
        setRuntimeSetupLogs((current) => [...current, event.payload].slice(-1200));
      },
    );

    const unlistenRuntimeSetupFinishedPromise = listen<RuntimeSetupFinishedEvent>(
      "runtime-setup-finished",
      (event) => {
        setRuntimeSetupRunning(false);
        setRuntimeSetupMessage(event.payload.message);
        void refreshRuntimeStatus();
        void refreshRuntimeSetupStatus();
      },
    );

    return () => {
      void unlistenJobPromise.then((unlisten) => unlisten());
      void unlistenLogPromise.then((unlisten) => unlisten());
      void unlistenRuntimeSetupLogPromise.then((unlisten) => unlisten());
      void unlistenRuntimeSetupFinishedPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) {
      setSelectedJobId(jobs[0].id);
      return;
    }
    if (selectedJobId && !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0]?.id ?? "");
      setSelectedPreviewPath("");
      setPreviewContent("");
      setPreviewError("");
    }
  }, [jobs, selectedJobId]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setWaveform(null);
    setWaveformError("");
    setWaveformCursorSec(null);
    setMediaCurrentSec(0);
    setActiveSegmentIndex(null);
    setDragSegmentState(null);
    setHoveredSegmentEdge(null);
  }, [selectedJobId]);

  useEffect(() => {
    if (activeSegmentIndex === null) {
      return;
    }
    if (!editorSegments[activeSegmentIndex]) {
      setActiveSegmentIndex(editorSegments.length > 0 ? editorSegments.length - 1 : null);
    }
  }, [activeSegmentIndex, editorSegments]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveform) {
      return;
    }

    const widthCss = Math.max(320, Math.floor(canvas.clientWidth));
    const heightCss = 200;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(widthCss * dpr);
    canvas.height = Math.floor(heightCss * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, heightCss);

    ctx.fillStyle = "#f5fcfc";
    ctx.fillRect(0, 0, widthCss, heightCss);

    const duration = Math.max(0.001, waveform.durationSec);

    if (editorSegments.length > 0) {
      ctx.fillStyle = "rgba(19, 111, 126, 0.14)";
      const maxOverlays = Math.min(editorSegments.length, 6000);
      for (let i = 0; i < maxOverlays; i += 1) {
        const segment = editorSegments[i];
        const xStart = Math.floor((segment.start / duration) * widthCss);
        const xEnd = Math.ceil((segment.end / duration) * widthCss);
        if (xEnd <= 0 || xStart >= widthCss) {
          continue;
        }
        const w = Math.max(1, xEnd - xStart);
        ctx.fillRect(Math.max(0, xStart), 0, w, heightCss);
      }

      if (focusedSegmentIndex !== null) {
        const focused = editorSegments[focusedSegmentIndex];
        if (focused) {
          const startX = Math.floor((focused.start / duration) * widthCss);
          const endX = Math.ceil((focused.end / duration) * widthCss);
          const segW = Math.max(2, endX - startX);

          ctx.fillStyle = "rgba(36, 123, 176, 0.24)";
          ctx.fillRect(Math.max(0, startX), 0, segW, heightCss);

          const handleSize = 9;
          const drawHandle = (x: number, active: boolean) => {
            ctx.strokeStyle = active ? "#e06b2f" : "#1a6fb0";
            ctx.lineWidth = active ? 2.2 : 2;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, heightCss);
            ctx.stroke();

            ctx.fillStyle = active ? "#e06b2f" : "#1a6fb0";
            ctx.fillRect(
              x - Math.floor(handleSize / 2),
              Math.floor(heightCss / 2 - handleSize),
              handleSize,
              handleSize * 2,
            );
          };

          const startActive =
            dragSegmentState?.segmentIndex === focusedSegmentIndex &&
            dragSegmentState?.edge === "start";
          const endActive =
            dragSegmentState?.segmentIndex === focusedSegmentIndex &&
            dragSegmentState?.edge === "end";
          const startHover = hoveredSegmentEdge === "start";
          const endHover = hoveredSegmentEdge === "end";

          drawHandle(startX, startActive || startHover);
          drawHandle(endX, endActive || endHover);
        }
      }
    }

    const centerY = heightCss / 2;
    ctx.strokeStyle = "rgba(16, 93, 103, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY + 0.5);
    ctx.lineTo(widthCss, centerY + 0.5);
    ctx.stroke();

    const peaks = waveform.peaks;
    const pixelColumns = Math.max(1, widthCss);
    const binsPerPixel = peaks.length / pixelColumns;

    ctx.strokeStyle = "#0f7e8a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < pixelColumns; x += 1) {
      const start = Math.floor(x * binsPerPixel);
      const end = Math.max(start + 1, Math.floor((x + 1) * binsPerPixel));
      let amp = 0;
      for (let i = start; i < end && i < peaks.length; i += 1) {
        const value = peaks[i] ?? 0;
        if (value > amp) {
          amp = value;
        }
      }
      const h = Math.max(1, Math.min(1, amp) * (centerY - 8));
      ctx.moveTo(x + 0.5, centerY - h);
      ctx.lineTo(x + 0.5, centerY + h);
    }
    ctx.stroke();

    const playheadX = Math.floor((Math.max(0, mediaCurrentSec) / duration) * widthCss);
    ctx.strokeStyle = "#d35d2f";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX + 0.5, 0);
    ctx.lineTo(playheadX + 0.5, heightCss);
    ctx.stroke();

    if (waveformCursorSec !== null) {
      const cursorX = Math.floor((Math.max(0, waveformCursorSec) / duration) * widthCss);
      ctx.strokeStyle = "#1964b6";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX + 0.5, 0);
      ctx.lineTo(cursorX + 0.5, heightCss);
      ctx.stroke();
    }
  }, [
    waveform,
    mediaCurrentSec,
    waveformCursorSec,
    editorSegments,
    focusedSegmentIndex,
    hoveredSegmentEdge,
    dragSegmentState,
    viewportWidth,
  ]);

  useEffect(() => {
    if (!dragSegmentState) {
      return;
    }
    const stopDrag = () => {
      setDragSegmentState(null);
      setHoveredSegmentEdge(null);
    };
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, [dragSegmentState]);

  async function submitJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!inputPath.trim()) {
      setError("Le chemin du media est requis.");
      return;
    }

    if (mode === "whisperx" && whisperxOptions.diarize && !whisperxOptions.hfToken.trim()) {
      setError("Le HF Token est requis pour activer la diarization pyannote.");
      return;
    }

    if (mode === "whisperx" && !runtimeReady) {
      setError("Runtime WhisperX incomplet. Clique sur 'Verifier runtime' puis corrige Python/WhisperX/ffmpeg.");
      return;
    }

    setIsSubmitting(true);
    try {
      const request: CreateJobRequest = {
        inputPath: inputPath.trim(),
        outputDir: outputDir.trim() || null,
        mode,
        whisperxOptions: mode === "whisperx" ? normalizeWhisperxOptions(whisperxOptions) : undefined,
      };
      const created = await invoke<Job>("create_job", { request });
      setSelectedJobId(created.id);
      await refreshJobs();
      setInputPath("");
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  function applyProfile(profileId: string) {
    setSelectedProfileId(profileId);
    const profile = profilePresets.find((preset) => preset.id === profileId);
    if (profile) {
      setWhisperxOptions({ ...profile.options });
    }
  }

  return (
    <main className="studio-shell">
      <section className="hero-card">
        <p className="tagline">WhisperX Studio</p>
        <h1>Pipeline local Tauri + Worker Python</h1>
        <p className="subtitle">
          Lance des jobs locaux pour calibration, transcription, alignement et diarization.
        </p>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>Nouveau Job</h2>
          <span>{runningJobs} en cours</span>
        </header>

        <div className={`runtime-box ${runtimeReady ? "ok" : "warn"}`}>
          <div className="runtime-header-row">
            <h3>Runtime local</h3>
            <button type="button" className="ghost" onClick={refreshRuntimeStatus} disabled={isRuntimeLoading}>
              {isRuntimeLoading ? "Verification..." : "Verifier runtime"}
            </button>
          </div>
          {!runtimeStatus ? (
            <p className="small">Aucun diagnostic runtime disponible pour l'instant.</p>
          ) : (
            <>
              <p className="small">
                Python: {runtimeStatus.pythonOk ? "ok" : "ko"} | WhisperX:{" "}
                {runtimeStatus.whisperxOk ? "ok" : "ko"} | ffmpeg: {runtimeStatus.ffmpegOk ? "ok" : "ko"}
              </p>
              <p className="small mono">Commande Python: {runtimeStatus.pythonCommand}</p>
              {runtimeStatus.whisperxVersion ? (
                <p className="small">WhisperX version: {runtimeStatus.whisperxVersion}</p>
              ) : null}
              {!runtimeReady ? (
                <div className="runtime-setup-box">
                  <p className="small">
                    Assistant first-run: installe un runtime local Python + WhisperX sans Docker.
                  </p>
                  <div className="runtime-setup-actions">
                    <button type="button" onClick={startRuntimeSetup} disabled={runtimeSetupRunning}>
                      {runtimeSetupRunning ? "Installation en cours..." : "Installer runtime local"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={refreshRuntimeSetupStatus}
                      disabled={runtimeSetupRunning}
                    >
                      Verifier setup
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setRuntimeSetupLogs([]);
                        setRuntimeSetupMessage("");
                      }}
                      disabled={runtimeSetupRunning || runtimeSetupLogs.length === 0}
                    >
                      Effacer logs setup
                    </button>
                  </div>
                  {runtimeSetupMessage ? <p className="small">{runtimeSetupMessage}</p> : null}
                  {runtimeSetupLogs.length > 0 ? (
                    <ul className="runtime-setup-log-list">
                      {runtimeSetupLogs.map((entry, idx) => (
                        <li key={`${entry.tsMs}-${idx}`}>
                          <span className="mono">[{new Date(entry.tsMs).toLocaleTimeString()}]</span>{" "}
                          <strong>{entry.stream}</strong> {entry.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <ul className="runtime-details">
                {runtimeStatus.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <form className="job-form" onSubmit={submitJob}>
          <label>
            Chemin media local
            <div className="path-input-row">
              <input
                value={inputPath}
                onChange={(e) => setInputPath(e.currentTarget.value)}
                placeholder="C:\\media\\audio.wav"
                autoComplete="off"
              />
              <button className="ghost inline" type="button" onClick={pickInputPath}>
                Parcourir
              </button>
            </div>
            <p className="field-help">Audio ou video local (wav, mp3, m4a, flac, mp4, mkv).</p>
          </label>

          <label>
            Dossier de sortie (optionnel)
            <div className="path-input-row">
              <input
                value={outputDir}
                onChange={(e) => setOutputDir(e.currentTarget.value)}
                placeholder="Laisser vide pour dossier app local"
                autoComplete="off"
              />
              <button className="ghost inline" type="button" onClick={pickOutputDir}>
                Dossier
              </button>
            </div>
            <p className="field-help">Si vide, l'app cree un dossier de run automatiquement.</p>
          </label>

          <label>
            Mode d'execution
            <select value={mode} onChange={(e) => setMode(e.currentTarget.value as "mock" | "whisperx")}>
              <option value="mock">mock (test rapide sans ASR)</option>
              <option value="whisperx">whisperx (transcription reelle)</option>
            </select>
          </label>

          {mode === "whisperx" ? (
            <>
              <label>
                Profil rapide
                <select value={selectedProfileId} onChange={(e) => applyProfile(e.currentTarget.value)}>
                  {profilePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <p className="field-help">{selectedProfile?.description}</p>
              </label>

              <div className="option-grid">
                <label>
                  Modele Whisper
                  <input
                    value={whisperxOptions.model}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({ ...prev, model: e.currentTarget.value }))
                    }
                    placeholder="small / medium / large-v3"
                  />
                  <p className="field-help">Plus le modele est grand, plus la precision augmente.</p>
                </label>

                <label>
                  Langue
                  <input
                    value={whisperxOptions.language}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({ ...prev, language: e.currentTarget.value }))
                    }
                    placeholder="fr, en... (vide = autodetection)"
                  />
                  <p className="field-help">Laisser vide pour autodetection (plus lent).</p>
                </label>

                <label>
                  Device
                  <select
                    value={whisperxOptions.device}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({
                        ...prev,
                        device: e.currentTarget.value as UiWhisperxOptions["device"],
                      }))
                    }
                  >
                    <option value="auto">auto</option>
                    <option value="cuda">cuda (GPU)</option>
                    <option value="cpu">cpu</option>
                  </select>
                  <p className="field-help">`cuda` si carte NVIDIA disponible, sinon `cpu`.</p>
                </label>

                <label>
                  Compute Type
                  <select
                    value={whisperxOptions.computeType}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({
                        ...prev,
                        computeType: e.currentTarget.value as UiWhisperxOptions["computeType"],
                      }))
                    }
                  >
                    <option value="default">default</option>
                    <option value="float16">float16 (GPU rapide)</option>
                    <option value="float32">float32 (precision)</option>
                    <option value="int8">int8 (memoire reduite)</option>
                  </select>
                </label>

                <label>
                  Batch Size
                  <input
                    value={whisperxOptions.batchSize}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({ ...prev, batchSize: e.currentTarget.value }))
                    }
                    placeholder="8"
                  />
                  <p className="field-help">Plus haut = plus rapide, mais plus de VRAM/RAM.</p>
                </label>

                <label>
                  Output Format
                  <select
                    value={whisperxOptions.outputFormat}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({
                        ...prev,
                        outputFormat: e.currentTarget.value as UiWhisperxOptions["outputFormat"],
                      }))
                    }
                  >
                    <option value="all">all</option>
                    <option value="json">json</option>
                    <option value="srt">srt</option>
                    <option value="vtt">vtt</option>
                    <option value="txt">txt</option>
                    <option value="tsv">tsv</option>
                    <option value="aud">aud</option>
                  </select>
                  <p className="field-help">`all` exporte tous les formats utiles.</p>
                </label>

                <label>
                  VAD Method
                  <select
                    value={whisperxOptions.vadMethod}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({
                        ...prev,
                        vadMethod: e.currentTarget.value as UiWhisperxOptions["vadMethod"],
                      }))
                    }
                  >
                    <option value="pyannote">pyannote (precision)</option>
                    <option value="silero">silero (leger/rapide)</option>
                  </select>
                  <p className="field-help">Decoupe les zones de parole avant transcription.</p>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={whisperxOptions.diarize}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({ ...prev, diarize: e.currentTarget.checked }))
                    }
                  />
                  Diarization (qui parle ?)
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={whisperxOptions.noAlign}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({ ...prev, noAlign: e.currentTarget.checked }))
                    }
                  />
                  No Align (plus rapide, horodatage moins fin)
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={whisperxOptions.printProgress}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({
                        ...prev,
                        printProgress: e.currentTarget.checked,
                      }))
                    }
                  />
                  Print Progress (logs plus verbeux)
                </label>

                <label className="full-width">
                  HF Token (optionnel, requis si diarization)
                  <input
                    value={whisperxOptions.hfToken}
                    onChange={(e) =>
                      setWhisperxOptions((prev) => ({ ...prev, hfToken: e.currentTarget.value }))
                    }
                    placeholder="hf_xxx"
                  />
                  <p className="field-help">
                    Token Hugging Face lecture pour modeles pyannote.
                  </p>
                </label>
              </div>
            </>
          ) : null}

          <div className="actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Lancement..." : "Lancer le job"}
            </button>
            <button type="button" className="ghost" onClick={refreshJobs}>
              Rafraichir
            </button>
          </div>
        </form>

        {error ? <p className="error-box">{error}</p> : null}
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>Historique des Jobs</h2>
          <span>{jobs.length} total</span>
        </header>

        <div className="jobs-grid">
          {jobs.length === 0 ? (
            <p className="empty-state">Aucun job pour le moment.</p>
          ) : (
            jobs.map((job) => {
              const canCancel = job.status === "queued" || job.status === "running";
              const isSelected = selectedJobId === job.id;
              return (
                <article className={`job-card ${job.status} ${isSelected ? "selected" : ""}`} key={job.id}>
                  <div className="job-top-row">
                    <strong>{job.id}</strong>
                    <span className={`status-pill ${job.status}`}>{job.status}</span>
                  </div>

                  <p className="job-message">{job.message}</p>
                  <p className="mono">{job.inputPath}</p>
                  <p className="mono">Sortie: {job.outputDir}</p>
                  <p>Mode: {job.mode}</p>
                  {job.whisperxOptions?.model ? (
                    <p className="small">Modele: {job.whisperxOptions.model}</p>
                  ) : null}

                  <div className="progress-track">
                    <div className="progress-value" style={{ width: `${Math.max(4, job.progress)}%` }} />
                  </div>
                  <p className="small">{job.progress}%</p>

                  <div className="job-actions">
                    <button type="button" className="ghost" onClick={() => setSelectedJobId(job.id)}>
                      Voir details
                    </button>
                    <button type="button" className="ghost" onClick={() => openLocalPath(job.outputDir)}>
                      Ouvrir dossier
                    </button>
                    {canCancel ? (
                      <button type="button" className="danger" onClick={() => cancelJob(job.id)}>
                        Annuler
                      </button>
                    ) : null}
                  </div>

                  {job.error ? <p className="error-box">{job.error}</p> : null}
                  <p className="small">Maj: {formatTimestamp(job.updatedAtMs)}</p>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>Run Details</h2>
          <span>{selectedJob ? selectedJob.id : "Aucun job selectionne"}</span>
        </header>

        {!selectedJob ? (
          <p className="empty-state">Selectionne un job dans l'historique pour voir ses details.</p>
        ) : (
          <div className="details-layout">
            <div className="details-column">
              <div className="details-meta">
                <p>
                  <strong>Input:</strong> {selectedJob.inputPath}
                </p>
                <p>
                  <strong>Output:</strong> {selectedJob.outputDir}
                </p>
                <p>
                  <strong>Cree le:</strong> {formatTimestamp(selectedJob.createdAtMs)}
                </p>
                <p>
                  <strong>Status:</strong> {selectedJob.status}
                </p>
              </div>

              <div className="details-actions">
                <button type="button" className="ghost" onClick={() => openLocalPath(selectedJob.inputPath)}>
                  Ouvrir media source
                </button>
                <button type="button" className="ghost" onClick={() => openLocalPath(selectedJob.outputDir)}>
                  Exporter (ouvrir dossier)
                </button>
              </div>

              <h3>Alignment Workspace</h3>
              <div className="alignment-panel">
                <div className="alignment-toolbar">
                  <label>
                    Resolution waveform (bins/s)
                    <select
                      value={waveformBinsPerSecond}
                      onChange={(e) => setWaveformBinsPerSecond(e.currentTarget.value)}
                    >
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="150">150</option>
                    </select>
                  </label>
                  <button type="button" className="ghost" onClick={loadWaveformForSelectedJob} disabled={isWaveformLoading}>
                    {isWaveformLoading ? "Generation waveform..." : "Charger waveform"}
                  </button>
                </div>

                <p className="small mono">{selectedJob.inputPath}</p>
                {selectedIsVideo ? (
                  <video
                    ref={videoRef}
                    className="media-player"
                    src={selectedMediaSrc}
                    controls
                    preload="metadata"
                    onTimeUpdate={(e) => setMediaCurrentSec(e.currentTarget.currentTime)}
                    onSeeked={(e) => setMediaCurrentSec(e.currentTarget.currentTime)}
                  />
                ) : (
                  <audio
                    ref={audioRef}
                    className="media-player"
                    src={selectedMediaSrc}
                    controls
                    preload="metadata"
                    onTimeUpdate={(e) => setMediaCurrentSec(e.currentTarget.currentTime)}
                    onSeeked={(e) => setMediaCurrentSec(e.currentTarget.currentTime)}
                  />
                )}

                {waveformError ? <p className="error-box">{waveformError}</p> : null}
                {!waveform ? (
                  <p className="small">Charge le waveform pour activer le seek precis sur timeline.</p>
                ) : (
                  <>
                    <canvas
                      ref={waveformCanvasRef}
                      className="waveform-canvas"
                      style={{ cursor: waveformCursorStyle }}
                      onMouseDown={onWaveformMouseDown}
                      onMouseMove={onWaveformMouseMove}
                      onMouseUp={onWaveformMouseUp}
                      onMouseLeave={onWaveformMouseLeave}
                    />
                    <p className="small">
                      Duree: {formatClockSeconds(waveform.durationSec)} | Lecture:{" "}
                      {formatClockSeconds(mediaCurrentSec)} | Curseur:{" "}
                      {formatClockSeconds(waveformCursorSec ?? mediaCurrentSec)} | Cache:{" "}
                      {waveform.cached ? "oui" : "non"}
                    </p>
                  </>
                )}

                {focusedSegment ? (
                  <div className="focus-segment">
                    <p className="small">
                      Segment {activeSegmentIndex === focusedSegment.index ? "actif" : "proche"} #
                      {focusedSegment.index + 1} ({formatClockSeconds(focusedSegment.segment.start)} -{" "}
                      {formatClockSeconds(focusedSegment.segment.end)}) | distance:{" "}
                      {focusedSegment.distanceSec.toFixed(3)}s
                    </p>
                    <p className="mono">{focusedSegment.segment.text}</p>
                    <div className="file-actions">
                      <button type="button" className="ghost" onClick={() => setActiveSegmentIndex(focusedSegment.index)}>
                        Definir segment actif
                      </button>
                      <button type="button" className="ghost" onClick={splitActiveSegmentAtCursor} disabled={!canSplitActiveSegment}>
                        Split au curseur
                      </button>
                      <button type="button" className="ghost" onClick={() => mergeActiveSegment("prev")} disabled={!canMergePrev}>
                        Fusionner precedent
                      </button>
                      <button type="button" className="ghost" onClick={() => mergeActiveSegment("next")} disabled={!canMergeNext}>
                        Fusionner suivant
                      </button>
                      <button type="button" className="ghost" onClick={() => seekMedia(focusedSegment.segment.start)}>
                        Aller debut segment
                      </button>
                      <button type="button" className="ghost" onClick={() => seekMedia(focusedSegment.segment.end)}>
                        Aller fin segment
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="small">
                    Pour lier waveform et texte, charge un transcript JSON dans "Transcript Editor".
                  </p>
                )}
              </div>

              <h3>Fichiers de sortie</h3>
              {selectedJob.outputFiles.length === 0 ? (
                <p className="small">Pas de fichier genere pour ce job.</p>
              ) : (
                <ul className="file-list">
                  {selectedJob.outputFiles.map((path) => (
                    <li key={path}>
                      <span className="mono">{path}</span>
                      <div className="file-actions">
                        <button type="button" className="ghost" onClick={() => openLocalPath(path)}>
                          Ouvrir
                        </button>
                        <button type="button" className="ghost" onClick={() => previewOutput(path)}>
                          Preview
                        </button>
                        {path.toLowerCase().endsWith(".json") ? (
                          <button type="button" className="ghost" onClick={() => loadTranscriptEditor(path)}>
                            Editer transcript
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3>Apercu</h3>
              {!selectedPreviewPath ? (
                <p className="small">Selectionne un fichier de sortie puis clique sur Preview.</p>
              ) : (
                <div className="preview-box">
                  <p className="mono">{selectedPreviewPath}</p>
                  {isPreviewLoading ? <p className="small">Chargement...</p> : null}
                  {previewError ? <p className="error-box">{previewError}</p> : null}
                  {previewContent ? <pre>{previewContent}</pre> : null}
                </div>
              )}

              <h3>Transcript Editor</h3>
              {!editorSourcePath ? (
                <p className="small">
                  Charge un fichier `.json` de sortie pour activer l'edition segment par segment.
                </p>
              ) : (
                <div className="editor-panel">
                  <p className="mono">{editorSourcePath}</p>
                  <label>
                    Langue
                    <input
                      value={editorLanguage}
                      onChange={(e) => {
                        setEditorLanguage(e.currentTarget.value);
                        setEditorDirty(true);
                      }}
                      placeholder="fr, en..."
                    />
                  </label>

                  <div className="editor-toolbar">
                    <button type="button" disabled={isEditorSaving || isEditorLoading} onClick={() => saveEditedJson(false)}>
                      Sauver JSON
                    </button>
                    <button type="button" className="ghost" disabled={isEditorSaving || isEditorLoading} onClick={() => saveEditedJson(true)}>
                      Ecraser source
                    </button>
                    <button type="button" className="ghost" disabled={isEditorSaving || isEditorLoading} onClick={() => exportEditedTranscript("srt")}>
                      Export SRT
                    </button>
                    <button type="button" className="ghost" disabled={isEditorSaving || isEditorLoading} onClick={() => exportEditedTranscript("vtt")}>
                      Export VTT
                    </button>
                    <button type="button" className="ghost" disabled={isEditorSaving || isEditorLoading} onClick={() => exportEditedTranscript("txt")}>
                      Export TXT
                    </button>
                    <button type="button" className="ghost" disabled={isEditorSaving || isEditorLoading} onClick={() => exportEditedTranscript("json")}>
                      Export JSON
                    </button>
                  </div>

                  <div className="export-rules-grid">
                    <label>
                      Min Duration (s)
                      <input
                        type="number"
                        step="0.005"
                        min="0.001"
                        value={exportRules.minDurationSec}
                        onChange={(e) => {
                          const next = Number(e.currentTarget.value);
                          if (Number.isFinite(next)) {
                            setExportRules((prev) => ({ ...prev, minDurationSec: next }));
                          }
                        }}
                      />
                    </label>
                    <label>
                      Min Gap (s)
                      <input
                        type="number"
                        step="0.005"
                        min="0"
                        value={exportRules.minGapSec}
                        onChange={(e) => {
                          const next = Number(e.currentTarget.value);
                          if (Number.isFinite(next)) {
                            setExportRules((prev) => ({ ...prev, minGapSec: next }));
                          }
                        }}
                      />
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={exportRules.fixOverlaps}
                        onChange={(e) =>
                          setExportRules((prev) => ({ ...prev, fixOverlaps: e.currentTarget.checked }))
                        }
                      />
                      Corriger overlaps
                    </label>
                  </div>

                  {lastExportReport ? (
                    <div className="export-report-box">
                      <p className="small">
                        Rapport export: adjustments={lastExportReport.totalAdjustments} | overlaps fixes=
                        {lastExportReport.overlapsFixed} | min-gap={lastExportReport.minGapAdjustments} |
                        min-duration={lastExportReport.minDurationAdjustments}
                      </p>
                      <p className="small">
                        Segments in/out: {lastExportReport.inputSegments} / {lastExportReport.outputSegments}
                        {lastExportReport.reorderedSegments ? " | Reordonnancement applique" : ""}
                      </p>
                      <ul className="report-notes">
                        {lastExportReport.notes.map((note, idx) => (
                          <li key={`${note}-${idx}`}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="small">
                    Segments: {editorSegments.length} | Affiches: {displayedEditorSegments.length}
                    {editorDirty ? " | Modifications non sauvegardees" : ""}
                  </p>
                  {isEditorLoading ? <p className="small">Chargement editeur...</p> : null}
                  {editorStatus ? <p className="small">{editorStatus}</p> : null}
                  {editorError ? <p className="error-box">{editorError}</p> : null}
                  {editorLastOutputPath ? (
                    <div className="editor-last-output">
                      <p className="mono">{editorLastOutputPath}</p>
                      <div className="file-actions">
                        <button type="button" className="ghost" onClick={() => openLocalPath(editorLastOutputPath)}>
                          Ouvrir
                        </button>
                        {isPreviewableFile(editorLastOutputPath) ? (
                          <button type="button" className="ghost" onClick={() => previewOutput(editorLastOutputPath)}>
                            Preview
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="editor-segments">
                    {displayedEditorSegments.map((segment, index) => (
                      <div
                        className={`editor-segment ${activeSegmentIndex === index ? "selected" : ""}`}
                        key={`${segment.start}-${segment.end}-${index}`}
                        onClick={() => setActiveSegmentIndex(index)}
                      >
                        <p className="small">
                          #{index + 1} | {segment.start.toFixed(3)}s - {segment.end.toFixed(3)}s
                          {segment.speaker ? ` | ${segment.speaker}` : ""}
                        </p>
                        <div className="segment-controls">
                          <label>
                            Start (s)
                            <input
                              type="number"
                              step="0.001"
                              value={segment.start}
                              onChange={(e) => {
                                const value = Number(e.currentTarget.value);
                                if (Number.isFinite(value)) {
                                  updateEditorSegmentBoundary(index, "start", value);
                                }
                              }}
                            />
                          </label>
                          <label>
                            End (s)
                            <input
                              type="number"
                              step="0.001"
                              value={segment.end}
                              onChange={(e) => {
                                const value = Number(e.currentTarget.value);
                                if (Number.isFinite(value)) {
                                  updateEditorSegmentBoundary(index, "end", value);
                                }
                              }}
                            />
                          </label>
                          <button type="button" className="ghost" onClick={() => focusSegment(index)}>
                            Focus waveform
                          </button>
                        </div>
                        <textarea
                          value={segment.text}
                          onChange={(e) => updateEditorSegmentText(index, e.currentTarget.value)}
                          rows={2}
                        />
                      </div>
                    ))}
                  </div>

                  {hasMoreEditorSegments ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setEditorVisibleCount((count) => count + 120)}
                    >
                      Charger 120 segments de plus
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            <div className="details-column">
              <h3>Timeline logs</h3>
              <ul className="timeline-list">
                {selectedJobLogs.length === 0 ? (
                  <li className="small">Aucun log recu pour ce job.</li>
                ) : (
                  selectedJobLogs.map((log, idx) => (
                    <li key={`${log.tsMs}-${idx}`}>
                      <span className="timeline-ts">{new Date(log.tsMs).toLocaleTimeString()}</span>
                      <span className={`timeline-level ${log.level}`}>{log.level}</span>
                      <span className="timeline-stage">{log.stage ? log.stage : "-"}</span>
                      <span className="timeline-msg">{log.message}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
