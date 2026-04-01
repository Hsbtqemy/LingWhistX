import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { runInTransition } from "../../whisperxOptionsTransitions";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  clampNumber,
  fileBasename,
  formatClockSeconds,
  joinPathSegments,
  parsePlayerTimecodeToSeconds,
} from "../../appUtils";
import { useWaveformCanvas } from "../../hooks/useWaveformCanvas";
import { useWaveformWorkspace } from "../../hooks/useWaveformWorkspace";
import { useTranscriptEditor } from "../../hooks/useTranscriptEditor";
import { usePlayerPlayback } from "../../hooks/usePlayerPlayback";
import { usePlayerKeyboard, type UsePlayerKeyboardOptions } from "../../hooks/usePlayerKeyboard";
import { usePlayerRunWindow } from "../../hooks/usePlayerRunWindow";
import { derivePlayerAlerts } from "../../player/derivePlayerAlerts";
import type { PlayerDerivedAlertKind } from "../../player/derivePlayerAlerts";
import type {
  AnnotationTier,
  EditableSegment,
  ExportRunTimingPackResponse,
  ImportAnnotationResult,
  RecomputePlayerAlertsResponse,
  RecomputePlayerAlertsStats,
  StudioView,
} from "../../types";
import type { PlayerDerivedAlert } from "../../player/derivePlayerAlerts";
import { PlayerRunWindowViews, type PlayerViewportMode } from "./PlayerRunWindowViews";
import {
  VIEWPORT_QUERY_CONTRACTS,
  type ViewportQueryContract,
} from "./playerViewportContract";
import {
  buildFullStatsCsv,
  buildFullStatsExport,
  computeOverlaps,
  computeSpeakerStats,
  computeSpeechDensity,
  computeSpeechRate,
  computeTransitions,
} from "../../player/playerSpeakerStats";
import { PlayerJumpPanel } from "./PlayerJumpPanel";
import { PlayerMediaTransport } from "./PlayerMediaTransport";
import { PlayerTopBar } from "./PlayerTopBar";
import { PlayerRunArtifactsStrip } from "./PlayerRunArtifactsStrip";
import { PlayerWaveformPanel } from "./PlayerWaveformPanel";
import { PlayerFullscreenView } from "./PlayerFullscreenView";
import { ErrorBanner } from "../ErrorBanner";
import { NewJobDropZone } from "../NewJobDropZone";
import { Button } from "../ui";

function findPrevSegmentStart(segments: EditableSegment[], playheadSec: number): number | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].start < playheadSec - 0.08) return segments[i].start;
  }
  return null;
}

function findNextSegmentStart(segments: EditableSegment[], playheadSec: number): number | null {
  for (const seg of segments) {
    if (seg.start > playheadSec + 0.08) return seg.start;
  }
  return null;
}

function findActiveSpeaker(segments: EditableSegment[], playheadSec: number): string | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.start <= playheadSec + 0.05 && seg.end >= playheadSec - 0.05) {
      return seg.speaker ?? null;
    }
  }
  return null;
}

/** Import média depuis l’état vide Player — même état que « Nouveau job » puis bascule Studio. */
export type PlayerWorkspaceSectionImportMediaProps = {
  inputPath: string;
  isSubmitting: boolean;
  onPickFile: () => void | Promise<void>;
  onDroppedPath: (path: string) => void;
  onImportError: (message: string) => void;
};

export type PlayerWorkspaceSectionProps = {
  runDir: string | null;
  runLabel?: string | null;
  onBack: (view: StudioView) => void;
  importMedia?: PlayerWorkspaceSectionImportMediaProps;
  /** WX-696 — Incrémenter pour forcer un rechargement de la fenêtre events (annotation tiers). */
  eventsRefreshEpoch?: number;
  /** Ouvre directement le Player en mode édition (depuis le bouton Vérification → Player). */
  initialEditMode?: boolean;
};

type AlertListFilter = "all" | PlayerDerivedAlertKind;

/**
 * Player multi-vues (WX-624) — layout TopBar + colonnes + viewport ; transport via usePlayerPlayback.
 */
