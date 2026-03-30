import { defaultExportRules } from "./constants";
import type {
  EditableSegment,
  EditorSnapshot,
  ExportTimingRules,
  Job,
  RuntimeStatus,
  TranscriptQaIssue,
  TranscriptQaIssueType,
  UiWhisperxOptions,
  WhisperxOptions,
} from "./types";

/** Nombre de mots minimum pour signaler un « débit faible » (évite le bruit sur segments très courts). */
export const QA_SPEECH_RATE_LOW_MIN_WORDS = 3;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Présence du bridge Tauri (les `invoke` échouent dans le navigateur sans shell Tauri). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Normalise un chemin fichier pour IPC (`read_text_preview`, etc.) : retire `file://`, décode l’URL.
 */
export function normalizeLocalFilePathForTauri(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return "";
  }
  if (!t.toLowerCase().startsWith("file:")) {
    return t;
  }
  try {
    const url = new URL(t);
    let p = url.pathname;
    if (/^\/[A-Za-z]:/.test(p)) {
      p = p.slice(1);
    }
    return decodeURIComponent(p);
  } catch {
    return t.replace(/^file:\/\//i, "");
  }
}

/**
 * Joint un répertoire de base et des segments relatifs (chemins locaux Windows ou POSIX).
 */
export function joinPathSegments(base: string, ...segments: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  let out = base.replace(/[/\\]+$/, "");
  for (const seg of segments) {
    const s = seg.replace(/^[/\\]+/, "");
    if (s) {
      out += sep + s;
    }
  }
  return out;
}

