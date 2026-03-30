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
import { PlayerJumpPanel } from "./PlayerJumpPanel";
import { PlayerMediaTransport } from "./PlayerMediaTransport";
import { PlayerTopBar } from "./PlayerTopBar";
import { PlayerRunArtifactsStrip } from "./PlayerRunArtifactsStrip";
import { PlayerWaveformPanel } from "./PlayerWaveformPanel";
import { ErrorBanner } from "../ErrorBanner";
import { NewJobDropZone } from "../NewJobDropZone";
import { Button } from "../ui";

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

  const noopRefreshJobs = useCallback(async () => {}, []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const noopPreviewOutput = useCallback(async (_path: string) => {}, []);

  const te = useTranscriptEditor({
    wf,
    refreshJobs: noopRefreshJobs,
    previewOutput: noopPreviewOutput,
    selectedJobId: runDir ? `player:${runDir}` : "player-idle",
  });

  useWaveformCanvas(
    wf,
    editMode ? te.editorSegments : [],
    editMode ? te.focusedSegmentIndex : null,
    editMode ? te.hoveredSegmentEdge : null,
    editMode ? te.dragSegmentState : null,
  );

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

  useEffect(() => {
    if (wf.webAudioMode && !isVideo) {
      return;
    }
    wf.setMediaCurrentSec(currentTimeSec);
  }, [currentTimeSec, isVideo, wf]);

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
      setExportPackHint(`Pack exporté (JSON + SRT + CSV) · dernier fichier : ${r.lastOutputPath}`);
    } catch (e) {
      setExportPackError(String(e));
    } finally {
      setExportPackBusy(false);
    }
  }, [runDir]);

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
          transportDisabled={transportDisabled}
          loopHint={loopHint}
          onMarkLoopA={markLoopA}
          onMarkLoopB={markLoopB}
          onClearLoop={clearLoop}
          loopAsec={loopAsec}
          loopBsec={loopBsec}
          qcSummary={qcSummary}
          exportFolderError={exportFolderError}
          exportPackError={exportPackError}
          exportPackHint={exportPackHint}
          exportPackBusy={exportPackBusy}
          onOpenRunFolder={openRunFolder}
          onExportRunTimingPack={exportRunTimingPack}
        />
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
              Depuis le Studio, section <strong>Ouvrir un run sur disque</strong>, ouvre un dossier
              de run (manifest) puis utilise <strong>Ouvrir le Player</strong>.
              <br />
              Tu peux aussi sélectionner un job avec média dans le détail du run et ouvrir le Player
              depuis les fichiers de sortie.
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
            <div className="player-panel-box">
              <h4 className="player-panel-box-title">Vues</h4>
              <div className="player-view-mode" role="tablist" aria-label="Mode de viewport">
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportMode === "lanes"}
                  className={`player-view-mode-btn ${viewportMode === "lanes" ? "is-active" : ""}`}
                  onClick={() => setViewportMode("lanes")}
                >
                  1 Lanes
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportMode === "chat"}
                  className={`player-view-mode-btn ${viewportMode === "chat" ? "is-active" : ""}`}
                  onClick={() => setViewportMode("chat")}
                >
                  2 Chat
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportMode === "words"}
                  className={`player-view-mode-btn ${viewportMode === "words" ? "is-active" : ""}`}
                  onClick={() => setViewportMode("words")}
                >
                  3 Mots
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportMode === "columns"}
                  className={`player-view-mode-btn ${viewportMode === "columns" ? "is-active" : ""}`}
                  onClick={() => setViewportMode("columns")}
                >
                  4 Colonnes
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportMode === "rythmo"}
                  className={`player-view-mode-btn ${viewportMode === "rythmo" ? "is-active" : ""}`}
                  onClick={() => setViewportMode("rythmo")}
                >
                  5 Rythmo
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportMode === "karaoke"}
                  className={`player-view-mode-btn ${viewportMode === "karaoke" ? "is-active" : ""}`}
                  onClick={() => setViewportMode("karaoke")}
                >
                  6 Karaoké
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportMode === "stats"}
                  className={`player-view-mode-btn ${viewportMode === "stats" ? "is-active" : ""}`}
                  onClick={() => setViewportMode("stats")}
                >
                  7 Stats
                </button>
              </div>
              <label className="player-words-toggle small">
                <input
                  type="checkbox"
                  checked={wordsWindowEnabled}
                  onChange={(e) => runInTransition(() => setWordsWindowEnabled(e.target.checked))}
                />
                Charger les mots (requis pour Mots et Karaoké)
              </label>
            </div>

            <div className="player-panel-box">
              <h4 className="player-panel-box-title">Édition</h4>
              {transcriptJsonPath ? (
                <label className="player-words-toggle small">
                  <input
                    type="checkbox"
                    checked={editMode}
                    onChange={(e) => runInTransition(() => setEditMode(e.target.checked))}
                  />
                  Mode édition
                </label>
              ) : (
                <p className="small" style={{ color: "var(--lx-text-2)", margin: 0 }}>
                  Aucun transcript chargé — lancer un run pour éditer.
                </p>
              )}
              {editMode && te.editorDirty ? (
                <span className="player-edit-dirty-badge small">Modifications non sauvegardées</span>
              ) : null}
              <button
                type="button"
                className="player-import-annot-btn ghost small"
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
            </div>

            <div className="player-panel-box">
              <h4 className="player-panel-box-title">Filtres</h4>
              <p className="small" style={{ margin: 0 }}>
                Locuteur : <span className="mono">{speakerSolo ?? "tous"}</span>
                {runSpeakerIds.length > 0 ? (
                  <> · 1–9 (réappuyer = off) · 0 = tous</>
                ) : (
                  <> — indexer le run pour le solo clavier</>
                )}
              </p>
            </div>

            <div className="player-panel-box">
              <h4 className="player-panel-box-title">Navigateur</h4>
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
            </div>
          </aside>
          <main className={`player-viewport${editMode ? " player-viewport--edit" : ""}`}>
            <div className={`player-media-stage${editMode ? " player-media-stage--compact" : ""}`}>
              {editMode && mediaSrc && !isVideo ? (
                <audio
                  ref={mediaRef as RefObject<HTMLAudioElement | null>}
                  className="player-viewport-audio"
                  src={mediaSrc}
                  preload="metadata"
                  muted={muted || wf.webAudioMode}
                  {...mediaHandlers}
                />
              ) : (
                <div
                  className={`player-media-stage__surface${mediaSrc ? " player-media-stage__surface--interactive" : ""}`}
                  onClick={() => {
                    if (!transportDisabled) {
                      void togglePlayPause();
                    }
                  }}
                  role="presentation"
                >
                  {mediaSrc && isVideo ? (
                    <video
                      ref={mediaRef as RefObject<HTMLVideoElement | null>}
                      className="player-viewport-video"
                      src={mediaSrc}
                      preload="metadata"
                      playsInline
                      controls={false}
                      {...mediaHandlers}
                    />
                  ) : null}
                  {mediaSrc && !isVideo ? (
                    <>
                      <div className="player-audio-surface" aria-hidden>
                        <span className="player-audio-surface__glyph" />
                        <p className="player-audio-surface__label mono">
                          {mediaPath ? fileBasename(mediaPath) : "Audio"}
                        </p>
                        <p className="player-audio-surface__hint small">
                          Clic pour lecture / pause — contrôles sous la piste
                        </p>
                      </div>
                      <audio
                        ref={mediaRef as RefObject<HTMLAudioElement | null>}
                        className="player-viewport-audio"
                        src={mediaSrc}
                        preload="metadata"
                        muted={muted || wf.webAudioMode}
                        {...mediaHandlers}
                      />
                    </>
                  ) : null}
                  {!mediaSrc ? (
                    <p className="player-viewport-placeholder">
                      <strong>Média</strong> — aucune source après lecture du manifest.
                    </p>
                  ) : null}
                </div>
              )}
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
                />
              ) : null}
              {mediaSrc && mediaPath && runDir && !editMode ? (
                <PlayerWaveformPanel
                  wf={wf}
                  mediaPath={mediaPath}
                  pauseCsvPaths={pauseCsvPaths}
                  isVideo={isVideo}
                />
              ) : null}
            </div>
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
              />
            </div>
            {runDir ? <p className="small mono player-viewport-path">{runDir}</p> : null}
          </main>
          <aside className="player-panel player-panel--right">
            <h4 className="player-panel-title">Alertes (fenêtre)</h4>
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
            <h4 className="player-panel-title">Contrôles</h4>
            <p className="small">
              Lecture, saut ±1 s / ±5 s, progression et volume sont sous le média. Boucle A–B et export
              en haut.
            </p>
            <p className="small player-shortcuts-hint">
              Espace · Home / Fin · ⌃⇧C copier · ⌃⇧O dossier · ⌃⇧E export · ← → (±1 s) · Shift+← →
              (±5 s) · Alt+← → (±0,1 s) · +/− vitesse · M muet · Alt+Entrée plein écran (vidéo) · F
              suivi · W mots · L boucle · ⌃1–6 vues · N / P alertes · 0 / 1–9 locuteur · Aller au temps
              (gauche) · <strong>?</strong> aide
            </p>
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
                    <kbd className="player-kbd">⌃1</kbd>–<kbd className="player-kbd">6</kbd> Vues
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
    </div>
  );
}