export function PlayerWorkspaceSection({
  runDir,
  runLabel,
  onBack,
  importMedia,
  eventsRefreshEpoch = 0,
  initialEditMode = false,
}: PlayerWorkspaceSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewportMode, setViewportMode] = useState<PlayerViewportMode>("lanes");
  const [wordsWindowEnabled, setWordsWindowEnabled] = useState(false);
  const [exportFolderError, setExportFolderError] = useState("");
  const [exportPackBusy, setExportPackBusy] = useState(false);
  const [exportPackError, setExportPackError] = useState("");
  const [exportPackHint, setExportPackHint] = useState("");
  const [exportFormatMenuOpen, setExportFormatMenuOpen] = useState(false);
  const [exportSingleBusy, setExportSingleBusy] = useState(false);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [speakerSolo, setSpeakerSolo] = useState<string | null>(null);
  const [runSpeakerIds, setRunSpeakerIds] = useState<string[]>([]);
  const [alertListFilter, setAlertListFilter] = useState<AlertListFilter>("all");
  const [longPauseMs, setLongPauseMs] = useState(3000);
  const [ipcAlerts, setIpcAlerts] = useState<PlayerDerivedAlert[] | null>(null);
  const [recomputeBusy, setRecomputeBusy] = useState(false);
  const [recomputeError, setRecomputeError] = useState("");
  const [lastRecomputeStats, setLastRecomputeStats] = useState<RecomputePlayerAlertsStats | null>(
    null,
  );
  const [jumpTimeInput, setJumpTimeInput] = useState("");
  const [jumpTimeError, setJumpTimeError] = useState("");
  const [copyPositionHint, setCopyPositionHint] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const eventsPanelRef = useRef<HTMLDivElement | null>(null);
  const programmaticPanelScrollRef = useRef(false);
  const copyPositionHintTimeoutRef = useRef<number | null>(null);
  const shortcutsHelpPanelRef = useRef<HTMLDivElement | null>(null);
  const pb = usePlayerPlayback(runDir);

  const {
    manifestLoading,
    manifestError,
    mediaLoadError,
    summary,
    mediaSrc,
    mediaPath,
    isVideo,
    durationSec,
    currentTimeSec,
    playing,
    playbackRate,
    loopAsec,
    loopBsec,
    setLoopRange,
    mediaRef,
    mediaHandlers,
    togglePlayPause,
    stop,
    seek,
    seekRelative,
    nudgePlaybackRate,
    markLoopA,
    markLoopB,
    clearLoop,
    volume,
    muted,
    setVolume,
    setMuted,
    toggleMute,
  } = pb;

  const wf = useWaveformWorkspace({
    selectedJob: null,
    selectedJobId: runDir ? `player:${runDir}` : "player-idle",
    selectedIsVideo: isVideo,
    previewMediaPath: mediaPath,
    playerMediaRef: mediaRef,
  });

  const [editMode, setEditMode] = useState(initialEditMode);
  const [waveformCompact, setWaveformCompact] = useState(true);

  const noopRefreshJobs = useCallback(async () => {}, []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const noopPreviewOutput = useCallback(async (_path: string) => {}, []);

  const te = useTranscriptEditor({
    wf,
    refreshJobs: noopRefreshJobs,
    previewOutput: noopPreviewOutput,
    selectedJobId: runDir ? `player:${runDir}` : "player-idle",
  });

  const [transcriptJsonPath, setTranscriptJsonPath] = useState<string | null>(null);

  useEffect(() => {
    setTranscriptJsonPath(null);
    if (!runDir) return;
    let cancelled = false;
    void (async () => {
      try {
        const path = await invoke<string | null>("find_run_transcript_json", { runDir });
        if (!cancelled) setTranscriptJsonPath(path);
      } catch {
        if (!cancelled) setTranscriptJsonPath(null);
      }
    })();
    return () => { cancelled = true; };
  }, [runDir]);

  const transcriptLoadedForRef = useRef<string | null>(null);
  const loadTranscriptEditorRef = useRef(te.loadTranscriptEditor);
  loadTranscriptEditorRef.current = te.loadTranscriptEditor;
  const autoEnabledForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!transcriptJsonPath) return;
    if (autoEnabledForRef.current !== transcriptJsonPath) {
      autoEnabledForRef.current = transcriptJsonPath;
      setEditMode(true);
    }
    if (transcriptLoadedForRef.current === transcriptJsonPath) return;
    transcriptLoadedForRef.current = transcriptJsonPath;
    void loadTranscriptEditorRef.current(transcriptJsonPath);
  }, [transcriptJsonPath]);

  useEffect(() => {
    setEditMode(initialEditMode);
    transcriptLoadedForRef.current = null;
    autoEnabledForRef.current = null;
  }, [runDir, initialEditMode]);

  // ── Annotation import (EAF / TextGrid) directly in the Player ──
  const [annotImporting, setAnnotImporting] = useState(false);
  const [annotError, setAnnotError] = useState<string | null>(null);
  const [annotPending, setAnnotPending] = useState<ImportAnnotationResult | null>(null);
  const [annotSelectedTiers, setAnnotSelectedTiers] = useState<Set<string>>(new Set());

  const handleAnnotImport = useCallback(async () => {
    setAnnotError(null);
    const selected = await openDialog({
      title: "Importer une annotation (.eaf / .TextGrid)",
      filters: [{ name: "Annotation", extensions: ["eaf", "TextGrid"] }],
      multiple: false,
      directory: false,
    });
    if (!selected || typeof selected !== "string") return;

    setAnnotImporting(true);
    try {
      const result = await invoke<ImportAnnotationResult>("import_annotation_file", { path: selected });
      if (result.tiers.length === 0) {
        setAnnotError("Aucun tier trouvé dans ce fichier.");
        return;
      }
      if (result.tiers.length === 1) {
        const tier = result.tiers[0];
        te.loadAnnotationTier(tier.tierId, tier.segments);
        setEditMode(true);
        if (runDir) {
          void invoke("write_annotation_tiers_to_events", {
            runDir,
            tiers: [{ tierId: tier.tierId, segments: tier.segments }],
          }).catch(() => {});
        }
      } else {
        setAnnotPending(result);
        setAnnotSelectedTiers(new Set(result.tiers.map((t) => t.tierId)));
      }
    } catch (err) {
      setAnnotError(String(err));
    } finally {
      setAnnotImporting(false);
    }
  }, [te, runDir]);

  const handleAnnotConfirm = useCallback(() => {
    if (!annotPending) return;
    const toLoad = annotPending.tiers.filter((t) => annotSelectedTiers.has(t.tierId));
    for (const tier of toLoad) {
      te.loadAnnotationTier(tier.tierId, tier.segments);
    }
    setEditMode(true);
    if (runDir && toLoad.length > 0) {
      void invoke("write_annotation_tiers_to_events", {
        runDir,
        tiers: toLoad.map((t) => ({ tierId: t.tierId, segments: t.segments })),
      }).catch(() => {});
    }
    setAnnotPending(null);
    setAnnotSelectedTiers(new Set());
  }, [annotPending, annotSelectedTiers, te, runDir]);

  const toggleAnnotTier = useCallback((tierId: string) => {
    setAnnotSelectedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) next.delete(tierId);
      else next.add(tierId);
      return next;
    });
  }, []);

  const pauseCsvPaths = useMemo(() => {
    if (!runDir || !summary?.artifactKeys?.length) {
      return [];
    }
    return summary.artifactKeys
      .filter((k) => k.toLowerCase().endsWith(".pauses.csv"))
      .map((k) => joinPathSegments(runDir, k));
  }, [runDir, summary?.artifactKeys]);

  const runWindowEnabled = Boolean(runDir && !manifestLoading && !manifestError);

  // WX-660 : contrat de vue — tables et fenêtre dédiées par mode.
  // `wordsWindowEnabled` force la couche words sur toute vue (toggle UI existant).
  const queryContract: ViewportQueryContract = (() => {
    const base = VIEWPORT_QUERY_CONTRACTS[viewportMode];
    if (wordsWindowEnabled && !base.layers.words) {
      return {
        queryPreset: "words_detail" as const,
        layers: { ...base.layers, words: true },
      };
    }
    return base;
  })();

  const wordsLayerActive = queryContract.layers.words;

  const runWindow = usePlayerRunWindow({
    runDir,
    centerTimeSec: currentTimeSec,
    enabled: runWindowEnabled,
    queryContract,
    speakersFilter: speakerSolo ? [speakerSolo] : null,
    refreshEpoch: eventsRefreshEpoch,
  });

  // WX-725 — overlay turns/segments sur la waveform (édition → editor segs, sinon → tours SQL)
  const overlaySegments = useMemo((): EditableSegment[] => {
    if (editMode) return te.editorSegments;
    return (
      runWindow.slice?.turns.map((t) => ({
        start: t.startMs / 1000,
        end: t.endMs / 1000,
        text: "",
        speaker: t.speaker,
      })) ?? []
    );
  }, [editMode, te.editorSegments, runWindow.slice]);

  useWaveformCanvas(
    wf,
    overlaySegments,
    editMode ? te.focusedSegmentIndex : null,
    editMode ? te.hoveredSegmentEdge : null,
    editMode ? te.dragSegmentState : null,
    loopAsec,
    loopBsec,
    waveformCompact,
  );

  // WX-725 — sync transport → waveform : le canvas lit wf.mediaCurrentSec, pas currentTimeSec
  // webAudioMode (audio) : la position courante vient du Web Audio, pas du timeupdate natif
  useEffect(() => {
    if (wf.webAudioMode && !isVideo) return;
    wf.setMediaCurrentSec(currentTimeSec);
  }, [currentTimeSec, isVideo, wf.setMediaCurrentSec, wf.webAudioMode]);

  // WX-725 — follow playhead : scroll waveform pour garder le playhead visible
  useEffect(() => {
    if (!followPlayhead || !wf.waveform) return;
    const visibleDur = wf.waveformVisibleDurationSec;
    const margin = visibleDur * 0.08;
    if (currentTimeSec < wf.waveformViewStartSec + margin || currentTimeSec > wf.waveformViewEndSec - margin) {
      const idealStart = currentTimeSec - visibleDur * 0.3;
      wf.setWaveformViewStart(Math.max(0, Math.min(wf.waveformMaxViewStartSec, idealStart)));
    }
  }, [currentTimeSec, followPlayhead, wf.waveform, wf.waveformVisibleDurationSec, wf.waveformViewStartSec, wf.waveformViewEndSec, wf.waveformMaxViewStartSec, wf.setWaveformViewStart]);

  const derivedAlertsFromTs = useMemo(
    () => (runWindow.slice ? derivePlayerAlerts(runWindow.slice, { longPauseMs }) : []),
    [runWindow.slice, longPauseMs],
  );

  useEffect(() => {
    setIpcAlerts(null);
    setLastRecomputeStats(null);
  }, [runDir, runWindow.slice?.t0Ms, runWindow.slice?.t1Ms, speakerSolo, longPauseMs]);

  const derivedAlerts = ipcAlerts ?? derivedAlertsFromTs;

  const recomputePlayerAlertsIpc = useCallback(async () => {
    if (!runDir || !runWindow.slice) {
      return;
    }
    setRecomputeError("");
    setRecomputeBusy(true);
    try {
      const r = await invoke<RecomputePlayerAlertsResponse>("recompute_player_alerts", {
        request: {
          runDir,
          t0Ms: runWindow.slice.t0Ms,
          t1Ms: runWindow.slice.t1Ms,
          longPauseMs,
          queryPreset: runWindow.queryPreset,
          speakers: speakerSolo ? [speakerSolo] : [],
        },
      });
      setIpcAlerts(r.alerts as PlayerDerivedAlert[]);
      setLastRecomputeStats(r.stats);
    } catch (e) {
      setRecomputeError(String(e));
      setIpcAlerts(null);
    } finally {
      setRecomputeBusy(false);
    }
  }, [runDir, runWindow.slice, runWindow.queryPreset, speakerSolo, longPauseMs]);

  const displayedAlerts = useMemo(() => {
    if (alertListFilter === "all") {
      return derivedAlerts;
    }
    return derivedAlerts.filter((a) => a.kind === alertListFilter);
  }, [derivedAlerts, alertListFilter]);

  const playheadMs = Math.round(currentTimeSec * 1000);

  const durationMs = durationSec != null && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec * 1000
    : 0;

  useEffect(() => {
    if (!editMode || !te.editorSegments.length) return;
    const segs = te.editorSegments;

    // Try temporal matching first
    let best: number | null = null;
    for (let i = 0; i < segs.length; i++) {
      const sMs = Math.round(segs[i].start * 1000);
      const eMs = Math.round(segs[i].end * 1000);
      if (playheadMs >= sMs && playheadMs < eMs) {
        best = i;
        break;
      }
    }

    // Fallback: proportional mapping when timestamps are corrupted
    if (best === null && durationMs > 0) {
      const lastEnd = Math.round(segs[segs.length - 1].end * 1000);
      const firstStart = Math.round(segs[0].start * 1000);
      const span = lastEnd - firstStart;
      if (span > durationMs * 2 || firstStart > durationMs) {
        const ratio = clampNumber(playheadMs / durationMs, 0, 1);
        best = Math.min(Math.floor(ratio * segs.length), segs.length - 1);
      }
    }

    if (best !== null && best !== te.activeSegmentIndex) {
      te.setActiveSegmentIndex(best);
    }
  }, [editMode, playheadMs, durationMs, te.editorSegments, te.activeSegmentIndex, te.setActiveSegmentIndex]);

  const qcSummary = useMemo(() => {
    const parts: string[] = [];
    const nOv = derivedAlerts.filter((a) => a.kind === "overlap_turn").length;
    const nPa = derivedAlerts.filter((a) => a.kind === "long_pause").length;
    parts.push(`${derivedAlerts.length} alerte${derivedAlerts.length === 1 ? "" : "s"}`);
    if (derivedAlerts.length > 0) {
      parts.push(`${nOv} chev. · ${nPa} pause${nPa === 1 ? "" : "s"}`);
    }
    const ns = summary?.statsNSegments;
    const nt = summary?.statsNSpeakerTurns;
    const nw = summary?.statsNWords;
    const statBits = [
      ns != null ? `${ns} seg.` : null,
      nt != null ? `${nt} tours` : null,
      nw != null ? `~${nw} mots` : null,
    ].filter(Boolean) as string[];
    if (statBits.length > 0) {
      parts.push(statBits.join(" · "));
    }
    const nwarnings = summary?.warnings?.length ?? 0;
    if (nwarnings > 0) {
      parts.push(`${nwarnings} avert. manifest`);
    }
    const tr = runWindow.slice?.truncated;
    if (tr && (tr.words || tr.turns || tr.pauses || tr.ipus)) {
      parts.push("troncature fenêtre");
    }
    return parts.join(" · ");
  }, [derivedAlerts, runWindow.slice?.truncated, summary]);

  const sliceTruncationLayers = useMemo(() => {
    const tr = runWindow.slice?.truncated;
    if (!tr) {
      return null;
    }
    const parts: string[] = [];
    if (tr.words) {
      parts.push("mots");
    }
    if (tr.turns) {
      parts.push("tours");
    }
    if (tr.pauses) {
      parts.push("pauses");
    }
    if (tr.ipus) {
      parts.push("IPU");
    }
    return parts.length > 0 ? parts : null;
  }, [runWindow.slice?.truncated]);

  const openRunFolder = useCallback(async () => {
    if (!runDir) {
      return;
    }
    setExportFolderError("");
    try {
      await invoke("open_local_path", { path: runDir });
    } catch (e) {
      setExportFolderError(String(e));
    }
  }, [runDir]);

  const exportRunTimingPack = useCallback(async () => {
    if (!runDir) {
      return;
    }
    setExportPackError("");
    setExportPackHint("");
    setExportPackBusy(true);
    try {
      const r = await invoke<ExportRunTimingPackResponse>("export_run_timing_pack", {
        request: { runDir },
      });
      setExportPackHint(`Pack exporté (JSON+SRT+VTT+CSV) · ${r.lastOutputPath}`);
    } catch (e) {
      setExportPackError(String(e));
    } finally {
      setExportPackBusy(false);
    }
  }, [runDir]);

  type ExportFormat = "json" | "srt" | "vtt" | "txt" | "csv" | "textgrid" | "eaf";

  const exportSingleFormat = useCallback(async (format: ExportFormat) => {
    setExportPackError("");
    setExportPackHint("");
    setExportSingleBusy(true);
    try {
      await te.exportEditedTranscript(format);
      setExportFormatMenuOpen(false);
    } catch (e) {
      setExportPackError(String(e));
    } finally {
      setExportSingleBusy(false);
    }
  }, [te]);

  useEffect(() => {
    setSpeakerSolo(null);
    setAlertListFilter("all");
    setJumpTimeInput("");
    setJumpTimeError("");
  }, [runDir]);

  const commitJumpToTime = useCallback(() => {
    setJumpTimeError("");
    const sec = parsePlayerTimecodeToSeconds(jumpTimeInput);
    if (sec == null) {
      setJumpTimeError("Ex. 42,5 · 1:02 · 1:02:03");
      return;
    }
    const maxSec = durationSec != null && Number.isFinite(durationSec) ? durationSec : sec;
    seek(clampNumber(sec, 0, Math.max(0, maxSec)));
    setJumpTimeInput("");
  }, [jumpTimeInput, durationSec, seek]);

  useEffect(() => {
    if (!runDir || !runWindowEnabled) {
      setRunSpeakerIds([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ids = await invoke<string[]>("list_run_speakers", { runDir });
        if (!cancelled) {
          setRunSpeakerIds([...ids].sort());
        }
      } catch {
        if (!cancelled) {
          setRunSpeakerIds([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runDir, runWindowEnabled]);

  useEffect(() => {
    if (!wordsWindowEnabled && viewportMode === "words" && !editMode) {
      setViewportMode("lanes");
    }
  }, [wordsWindowEnabled, viewportMode, editMode]);

  const followScrollKey = Math.floor(playheadMs / 250);
  const followResyncKey = `${viewportMode}-${runWindow.slice?.t0Ms ?? 0}-${runWindow.slice?.t1Ms ?? 0}`;

  useEffect(() => {
    if (!followPlayhead) {
      return;
    }
    const root = eventsPanelRef.current;
    if (!root) {
      return;
    }
    const target = root.querySelector(".is-active");
    if (!target || !(target instanceof HTMLElement)) {
      return;
    }
    programmaticPanelScrollRef.current = true;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    const t = window.setTimeout(() => {
      programmaticPanelScrollRef.current = false;
    }, 450);
    return () => window.clearTimeout(t);
  }, [followPlayhead, followScrollKey, followResyncKey]);

  const onEventsPanelScroll = useCallback(() => {
    if (programmaticPanelScrollRef.current) {
      return;
    }
    setFollowPlayhead(false);
  }, []);

  const durLabel = formatClockSeconds(durationSec ?? 0);
  const posLabel = formatClockSeconds(currentTimeSec);

  const copyPlayheadToClipboard = useCallback(async () => {
    if (!mediaSrc || manifestError || mediaLoadError) {
      return;
    }
    const text = formatClockSeconds(currentTimeSec);
    try {
      await navigator.clipboard.writeText(text);
      if (copyPositionHintTimeoutRef.current != null) {
        window.clearTimeout(copyPositionHintTimeoutRef.current);
      }
      setCopyPositionHint(true);
      copyPositionHintTimeoutRef.current = window.setTimeout(() => {
        setCopyPositionHint(false);
        copyPositionHintTimeoutRef.current = null;
      }, 1600);
    } catch {
      /* presse-papiers indisponible */
    }
  }, [currentTimeSec, mediaSrc, manifestError, mediaLoadError]);

  const toggleVideoFullscreen = useCallback(async () => {
    const el = mediaRef.current;
    if (!el || !isVideo) {
      return;
    }
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* navigateur refuse */
    }
  }, [isVideo, mediaRef]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const onFs = () => {
      const el = mediaRef.current;
      setVideoFullscreen(Boolean(el && document.fullscreenElement === el));
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [mediaSrc, mediaRef]);

  useEffect(() => {
    return () => {
      if (copyPositionHintTimeoutRef.current != null) {
        window.clearTimeout(copyPositionHintTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!shortcutsHelpOpen || typeof document === "undefined") {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [shortcutsHelpOpen]);

  useEffect(() => {
    if (!fullscreenMode || typeof document === "undefined") {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenMode]);

  useEffect(() => {
    if (!shortcutsHelpOpen) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      shortcutsHelpPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [shortcutsHelpOpen]);

  const loopHint =
    loopAsec != null && loopBsec != null && loopBsec > loopAsec
      ? `A ${formatClockSeconds(loopAsec)} → B ${formatClockSeconds(loopBsec)}`
      : "A–B : —";

  const transportDisabled = !mediaSrc || !!manifestError;

  const keyboardOptions = useMemo(
    (): UsePlayerKeyboardOptions => ({
      shortcutsHelpOpen,
      setShortcutsHelpOpen,
      togglePlayPause,
      copyPlayheadToClipboard,
      exportRunTimingPack,
      exportPackBusy,
      openRunFolder,
      runDir,
      stop,
      seek,
      seekRelative,
      durationSec,
      mediaSrc,
      manifestError,
      mediaLoadError,
      nudgePlaybackRate,
      setViewportMode,
      displayedAlerts,
      playheadMs,
      setFollowPlayhead,
      setWordsWindowEnabled,
      toggleMute,
      toggleVideoFullscreen,
      isVideo,
      loopAsec,
      loopBsec,
      markLoopA,
      markLoopB,
      clearLoop,
      runSpeakerIds,
      setSpeakerSolo,
      fullscreenMode,
      setFullscreenMode,
      editorSegments: editMode ? te.editorSegments : undefined,
    }),
    [
      shortcutsHelpOpen,
      setShortcutsHelpOpen,
      togglePlayPause,
      copyPlayheadToClipboard,
      exportRunTimingPack,
      exportPackBusy,
      openRunFolder,
      runDir,
      stop,
      seek,
      seekRelative,
      durationSec,
      mediaSrc,
      manifestError,
      mediaLoadError,
      nudgePlaybackRate,
      setViewportMode,
      displayedAlerts,
      playheadMs,
      setFollowPlayhead,
      setWordsWindowEnabled,
      toggleMute,
      toggleVideoFullscreen,
      isVideo,
      loopAsec,
      loopBsec,
      markLoopA,
      markLoopB,
      clearLoop,
      runSpeakerIds,
      setSpeakerSolo,
      fullscreenMode,
      setFullscreenMode,
      editMode,
      te.editorSegments,
    ],
  );

  const onPlayerKeyDown = usePlayerKeyboard(keyboardOptions);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editMode) {
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
          if (e.key === "z" && !e.shiftKey) {
            e.preventDefault();
            te.undoEditorChange();
            return;
          }
          if (e.key === "z" && e.shiftKey) {
            e.preventDefault();
            te.redoEditorChange();
            return;
          }
          if (e.key === "s") {
            e.preventDefault();
            void te.saveEditedJson(true);
            return;
          }
        }
      }
      onPlayerKeyDown(e as React.KeyboardEvent<HTMLDivElement>);
    },
    [editMode, te, onPlayerKeyDown],
  );

  useEffect(() => {
    rootRef.current?.focus();
  }, [runDir]);

  return (
    <div
      ref={rootRef}
      className="player-workspace"
      tabIndex={0}
      role="application"
      aria-label="Lecteur multi-vues"
      onKeyDown={onKeyDown}
    >
      <div className="player-workspace-top">
        <PlayerTopBar
          onBack={() => onBack("create")}
          runLabel={runLabel ?? "Player"}
          runDir={runDir}
          mediaPath={mediaPath}
          shortcutsHelpOpen={shortcutsHelpOpen}
          onToggleShortcutsHelp={() => setShortcutsHelpOpen((v) => !v)}
        />
        {runDir && (
          <div className="player-loop-bar">
            <span className="player-loop-bar-hint small mono">{loopHint}</span>
            <button type="button" className="ghost small" onClick={markLoopA} disabled={transportDisabled}>
              Marquer A
            </button>
            <button type="button" className="ghost small" onClick={markLoopB} disabled={transportDisabled}>
              Marquer B
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={clearLoop}
              disabled={transportDisabled || (!loopAsec && !loopBsec)}
            >
              Effacer boucle
            </button>
          </div>
        )}
        {runDir && summary && summary.artifactKeys.length > 0 ? (
          <PlayerRunArtifactsStrip runDir={runDir} artifactKeys={summary.artifactKeys} />
        ) : null}
        {mediaLoadError ? (
          <ErrorBanner>
            <p className="error-banner-text">{mediaLoadError}</p>
          </ErrorBanner>
        ) : null}
      </div>

      {!runDir ? (
        <div className="player-empty player-empty--no-run">
          <div
            className="empty-state-card empty-state-card--compact"
            role="status"
            aria-labelledby="player-empty-no-run-title"
          >
            <div className="empty-state-card-icon empty-state-card-icon--muted" aria-hidden />
            <h3 id="player-empty-no-run-title" className="empty-state-card-title">
              Aucun run ouvert pour la lecture
            </h3>
            <p className="empty-state-card-text">
              Lance un run dans le <strong>Studio</strong> — il s&apos;ouvrira automatiquement ici
              une fois terminé.
              <br />
              Tu peux aussi ouvrir un run existant depuis l&apos;<strong>Historique</strong> (fichiers
              de sortie → Ouvrir le Player) ou depuis le Studio (section{" "}
              <em>Ouvrir un run sur disque</em>).
            </p>
            {importMedia ? (
              <div className="player-empty-import">
                <p className="player-empty-import-hint">
                  <strong>Nouveau job</strong> — importe un média (glisser-déposer ou Parcourir) : tu
                  seras basculé vers le Studio pour les paramètres et le lancement.
                </p>
                <NewJobDropZone
                  selectedLabel={
                    importMedia.inputPath.trim()
                      ? fileBasename(importMedia.inputPath)
                      : undefined
                  }
                  disabled={importMedia.isSubmitting}
                  onPath={importMedia.onDroppedPath}
                  onError={importMedia.onImportError}
                />
                <div className="player-empty-import-row">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={importMedia.isSubmitting}
                    onClick={() => void importMedia.onPickFile()}
                  >
                    Parcourir un média
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="player-empty-cta">
              <Button type="button" variant="primary" onClick={() => onBack("workspace")}>
                Aller au Studio
              </Button>
              <Button type="button" variant="secondary" onClick={() => onBack("jobs")}>
                Historique des jobs
              </Button>
            </div>
          </div>
        </div>
      ) : manifestLoading ? (
        <div className="player-empty player-empty--loading" role="status" aria-busy="true">
          <p>Chargement du manifest…</p>
        </div>
      ) : manifestError ? (
        <div className="player-empty player-empty--error">
          <p>{manifestError}</p>
        </div>
      ) : (
        <div className="player-body">
          <aside className="player-panel player-panel--left">
            {/* ── 1. Vues ── */}
            <details className="player-panel-box" open>
              <summary className="player-panel-box-title">Vues</summary>
              <div className="player-view-grid" role="tablist" aria-label="Mode de vue">
                {([
                  ["lanes", "Lanes", "1"],
                  ["chat", "Chat", "2"],
                  ["words", "Mots", "3"],
                  ["columns", "Colonnes", "4"],
                  ["rythmo", "Rythmo", "5"],
                  ["karaoke", "Karaoké", "6"],
                  ["stats", "Stats", "7"],
                ] as const).map(([mode, label, key]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={viewportMode === mode}
                    className={`player-view-grid-btn${viewportMode === mode ? " is-active" : ""}`}
                    onClick={() => setViewportMode(mode)}
                    title={`⌃${key}`}
                  >
                    <span className="player-view-grid-key">{key}</span> {label}
                  </button>
                ))}
              </div>
            </details>

            {/* ── 2. Affichage ── */}
            <details className="player-panel-box" open>
              <summary className="player-panel-box-title">Affichage</summary>
              <label className="player-panel-toggle small">
                <input
                  type="checkbox"
                  checked={wordsWindowEnabled}
                  onChange={(e) => runInTransition(() => setWordsWindowEnabled(e.target.checked))}
                />
                Afficher les mots
              </label>
              <label className="player-panel-toggle small">
                <input
                  type="checkbox"
                  checked={followPlayhead}
                  onChange={(e) => runInTransition(() => setFollowPlayhead(e.target.checked))}
                />
                Suivre la lecture
              </label>
            </details>

            {/* ── 3. Édition ── */}
            <details className="player-panel-box" open>
              <summary className="player-panel-box-title">Édition</summary>
              {transcriptJsonPath ? (
                <label className="player-panel-toggle small">
                  <input
                    type="checkbox"
                    checked={editMode}
                    onChange={(e) => runInTransition(() => setEditMode(e.target.checked))}
                  />
                  Mode correction
                </label>
              ) : (
                <p className="small player-hint">
                  Aucun transcript — lancer un run.
                </p>
              )}
              {editMode && te.editorDirty ? (
                <span className="player-edit-dirty-badge small">Non sauvegardé</span>
              ) : null}
              <button
                type="button"
                className="ghost small player-panel-action-btn"
                disabled={annotImporting}
                onClick={() => void handleAnnotImport()}
                title="Importer un fichier EAF (ELAN) ou TextGrid (Praat)"
              >
                {annotImporting ? "Import…" : "Importer .eaf / .TextGrid"}
              </button>
              {annotError ? (
                <p className="player-import-annot-error small">{annotError}</p>
              ) : null}
              {annotPending ? (
                <div className="player-import-annot-picker">
                  <p className="small">
                    {annotPending.tiers.length} tiers — sélectionner :
                  </p>
                  <ul className="player-import-annot-list">
                    {annotPending.tiers.map((tier: AnnotationTier) => (
                      <li key={tier.tierId}>
                        <label className="small">
                          <input
                            type="checkbox"
                            checked={annotSelectedTiers.has(tier.tierId)}
                            onChange={() => toggleAnnotTier(tier.tierId)}
                          />
                          {tier.tierId}{" "}
                          <span className="mono">({tier.segments.length})</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {annotPending.warnings.length > 0 ? (
                    <ul className="player-import-annot-warnings small">
                      {annotPending.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="player-import-annot-actions">
                    <button
                      type="button"
                      className="primary small"
                      disabled={annotSelectedTiers.size === 0}
                      onClick={handleAnnotConfirm}
                    >
                      Charger {annotSelectedTiers.size} tier(s)
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => {
                        setAnnotPending(null);
                        setAnnotSelectedTiers(new Set());
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : null}
            </details>

            {/* ── 4. Filtres ── */}
            <details className="player-panel-box" open>
              <summary className="player-panel-box-title">Filtres</summary>
              <div className="player-panel-filter-speaker small">
                <span>Locuteur :</span>
                {runSpeakerIds.length > 0 ? (
                  <div className="player-speaker-chips">
                    <button
                      type="button"
                      className={`player-speaker-chip${speakerSolo === null ? " is-active" : ""}`}
                      onClick={() => setSpeakerSolo(null)}
                    >
                      Tous
                    </button>
                    {runSpeakerIds.map((id, i) => (
                      <button
                        key={id}
                        type="button"
                        className={`player-speaker-chip${speakerSolo === id ? " is-active" : ""}`}
                        onClick={() => setSpeakerSolo(speakerSolo === id ? null : id)}
                        title={`Touche ${i + 1}`}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="player-hint"> aucun locuteur indexé</span>
                )}
              </div>
            </details>

            {/* ── 5. Navigation ── */}
            <details className="player-panel-box" open>
              <summary className="player-panel-box-title">Navigation</summary>
              <PlayerJumpPanel
                jumpTimeInput={jumpTimeInput}
                onJumpTimeInputChange={(v) => {
                  setJumpTimeInput(v);
                  setJumpTimeError("");
                }}
                jumpTimeError={jumpTimeError}
                disabled={transportDisabled}
                onCommit={commitJumpToTime}
              />
            </details>
          </aside>
          <main className={`player-viewport${editMode ? " player-viewport--edit" : ""}`}>
            {/* WX-725 — Zone sticky : media + transport + waveform toujours visibles */}
            <div className="player-sticky-zone">
            <div className={`player-media-stage${editMode ? " player-media-stage--compact" : ""}${mediaSrc && !isVideo ? " player-media-stage--audio" : ""}`}>
              {mediaSrc && isVideo ? (
                <div
                  className="player-media-stage__surface player-media-stage__surface--interactive"
                  onClick={() => {
                    if (!transportDisabled) {
                      void togglePlayPause();
                    }
                  }}
                  role="presentation"
                >
                  <video
                    ref={mediaRef as RefObject<HTMLVideoElement | null>}
                    className="player-viewport-video"
                    src={mediaSrc}
                    preload="metadata"
                    playsInline
                    controls={false}
                    {...mediaHandlers}
                  />
                </div>
              ) : null}
              {mediaSrc && !isVideo ? (
                <div
                  className="player-audio-mini-bar"
                  onClick={() => {
                    if (!transportDisabled) {
                      void togglePlayPause();
                    }
                  }}
                  role="button"
                  tabIndex={-1}
                  title="Clic pour lecture / pause"
                >
                  <span className="player-audio-mini-bar__icon" aria-hidden>{playing ? "⏸" : "▶"}</span>
                  <span className="player-audio-mini-bar__name mono">
                    {mediaPath ? fileBasename(mediaPath) : "Audio"}
                  </span>
                  <audio
                    ref={mediaRef as RefObject<HTMLAudioElement | null>}
                    className="player-viewport-audio"
                    src={mediaSrc}
                    preload="metadata"
                    muted={muted || wf.webAudioMode}
                    {...mediaHandlers}
                  />
                </div>
              ) : null}
              {!mediaSrc ? (
                <div className="player-media-stage__surface">
                  <p className="player-viewport-placeholder">
                    <strong>Média</strong> — aucune source après lecture du manifest.
                  </p>
                </div>
              ) : null}
              {mediaSrc && mediaPath && runDir ? (
                <PlayerWaveformPanel
                  wf={wf}
                  mediaPath={mediaPath}
                  pauseCsvPaths={pauseCsvPaths}
                  isVideo={isVideo}
                  compact={waveformCompact}
                  onToggleCompact={() => setWaveformCompact((c) => !c)}
                />
              ) : null}
              {mediaSrc ? (
                <PlayerMediaTransport
                  disabled={transportDisabled}
                  playing={playing}
                  onTogglePlayPause={togglePlayPause}
                  onStop={stop}
                  onSeekRelative={seekRelative}
                  currentTimeSec={currentTimeSec}
                  durationSec={durationSec}
                  onSeek={seek}
                  playbackRate={playbackRate}
                  onNudgePlaybackRate={nudgePlaybackRate}
                  volume={volume}
                  muted={muted}
                  onVolumeChange={(v) => {
                    setVolume(v);
                    if (v > 0) {
                      setMuted(false);
                    }
                  }}
                  onToggleMute={toggleMute}
                  isVideo={isVideo}
                  videoFullscreen={videoFullscreen}
                  onToggleVideoFullscreen={toggleVideoFullscreen}
                  followPlayhead={followPlayhead}
                  onToggleFollowPlayhead={() => setFollowPlayhead((v) => !v)}
                  posLabel={posLabel}
                  durLabel={durLabel}
                  copyPositionHint={copyPositionHint}
                  onCopyPlayhead={copyPlayheadToClipboard}
                  onPrevSegment={editMode && te.editorSegments.length > 0 ? () => {
                    const sec = findPrevSegmentStart(te.editorSegments, currentTimeSec);
                    if (sec != null) seek(sec);
                  } : undefined}
                  onNextSegment={editMode && te.editorSegments.length > 0 ? () => {
                    const sec = findNextSegmentStart(te.editorSegments, currentTimeSec);
                    if (sec != null) seek(sec);
                  } : undefined}
                  activeSpeaker={editMode && te.editorSegments.length > 0
                    ? findActiveSpeaker(te.editorSegments, currentTimeSec)
                    : null}
                  fullscreenMode={fullscreenMode}
                  onToggleFullscreen={runDir ? () => setFullscreenMode((v) => !v) : undefined}
                />
              ) : null}
            </div>
            </div>{/* /player-sticky-zone */}
            {/* WX-725 — Zone défilable : toolbar édition + événements */}
            <div className="player-content-zone">
            {editMode ? (
              <div className="player-edit-toolbar" role="toolbar" aria-label="Outils d'édition">
                <span className="player-edit-toolbar-label small">
                  Édition
                  {te.editorDirty ? (
                    <span className="player-edit-toolbar-dirty" title="Modifications non sauvegardées"> ●</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!te.canUndoEditor}
                  onClick={te.undoEditorChange}
                  title="Annuler (Alt+Z)"
                >
                  Annuler
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!te.canRedoEditor}
                  onClick={te.redoEditorChange}
                  title="Rétablir (Alt+Shift+Z)"
                >
                  Rétablir
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!te.editorDirty || te.isEditorSaving}
                  loading={te.isEditorSaving}
                  onClick={() => void te.saveEditedJson(true)}
                  title="Sauvegarder (Alt+S)"
                >
                  Sauvegarder
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditMode(false)}
                >
                  Quitter l'édition
                </Button>
                {te.editorStatus ? (
                  <span className="player-edit-toolbar-status small">{te.editorStatus}</span>
                ) : null}
                {te.editorError ? (
                  <span className="player-edit-toolbar-error small">{te.editorError}</span>
                ) : null}
              </div>
            ) : null}
            <div
              ref={eventsPanelRef}
              className="player-events-panel"
              onScroll={onEventsPanelScroll}
            >
              {runWindow.lastT0Ms != null && runWindow.lastT1Ms != null ? (
                <div className="player-events-panel-head small mono">
                  <span className="player-events-window-bounds">
                    Fenêtre {runWindow.lastT0Ms}–{runWindow.lastT1Ms} ms
                  </span>
                </div>
              ) : null}
              {runWindow.error ? (
                <p className="player-window-error small" role="alert">
                  {runWindow.error}
                </p>
              ) : null}
              {sliceTruncationLayers ? (
                <p className="small player-slice-truncation-hint" role="status">
                  Troncature sur : {sliceTruncationLayers.join(" · ")} — plafonds fenêtre SQLite ;
                  pour les mots, garde la fenêtre ≤ 30 s.
                </p>
              ) : null}
              <PlayerRunWindowViews
                mode={viewportMode}
                slice={runWindow.slice}
                playheadMs={playheadMs}
                loading={runWindow.loading}
                queryError={runWindow.error}
                wordsLayerActive={wordsLayerActive}
                followPlayhead={followPlayhead}
                onSeekToMs={(ms) => seek(ms / 1000)}
                durationSec={durationSec}
                loopAsec={loopAsec}
                loopBsec={loopBsec}
                onSetLoopRange={setLoopRange}
                editMode={editMode}
                editorSegments={te.editorSegments}
                activeSegmentIndex={te.activeSegmentIndex}
                setActiveSegmentIndex={te.setActiveSegmentIndex}
                updateEditorSegmentText={te.updateEditorSegmentText}
                updateEditorSegmentBoundary={te.updateEditorSegmentBoundary}
                focusSegment={te.focusSegment}
                runSpeakerIds={runSpeakerIds}
              />
            </div>
            {runDir ? <p className="small mono player-viewport-path">{runDir}</p> : null}
            </div>{/* /player-content-zone */}
          </main>
          <aside className="player-panel player-panel--right">
            {/* Run : QC + export */}
            <details className="player-panel-section" open>
              <summary className="player-panel-section-summary">Run</summary>
              <div className="player-panel-run-body small">
                <span className="player-qc-badge" title="Heuristiques fenêtre + manifest">
                  QC : {qcSummary}
                </span>
                <div className="player-panel-run-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={!runDir}
                    title="Ouvre le dossier du run (⌃⇧O / ⌘⇧O)"
                    onClick={() => void openRunFolder()}
                  >
                    Dossier run
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!runDir || exportPackBusy}
                    title="JSON+SRT+VTT+CSV (⌃⇧E / ⌘⇧E)"
                    onClick={() => void exportRunTimingPack()}
                  >
                    {exportPackBusy ? "Export…" : "Export pack"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!editMode || !te.editorSourcePath || exportSingleBusy}
                    title="Exporter un format individuel"
                    onClick={() => setExportFormatMenuOpen((v) => !v)}
                  >
                    {exportSingleBusy ? "Export…" : "Export ▾"}
                  </button>
                </div>
                {exportFormatMenuOpen && editMode && te.editorSourcePath ? (
                  <div className="player-export-format-menu">
                    {(
                      [
                        ["srt", "SRT"],
                        ["vtt", "VTT"],
                        ["json", "JSON"],
                        ["txt", "TXT"],
                        ["csv", "CSV"],
                        ["textgrid", "TextGrid"],
                        ["eaf", "EAF"],
                      ] as const
                    ).map(([fmt, label]) => (
                      <button
                        key={fmt}
                        type="button"
                        className="ghost player-export-format-btn"
                        disabled={exportSingleBusy || te.isEditorSaving}
                        onClick={() => void exportSingleFormat(fmt)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {exportFolderError ? (
                  <span className="player-export-error" role="alert">{exportFolderError}</span>
                ) : null}
                {exportPackError ? (
                  <span className="player-export-error" role="alert">{exportPackError}</span>
                ) : null}
                {exportPackHint ? (
                  <span className="player-export-hint mono" title={exportPackHint}>
                    {exportPackHint.length > 80 ? `${exportPackHint.slice(0, 80)}…` : exportPackHint}
                  </span>
                ) : null}
                {te.editorStatus ? (
                  <span className="player-export-hint mono">{te.editorStatus}</span>
                ) : null}
                {te.editorLastOutputPath && !te.editorStatus ? (
                  <span className="player-export-hint mono" title={te.editorLastOutputPath}>
                    {te.editorLastOutputPath.length > 70
                      ? `…${te.editorLastOutputPath.slice(-70)}`
                      : te.editorLastOutputPath}
                  </span>
                ) : null}
              </div>
            </details>

            {/* WX-706 — Segment sélectionné */}
            <details className="player-panel-section" open>
              <summary className="player-panel-section-summary">Segment sélectionné</summary>
              {editMode && te.activeSegmentIndex !== null ? (
                (() => {
                  const seg = te.editorSegments[te.activeSegmentIndex];
                  if (!seg) return <p className="small">Aucun segment actif.</p>;
                  const durMs = Math.round((seg.end - seg.start) * 1000);
                  const nWords = seg.words?.length ?? null;
                  const scoredWords = seg.words?.filter((w) => w.score != null) ?? [];
                  const avgScore =
                    scoredWords.length > 0
                      ? scoredWords.reduce((s, w) => s + w.score!, 0) / scoredWords.length
                      : null;
                  return (
                    <dl className="player-segment-info small">
                      <dt>Locuteur</dt>
                      <dd>{seg.speaker ?? "—"}</dd>
                      <dt>Durée</dt>
                      <dd className="mono">{durMs} ms</dd>
                      {nWords !== null && (
                        <>
                          <dt>Mots</dt>
                          <dd>{nWords}</dd>
                        </>
                      )}
                      {avgScore !== null && (
                        <>
                          <dt>Score moy.</dt>
                          <dd className="mono">{avgScore.toFixed(2)}</dd>
                        </>
                      )}
                    </dl>
                  );
                })()
              ) : (
                (() => {
                  const turn = runWindow.slice?.turns.find(
                    (t) => t.startMs <= playheadMs && playheadMs < t.endMs
                  );
                  if (!turn) return <p className="small">Aucun tour au curseur.</p>;
                  const durMs = turn.endMs - turn.startMs;
                  return (
                    <dl className="player-segment-info small">
                      <dt>Locuteur</dt>
                      <dd>{turn.speaker}</dd>
                      <dt>Durée</dt>
                      <dd className="mono">{durMs} ms</dd>
                      {turn.confidence != null && (
                        <>
                          <dt>Conf.</dt>
                          <dd className="mono">{turn.confidence.toFixed(2)}</dd>
                        </>
                      )}
                    </dl>
                  );
                })()
              )}
            </details>

            {/* Alertes */}
            <details className="player-panel-section" open>
              <summary className="player-panel-section-summary">
                Alertes{" "}
                {derivedAlerts.length > 0 && (
                  <span className="player-panel-section-badge">{derivedAlerts.length}</span>
                )}
              </summary>
              <details className="player-alerts-advanced small">
                <summary className="player-alerts-advanced-summary">Avancé — seuils (IPC)</summary>
                <div className="player-alerts-advanced-body">
                  <label className="player-alerts-advanced-label">
                    Pause longue ≥ (ms)
                    <input
                      type="range"
                      min={500}
                      max={30000}
                      step={100}
                      value={longPauseMs}
                      onChange={(e) => setLongPauseMs(Number(e.target.value))}
                      aria-label="Seuil pause longue en millisecondes"
                    />
                    <span className="mono">{longPauseMs}</span>
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!runWindow.slice}
                    loading={recomputeBusy}
                    onClick={() => void recomputePlayerAlertsIpc()}
                  >
                    Recalculer (IPC)
                  </Button>
                  {recomputeError ? (
                    <p className="small player-alerts-recompute-error" role="alert">
                      {recomputeError}
                    </p>
                  ) : null}
                  {lastRecomputeStats ? (
                    <p className="small mono player-alerts-qc-stats">
                      QC Rust : {lastRecomputeStats.nOverlapTurn} chev. · {lastRecomputeStats.nLongPause}{" "}
                      pauses · {lastRecomputeStats.nTurnsInWindow} tours ·{" "}
                      {lastRecomputeStats.nPausesInWindow} pauses (fenêtre)
                    </p>
                  ) : null}
                </div>
              </details>
              <label className="player-alert-filter small">
                Liste :{" "}
                <select
                  value={alertListFilter}
                  onChange={(e) =>
                    runInTransition(() => setAlertListFilter(e.target.value as AlertListFilter))
                  }
                  aria-label="Filtrer le type d’alertes dans la liste"
                >
                  <option value="all">Toutes</option>
                  <option value="overlap_turn">Chevauchements</option>
                  <option value="long_pause">Pauses longues</option>
                </select>
              </label>
              {derivedAlerts.length === 0 ? (
                <p className="small">
                  Aucune alerte détectée (chevauchements de tours, pauses ≥{" "}
                  {(longPauseMs / 1000).toFixed(1).replace(/\.0$/, "")} s).
                </p>
              ) : displayedAlerts.length === 0 ? (
                <p className="small">Aucune alerte pour ce filtre.</p>
              ) : (
                <ul className="player-alert-list">
                  {displayedAlerts.slice(0, 40).map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className="player-alert-item"
                        title={`Aller à ${a.startMs} ms`}
                        onClick={() => seek(a.startMs / 1000)}
                      >
                        {a.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            {/* Export stats (vue stats uniquement) */}
            {viewportMode === "stats" && runWindow.slice && (
              <details className="player-panel-section" open>
                <summary className="player-panel-section-summary">Export stats</summary>
                <div className="player-panel-export-group">
                  <button
                    type="button"
                    className="player-panel-export-btn"
                    onClick={() => {
                      const sl = runWindow.slice!;
                      const durMs = durationSec != null && Number.isFinite(durationSec)
                        ? durationSec * 1000
                        : Math.max(0, ...sl.turns.map((t) => t.endMs));
                      const hasWords = sl.words.length > 0;
                      const stats = computeSpeakerStats(sl.turns, sl.pauses, sl.ipus, durMs, hasWords ? sl.words : undefined);
                      const overlaps = computeOverlaps(sl.turns, durMs);
                      const transitions = computeTransitions(sl.turns);
                      const density = computeSpeechDensity(sl.turns, durMs);
                      const rate = computeSpeechRate(sl.ipus, durMs);
                      const totalSpeechMs = stats.reduce((s, st) => s + st.speechMs, 0);
                      const totalWords = stats.reduce((s, st) => s + st.nWords, 0);
                      const full = buildFullStatsExport(stats, overlaps, transitions, density, rate, null, durMs, totalSpeechMs, totalWords, sl.turns, sl.pauses, sl.ipus, sl.words);
                      void navigator.clipboard.writeText(buildFullStatsCsv(full));
                    }}
                  >
                    {"\u2913"} CSV complet
                  </button>
                  <button
                    type="button"
                    className="player-panel-export-btn"
                    onClick={() => {
                      const sl = runWindow.slice!;
                      const durMs = durationSec != null && Number.isFinite(durationSec)
                        ? durationSec * 1000
                        : Math.max(0, ...sl.turns.map((t) => t.endMs));
                      const hasWords = sl.words.length > 0;
                      const stats = computeSpeakerStats(sl.turns, sl.pauses, sl.ipus, durMs, hasWords ? sl.words : undefined);
                      const overlaps = computeOverlaps(sl.turns, durMs);
                      const transitions = computeTransitions(sl.turns);
                      const density = computeSpeechDensity(sl.turns, durMs);
                      const rate = computeSpeechRate(sl.ipus, durMs);
                      const totalSpeechMs = stats.reduce((s, st) => s + st.speechMs, 0);
                      const totalWords = stats.reduce((s, st) => s + st.nWords, 0);
                      const full = buildFullStatsExport(stats, overlaps, transitions, density, rate, null, durMs, totalSpeechMs, totalWords, sl.turns, sl.pauses, sl.ipus, sl.words);
                      void navigator.clipboard.writeText(JSON.stringify(full, null, 2));
                    }}
                  >
                    {"\u2913"} JSON complet
                  </button>
                </div>
              </details>
            )}

            {/* Contrôles — replié par défaut */}
            <details className="player-panel-section">
              <summary className="player-panel-section-summary">Contrôles</summary>
              <p className="small">
                Lecture, saut ±1 s / ±5 s, progression et volume sont sous le média. Boucle A–B et
                export en haut.
              </p>
              <p className="small player-shortcuts-hint">
                Espace · Home / Fin · ⌃⇧C copier · ⌃⇧O dossier · ⌃⇧E export · ← → (±1 s) · Shift+←
                → (±5 s) · Alt+← → (±0,1 s) · +/− vitesse · M muet · Alt+Entrée plein écran (vidéo) ·
                F suivi · W mots · L boucle · [ / ] segment préc./suiv. · ⌃1–7 vues · N / P alertes ·
                0 / 1–9 locuteur · Aller au temps (gauche) · <strong>?</strong> aide
              </p>
            </details>
          </aside>
        </div>
      )}
      {shortcutsHelpOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="player-shortcuts-help-overlay"
              role="presentation"
              onClick={() => setShortcutsHelpOpen(false)}
            >
              <div
                ref={shortcutsHelpPanelRef}
                id="player-shortcuts-help-dialog"
                className="player-shortcuts-help-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="player-shortcuts-help-title"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="player-shortcuts-help-head">
                  <h2 id="player-shortcuts-help-title" className="player-shortcuts-help-title">
                    Raccourcis Player
                  </h2>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => setShortcutsHelpOpen(false)}
                  >
                    Fermer
                  </button>
                </div>
                <ul className="player-shortcuts-help-list small">
                  <li>
                    <kbd className="player-kbd">Espace</kbd> Lecture / pause
                  </li>
                  <li>
                    <kbd className="player-kbd">Home</kbd> Arrêt + retour au début (barre sous le média
                    aussi)
                  </li>
                  <li>
                    <kbd className="player-kbd">Fin</kbd> Fin de média
                  </li>
                  <li>
                    <kbd className="player-kbd">⌃⇧C</kbd> Copier timecode · double-clic sur le
                    timecode
                  </li>
                  <li>
                    <kbd className="player-kbd">⌃⇧O</kbd> Dossier run ·{" "}
                    <kbd className="player-kbd">⌃⇧E</kbd> Export pack
                  </li>
                  <li>
                    <kbd className="player-kbd">←</kbd> <kbd className="player-kbd">→</kbd> ±1 s ·{" "}
                    <kbd className="player-kbd">Shift</kbd>+flèches ±5 s ·{" "}
                    <kbd className="player-kbd">Alt</kbd>
                    +flèches ±0,1 s
                  </li>
                  <li>
                    <kbd className="player-kbd">+</kbd> / <kbd className="player-kbd">−</kbd>{" "}
                    Vitesse
                  </li>
                  <li>
                    <kbd className="player-kbd">F</kbd> Suivi viewport ·{" "}
                    <kbd className="player-kbd">W</kbd> Fenêtre mots ·{" "}
                    <kbd className="player-kbd">L</kbd> Boucle A→B ·{" "}
                    <kbd className="player-kbd">M</kbd> Muet · <kbd className="player-kbd">Alt</kbd>
                    +<kbd className="player-kbd">Entrée</kbd> Plein écran (vidéo)
                  </li>
                  <li>
                    <kbd className="player-kbd">⌃1</kbd>–<kbd className="player-kbd">7</kbd> Vues
                  </li>
                  <li>
                    <kbd className="player-kbd">[</kbd> / <kbd className="player-kbd">]</kbd> Segment
                    préc. / suiv.
                  </li>
                  <li>
                    <kbd className="player-kbd">N</kbd> / <kbd className="player-kbd">P</kbd> Alerte
                    suiv. / préc.
                  </li>
                  <li>
                    <kbd className="player-kbd">0</kbd>–<kbd className="player-kbd">9</kbd> Solo
                    locuteur
                  </li>
                  <li>
                    Navigateur : champ <strong>Aller au temps</strong> +{" "}
                    <kbd className="player-kbd">Entrée</kbd>
                  </li>
                </ul>
                <p className="small player-shortcuts-help-foot">
                  <kbd className="player-kbd">?</kbd> ouvre / ferme cette aide ·{" "}
                  <kbd className="player-kbd">Échap</kbd> ferme · détail dans{" "}
                  <code>audit/player-multi-view.md</code>
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
      {fullscreenMode && typeof document !== "undefined"
        ? createPortal(
            <PlayerFullscreenView
              onExit={() => setFullscreenMode(false)}
              playing={playing}
              currentTimeSec={currentTimeSec}
              durationSec={durationSec}
              playbackRate={playbackRate}
              volume={volume}
              muted={muted}
              onTogglePlayPause={togglePlayPause}
              onSeek={seek}
              onSeekRelative={seekRelative}
              onStop={stop}
              onNudgePlaybackRate={nudgePlaybackRate}
              onVolumeChange={(v) => {
                setVolume(v);
                if (v > 0) setMuted(false);
              }}
              onToggleMute={toggleMute}
              viewportMode={viewportMode}
              onSetViewportMode={setViewportMode}
              slice={runWindow.slice}
              playheadMs={playheadMs}
              loading={runWindow.loading}
              queryError={runWindow.error}
              wordsLayerActive={wordsLayerActive}
              followPlayhead={followPlayhead}
              loopAsec={loopAsec}
              loopBsec={loopBsec}
              onSetLoopRange={setLoopRange}
              onMarkLoopA={markLoopA}
              onMarkLoopB={markLoopB}
              onClearLoop={clearLoop}
              onPrevSegment={editMode && te.editorSegments.length > 0 ? () => {
                const sec = findPrevSegmentStart(te.editorSegments, currentTimeSec);
                if (sec != null) seek(sec);
              } : undefined}
              onNextSegment={editMode && te.editorSegments.length > 0 ? () => {
                const sec = findNextSegmentStart(te.editorSegments, currentTimeSec);
                if (sec != null) seek(sec);
              } : undefined}
              activeSpeaker={editMode && te.editorSegments.length > 0
                ? findActiveSpeaker(te.editorSegments, currentTimeSec)
                : null}
              editMode={editMode}
              editorSegments={te.editorSegments}
              activeSegmentIndex={te.activeSegmentIndex}
              setActiveSegmentIndex={te.setActiveSegmentIndex}
              updateEditorSegmentText={te.updateEditorSegmentText}
              updateEditorSegmentBoundary={te.updateEditorSegmentBoundary}
              focusSegment={te.focusSegment}
              runSpeakerIds={runSpeakerIds}
              speakerSolo={speakerSolo}
              onSetSpeakerSolo={setSpeakerSolo}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