export function parseFiniteNumberInput(raw: string): number | null {
  if (raw.trim() === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `audioPipelineModulesJson` (prioritaire) puis objet `audioPipelineModules`.
 * JSON vide, invalide, tableau ou `{}` : ignoré pour la partie JSON ; repli sur l’objet.
 */
export function parseAudioPipelineModulesFromUi(
  source: UiWhisperxOptions,
): Record<string, unknown> | undefined {
  const raw = source.audioPipelineModulesJson?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.keys(parsed as Record<string, unknown>).length > 0
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  const obj = source.audioPipelineModules;
  if (obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).length > 0) {
    return obj;
  }
  return undefined;
}

/**
 * `audioPipelineSegmentsJson` (prioritaire) : tableau de plages pour WX-623.
 */
export function parseAudioPipelineSegmentsFromUi(source: UiWhisperxOptions): unknown[] | undefined {
  const raw = source.audioPipelineSegmentsJson?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  return new Date(ms).toLocaleString();
}

export function upsertJobInList(current: Job[], incoming: Job): Job[] {
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

/** Compare deux chemins absolus de dossiers (slash final ignoré). */
export function pathsEqualNormalized(a: string, b: string): boolean {
  const strip = (s: string) => s.trim().replace(/[/\\]+$/, "");
  return strip(a) === strip(b);
}

/** Dernier segment de chemin (slash ou backslash). */
export function fileBasename(path: string): string {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

export function normalizeWhisperxOptions(source: UiWhisperxOptions): WhisperxOptions {
  const batchSize = Number(source.batchSize);
  const pipelineChunkSeconds = Number(source.pipelineChunkSeconds);
  const pipelineChunkOverlapSeconds = Number(source.pipelineChunkOverlapSeconds);
  const minSpeakers = Number(source.minSpeakers);
  const maxSpeakers = Number(source.maxSpeakers);
  const forceNSpeakers = Number(source.forceNSpeakers);
  const analysisPauseMin = Number(source.analysisPauseMin);
  const analysisPauseIgnoreBelow = Number(source.analysisPauseIgnoreBelow);
  const analysisPauseMax = Number(source.analysisPauseMax);
  const analysisNonspeechMinDuration = Number(source.analysisNonspeechMinDuration);
  const analysisIpuMinWords = Number(source.analysisIpuMinWords);
  const analysisIpuMinDuration = Number(source.analysisIpuMinDuration);
  const analysisIpuBridgeShortGapsUnder = Number(source.analysisIpuBridgeShortGapsUnder);
  const stMerge = parseFiniteNumberInput(source.analysisSpeakerTurnMergeGapSecMax);
  const stSplit = parseFiniteNumberInput(source.analysisSpeakerTurnSplitWordGapSec);
  const wrl = parseFiniteNumberInput(source.analysisWordTsNeighborRatioLow);
  const wrh = parseFiniteNumberInput(source.analysisWordTsNeighborRatioHigh);
  const wsm = parseFiniteNumberInput(source.analysisWordTsSmoothMaxSec);
  const apm = parseAudioPipelineModulesFromUi(source);
  const aps = parseAudioPipelineSegmentsFromUi(source);
  return {
    model: source.model.trim() || undefined,
    language: source.language.trim() || undefined,
    device: source.device === "auto" ? undefined : source.device,
    computeType: source.computeType,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : undefined,
    pipelineChunkSeconds:
      Number.isFinite(pipelineChunkSeconds) && pipelineChunkSeconds > 0
        ? pipelineChunkSeconds
        : undefined,
    pipelineChunkOverlapSeconds:
      Number.isFinite(pipelineChunkOverlapSeconds) && pipelineChunkOverlapSeconds >= 0
        ? pipelineChunkOverlapSeconds
        : undefined,
    diarize: source.diarize,
    minSpeakers:
      Number.isFinite(minSpeakers) && minSpeakers > 0 ? Math.floor(minSpeakers) : undefined,
    maxSpeakers:
      Number.isFinite(maxSpeakers) && maxSpeakers > 0 ? Math.floor(maxSpeakers) : undefined,
    forceNSpeakers:
      Number.isFinite(forceNSpeakers) && forceNSpeakers > 0
        ? Math.floor(forceNSpeakers)
        : undefined,
    analysisPauseMin:
      Number.isFinite(analysisPauseMin) && analysisPauseMin >= 0 ? analysisPauseMin : undefined,
    analysisPauseIgnoreBelow:
      Number.isFinite(analysisPauseIgnoreBelow) && analysisPauseIgnoreBelow >= 0
        ? analysisPauseIgnoreBelow
        : undefined,
    analysisPauseMax:
      Number.isFinite(analysisPauseMax) && analysisPauseMax > 0 ? analysisPauseMax : undefined,
    analysisIncludeNonspeech: source.analysisIncludeNonspeech,
    analysisNonspeechMinDuration:
      Number.isFinite(analysisNonspeechMinDuration) && analysisNonspeechMinDuration >= 0
        ? analysisNonspeechMinDuration
        : undefined,
    analysisIpuMinWords:
      Number.isFinite(analysisIpuMinWords) && analysisIpuMinWords >= 1
        ? Math.floor(analysisIpuMinWords)
        : undefined,
    analysisIpuMinDuration:
      Number.isFinite(analysisIpuMinDuration) && analysisIpuMinDuration >= 0
        ? analysisIpuMinDuration
        : undefined,
    analysisIpuBridgeShortGapsUnder:
      Number.isFinite(analysisIpuBridgeShortGapsUnder) && analysisIpuBridgeShortGapsUnder >= 0
        ? analysisIpuBridgeShortGapsUnder
        : undefined,
    hfToken: source.hfToken.trim() || undefined,
    outputFormat: source.outputFormat,
    noAlign: source.noAlign,
    externalWordTimingsJson: source.externalWordTimingsJson.trim() || undefined,
    externalWordTimingsStrict: source.externalWordTimingsStrict ? true : undefined,
    vadMethod: source.vadMethod,
    printProgress: source.printProgress,
    analysisSpeakerTurnPostprocessPreset:
      source.analysisSpeakerTurnPostprocessPreset.trim() || undefined,
    analysisSpeakerTurnMergeGapSecMax: stMerge !== null && stMerge >= 0 ? stMerge : undefined,
    analysisSpeakerTurnSplitWordGapSec: stSplit !== null && stSplit > 0 ? stSplit : undefined,
    analysisWordTimestampStabilizeMode:
      source.analysisWordTimestampStabilizeMode !== "off"
        ? source.analysisWordTimestampStabilizeMode
        : undefined,
    analysisWordTsNeighborRatioLow: wrl !== null && wrl > 0 ? wrl : undefined,
    analysisWordTsNeighborRatioHigh: wrh !== null && wrh > 1 ? wrh : undefined,
    analysisWordTsSmoothMaxSec: wsm !== null && wsm > 0 ? wsm : undefined,
    ...(apm ? { audioPipelineModules: apm } : {}),
    ...(aps ? { audioPipelineSegments: aps } : {}),
  };
}

export function normalizeExportRules(source: ExportTimingRules): ExportTimingRules {
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

export function isPreviewableFile(path: string): boolean {
  const lower = path.toLowerCase();
  return [".json", ".srt", ".vtt", ".txt", ".tsv", ".aud", ".log", ".md", ".csv"].some((ext) =>
    lower.endsWith(ext),
  );
}

export function isVideoFile(path: string): boolean {
  const lower = path.toLowerCase();
  return [".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v"].some((ext) => lower.endsWith(ext));
}

export function formatClockSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00.000";
  }
  const totalMs = Math.round(seconds * 1000);
  const mins = Math.floor(totalMs / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * Parse un timecode saisi par l’utilisateur (Player, navigateur) : secondes décimales, `mm:ss`, `hh:mm:ss`.
 * Virgule ou point pour les décimales.
 */
export function parsePlayerTimecodeToSeconds(raw: string): number | null {
  const s = raw.trim();
  if (!s) {
    return null;
  }
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length === 1) {
    const n = Number(parts[0].replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const sec = Number(parts[1].replace(",", "."));
    if (!Number.isFinite(m) || !Number.isFinite(sec) || m < 0 || sec < 0) {
      return null;
    }
    return m * 60 + sec;
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const sec = Number(parts[2].replace(",", "."));
    if (
      !Number.isFinite(h) ||
      !Number.isFinite(m) ||
      !Number.isFinite(sec) ||
      h < 0 ||
      m < 0 ||
      sec < 0
    ) {
      return null;
    }
    return h * 3600 + m * 60 + sec;
  }
  return null;
}

export function closestSegmentIndex(segments: EditableSegment[], timeSec: number): number | null {
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
      if (distance < 1e-6) {
        break;
      }
    }
  }
  return bestIndex;
}

export function roundSecondsMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

export function splitSegmentText(text: string): [string, string] {
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

export function joinSegmentTexts(left: string, right: string): string {
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

export function cloneEditableSegments(segments: EditableSegment[]): EditableSegment[] {
  return segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
    speaker: segment.speaker ?? undefined,
  }));
}

export function buildEditorSnapshot(language: string, segments: EditableSegment[]): EditorSnapshot {
  return {
    language,
    segments: cloneEditableSegments(segments),
  };
}

export function cloneEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return buildEditorSnapshot(snapshot.language, snapshot.segments);
}

export function areSegmentsEqual(left: EditableSegment[], right: EditableSegment[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) {
      return false;
    }
    if (a.start !== b.start || a.end !== b.end || a.text !== b.text) {
      return false;
    }
    const aSpeaker = a.speaker ?? "";
    const bSpeaker = b.speaker ?? "";
    if (aSpeaker !== bSpeaker) {
      return false;
    }
  }
  return true;
}

export function areEditorSnapshotsEqual(left: EditorSnapshot, right: EditorSnapshot): boolean {
  return left.language === right.language && areSegmentsEqual(left.segments, right.segments);
}

export function countSegmentWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function buildTranscriptQaIssues(
  segments: EditableSegment[],
  gapThresholdSec: number,
  minWps: number,
  maxWps: number,
): TranscriptQaIssue[] {
  const issues: TranscriptQaIssue[] = [];
  const safeGap = Math.max(0, gapThresholdSec);
  const safeMinWps = Math.max(0.1, minWps);
  const safeMaxWps = Math.max(safeMinWps, maxWps);

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }
    const duration = segment.end - segment.start;
    const words = countSegmentWords(segment.text);

    if (duration <= 0) {
      issues.push({
        id: `invalid_duration-${i}`,
        type: "invalid_duration",
        severity: "error",
        segmentIndex: i,
        message: `Duree invalide (${duration.toFixed(3)}s).`,
        canAutoFix: true,
      });
    }

    if (!segment.text.trim()) {
      issues.push({
        id: `empty_text-${i}`,
        type: "empty_text",
        severity: "warning",
        segmentIndex: i,
        message: "Texte vide.",
        canAutoFix: true,
      });
    }

    if (duration > 0.000001 && words > 0) {
      const wps = words / duration;
      if (wps > safeMaxWps) {
        issues.push({
          id: `speech_rate_high-${i}`,
          type: "speech_rate_high",
          severity: "warning",
          segmentIndex: i,
          message: `Debit eleve (${wps.toFixed(2)} mots/s > ${safeMaxWps.toFixed(2)}).`,
          canAutoFix: true,
        });
      } else if (wps < safeMinWps && words >= QA_SPEECH_RATE_LOW_MIN_WORDS) {
        issues.push({
          id: `speech_rate_low-${i}`,
          type: "speech_rate_low",
          severity: "warning",
          segmentIndex: i,
          message: `Debit faible (${wps.toFixed(2)} mots/s < ${safeMinWps.toFixed(2)}).`,
          canAutoFix: true,
        });
      }
    }

    if (i === 0) {
      continue;
    }
    const previous = segments[i - 1];
    if (!previous) {
      continue;
    }
    const delta = segment.start - previous.end;
    if (delta < -0.000001) {
      issues.push({
        id: `overlap-${i - 1}-${i}`,
        type: "overlap",
        severity: "error",
        segmentIndex: i,
        relatedSegmentIndex: i - 1,
        message: `Overlap de ${Math.abs(delta).toFixed(3)}s avec segment #${i + 1}.`,
        canAutoFix: true,
      });
    } else if (delta > safeGap) {
      issues.push({
        id: `gap-${i - 1}-${i}`,
        type: "gap",
        severity: "warning",
        segmentIndex: i,
        relatedSegmentIndex: i - 1,
        message: `Gap de ${delta.toFixed(3)}s (seuil ${safeGap.toFixed(3)}s).`,
        canAutoFix: true,
      });
    }
  }
  return issues;
}

export function isRuntimeReady(status: RuntimeStatus | null): boolean {
  if (!status) {
    return false;
  }
  return status.pythonOk && status.whisperxOk && status.ffmpegOk;
}

export function runtimeMissingComponents(status: RuntimeStatus | null): string[] {
  if (!status) {
    return ["Python", "WhisperX", "ffmpeg"];
  }
  const missing: string[] = [];
  if (!status.pythonOk) {
    missing.push("Python");
  }
  if (!status.whisperxOk) {
    missing.push("WhisperX");
  }
  if (!status.ffmpegOk) {
    missing.push("ffmpeg");
  }
  return missing;
}

/**
 * ffmpeg n’est pas installé par l’assistant « runtime local » (venv + WhisperX uniquement).
 */
export function runtimeFfmpegInstallHint(): string {
  return (
    "Dans le panneau Runtime, utilise « Installer ffmpeg (automatique) » si Homebrew, winget ou Chocolatey est disponible. " +
    "Sinon : macOS « brew install ffmpeg », Windows winget/choco, ou variables FFMPEG_BINARY / FFPROBE_BINARY. " +
    "L’app cherche aussi /opt/homebrew/bin et /usr/local/bin."
  );
}

export function qaIssueLabel(type: TranscriptQaIssueType): string {
  switch (type) {
    case "invalid_duration":
      return "Duree invalide";
    case "overlap":
      return "Overlap";
    case "gap":
      return "Gap";
    case "speech_rate_high":
      return "Debit eleve";
    case "speech_rate_low":
      return "Debit faible";
    case "empty_text":
      return "Texte vide";
    default:
      return type;
  }
}

const TRANSCRIPT_JSON_META_SUFFIXES = [".timeline.json", ".run.json", ".words.json"];

/**
 * Identifie le JSON transcript principal parmi les fichiers de sortie.
 * Exclut les fichiers d'analyse / métadonnées (.timeline.json, .run.json, etc.)
 */
export function findPrimaryTranscriptJson(outputFiles: string[]): string | null {
  const candidates = outputFiles.filter((p) => {
    const lower = p.toLowerCase();
    if (!lower.endsWith(".json")) return false;
    return !TRANSCRIPT_JSON_META_SUFFIXES.some((s) => lower.endsWith(s));
  });
  return candidates[0] ?? null;
}
