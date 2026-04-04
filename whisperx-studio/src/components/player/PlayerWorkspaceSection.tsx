import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { runInTransition } from "../../whisperxOptionsTransitions";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  clampNumber,
  fileBasename,
  formatClockSeconds,
  joinPathSegments,
  parsePlayerTimecodeToSeconds,
} from "../../appUtils";
import { useWaveformCanvas } from "../../hooks/useWaveformCanvas";
import { useWaveformWorkspace } from "../../hooks/useWaveformWorkspace";
import { usePlayerPlayback } from "../../hooks/usePlayerPlayback";
import { usePlayerKeyboard, type UsePlayerKeyboardOptions } from "../../hooks/usePlayerKeyboard";
import { usePlayerRunWindow } from "../../hooks/usePlayerRunWindow";
import { derivePlayerAlerts } from "../../player/derivePlayerAlerts";
import type { PlayerDerivedAlertKind } from "../../player/derivePlayerAlerts";
import type {
  EditableSegment,
  ExportRunTimingPackResponse,
  QueryWindowResult,
  RecomputePlayerAlertsResponse,
  RecomputePlayerAlertsStats,
} from "../../types";
import type { PlayerDerivedAlert } from "../../player/derivePlayerAlerts";
import { PlayerRunWindowViews, type PlayerViewportMode } from "./PlayerRunWindowViews";
import { VIEWPORT_QUERY_CONTRACTS, type ViewportQueryContract } from "./playerViewportContract";
import {
  buildFullStatsCsv,
  buildFullStatsExport,
  computeOverlaps,
  computeSpeakerStats,
  computeSpeechDensity,
  computeSpeechRate,
  computeTransitions,
  type BrushRange,
} from "../../player/playerSpeakerStats";
import { useAnnotationRunImport } from "../../hooks/useAnnotationRunImport";
import { PlayerJumpPanel } from "./PlayerJumpPanel";
import { PlayerMediaTransport } from "./PlayerMediaTransport";
import { PlayerTopBar } from "./PlayerTopBar";
import { PlayerRunArtifactsStrip } from "./PlayerRunArtifactsStrip";
import { PlayerWaveformPanel } from "./PlayerWaveformPanel";
import { PlayerFullscreenView } from "./PlayerFullscreenView";
import { ErrorBanner } from "../ErrorBanner";
import { NewJobDropZone } from "../NewJobDropZone";
import { Button } from "../ui";

function findActiveSpeakerFromTurns(
  turns: { startMs: number; endMs: number; speaker: string }[],
  playheadMs: number,
): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.startMs <= playheadMs + 50 && t.endMs >= playheadMs - 50) {
      return t.speaker;
    }
  }
  return null;
}

function buildSliceExportStats(sl: QueryWindowResult, durationSec: number | null | undefined) {
  const durMs =
    durationSec != null && Number.isFinite(durationSec)
      ? durationSec * 1000
      : Math.max(0, ...sl.turns.map((t) => t.endMs));
  const hasWords = sl.words.length > 0;
  const stats = computeSpeakerStats(
    sl.turns,
    sl.pauses,
    sl.ipus,
    durMs,
    hasWords ? sl.words : undefined,
  );
  const overlaps = computeOverlaps(sl.turns, durMs);
  const transitions = computeTransitions(sl.turns);
  const density = computeSpeechDensity(sl.turns, durMs);
  const rate = computeSpeechRate(sl.ipus, durMs);
  const totalSpeechMs = stats.reduce((s, st) => s + st.speechMs, 0);
  const totalWords = stats.reduce((s, st) => s + st.nWords, 0);
  return buildFullStatsExport(
    stats,
    overlaps,
    transitions,
    density,
    rate,
    null,
    durMs,
    totalSpeechMs,
    totalWords,
    sl.turns,
    sl.pauses,
    sl.ipus,
    sl.words,
  );
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
  onBack: () => void;
  importMedia?: PlayerWorkspaceSectionImportMediaProps;
  /** WX-696 — Incrémenter pour forcer un rechargement de la fenêtre events (annotation tiers). */
  eventsRefreshEpoch?: number;
  /** Ouvre le dialogue d'aide global (géré par App.tsx). */
  onToggleHelp?: () => void;
  /** Navigation contextuelle vers l'éditeur (WX-728). */
  onOpenEditor?: (runDir: string, label?: string) => void;
  /** WX-718 — Appelé quand un run d'annotation directe a été créé avec succès. */
  onAnnotationRunCreated?: (runDir: string) => void;
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
  onToggleHelp,
  onOpenEditor,
  onAnnotationRunCreated,
}: PlayerWorkspaceSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const annotationImport = useAnnotationRunImport();
  const [viewportMode, setViewportMode] = useState<PlayerViewportMode>("lanes");
  const [wordsWindowEnabled, setWordsWindowEnabled] = useState(false);
  const [exportFolderError, setExportFolderError] = useState("");
  const [exportPackBusy, setExportPackBusy] = useState(false);
  const [exportPackError, setExportPackError] = useState("");
  const [exportPackHint, setExportPackHint] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportHint, setReportHint] = useState("");
  const [reportError, setReportError] = useState("");
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
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const eventsPanelRef = useRef<HTMLDivElement | null>(null);
  const programmaticPanelScrollRef = useRef(false);
  const copyPositionHintTimeoutRef = useRef<number | null>(null);
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

  const [waveformCompact, setWaveformCompact] = useState(true);

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

  const overlaySegments = useMemo((): EditableSegment[] => {
    return (
      runWindow.slice?.turns.map((t) => ({
        start: t.startMs / 1000,
        end: t.endMs / 1000,
        text: "",
        speaker: t.speaker,
      })) ?? []
    );
  }, [runWindow.slice?.turns]);

  // WX-726/727 — données événements pour marqueurs, lanes et sélection d'analyse
  const waveformOverlay = useMemo(() => {
    if (!runWindow.slice) return null;
    return {
      pauses: runWindow.slice.pauses,
      turns: runWindow.slice.turns,
      words: runWindow.slice.words,
      ipus: runWindow.slice.ipus,
      longPauseMs,
      durationMs: durationSec != null ? durationSec * 1000 : Math.max(0, ...runWindow.slice.turns.map((t) => t.endMs), 0),
    };
  }, [runWindow.slice, longPauseMs, durationSec]);

  useWaveformCanvas(wf, overlaySegments, null, null, null, loopAsec, loopBsec, waveformCompact, waveformOverlay);

  // WX-725 — sync transport → waveform : le canvas lit wf.mediaCurrentSec, pas currentTimeSec
  // webAudioMode (audio) : la position courante vient du Web Audio, pas du timeupdate natif
  useEffect(() => {
    if (wf.webAudioMode && !isVideo) return;
    wf.setMediaCurrentSec(currentTimeSec);
  }, [currentTimeSec, isVideo, wf.setMediaCurrentSec, wf.webAudioMode]); // eslint-disable-line react-hooks/exhaustive-deps -- wf granulaire

  // WX-725 — follow playhead : scroll waveform pour garder le playhead visible
  useEffect(() => {
    if (!followPlayhead || !wf.waveform) return;
    const visibleDur = wf.waveformVisibleDurationSec;
    const margin = visibleDur * 0.08;
    if (
      currentTimeSec < wf.waveformViewStartSec + margin ||
      currentTimeSec > wf.waveformViewEndSec - margin
    ) {
      const idealStart = currentTimeSec - visibleDur * 0.3;
      wf.setWaveformViewStart(Math.max(0, Math.min(wf.waveformMaxViewStartSec, idealStart)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wf granulaire (pas d’objet hook entier)
  }, [
    currentTimeSec,
    followPlayhead,
    wf.waveform,
    wf.waveformVisibleDurationSec,
    wf.waveformViewStartSec,
    wf.waveformViewEndSec,
    wf.waveformMaxViewStartSec,
    wf.setWaveformViewStart,
  ]);

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

  const activeSpeaker = useMemo(
    () => findActiveSpeakerFromTurns(runWindow.slice?.turns ?? [], playheadMs),
    [runWindow.slice?.turns, playheadMs],
  );

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

  const exportHtmlReport = useCallback(async () => {
    if (!runDir) return;
    setReportError("");
    setReportHint("");
    setReportBusy(true);
    try {
      const r = await invoke<{ outputPath: string }>("export_prosody_report", { runDir });
      setReportHint(`Rapport généré · ${r.outputPath}`);
      await invoke("open_local_path", { path: r.outputPath });
    } catch (e) {
      setReportError(String(e));
    } finally {
      setReportBusy(false);
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
    if (!wordsWindowEnabled && viewportMode === "words") {
      setViewportMode("lanes");
    }
  }, [wordsWindowEnabled, viewportMode]);

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
      typeof window.matchMedia === "function" &&
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

  // WX-724/WX-727 — brush stats mirrors wf.analysisSelection to keep a single source of truth
  const statsBrushRange = useMemo<BrushRange | null>(
    () =>
      wf.analysisSelection
        ? { startMs: wf.analysisSelection.start * 1000, endMs: wf.analysisSelection.end * 1000 }
        : null,
    [wf.analysisSelection],
  );
  const handleStatsBrushChange = useCallback(
    (range: BrushRange | null) => {
      if (range) {
        wf.setAnalysisSelection({ start: range.startMs / 1000, end: range.endMs / 1000 });
      } else {
        wf.clearAnalysisSelection();
      }
    },
    [wf.setAnalysisSelection, wf.clearAnalysisSelection],
  );

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
    if (!fullscreenMode || typeof document === "undefined") {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreenMode]);

  const loopHint =
    loopAsec != null && loopBsec != null && loopBsec > loopAsec
      ? `A ${formatClockSeconds(loopAsec)} → B ${formatClockSeconds(loopBsec)}`
      : "A–B : —";

  const transportDisabled = !mediaSrc || !!manifestError;

  const keyboardOptions = useMemo(
    (): UsePlayerKeyboardOptions => ({
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
    }),
    [
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
    ],
  );

  const onPlayerKeyDown = usePlayerKeyboard(keyboardOptions);

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
      onKeyDown={onPlayerKeyDown}
    >
      <div className="player-workspace-top">
        <PlayerTopBar
          onBack={onBack}
          runLabel={runLabel ?? "Player"}
          runDir={runDir}
          mediaPath={mediaPath}
          onToggleHelp={onToggleHelp}
          onToggleFullscreen={runDir ? () => setFullscreenMode((v) => !v) : undefined}
          fullscreenMode={fullscreenMode}
          onOpenEditor={
            onOpenEditor && runDir ? () => onOpenEditor(runDir, runLabel ?? runDir) : undefined
          }
        />
        {runDir && (
          <div className="player-loop-bar">
            <span className="player-loop-bar-hint small mono">{loopHint}</span>
            <button
              type="button"
              className="ghost small"
              onClick={markLoopA}
              disabled={transportDisabled}
            >
              Marquer A
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={markLoopB}
              disabled={transportDisabled}
            >
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
              Tu peux aussi ouvrir un run existant depuis l&apos;<strong>Historique</strong>{" "}
              (fichiers de sortie → Ouvrir le Player) ou depuis le Studio (section{" "}
              <em>Ouvrir un run sur disque</em>).
            </p>
            {importMedia ? (
              <div className="player-empty-import">
                <p className="player-empty-import-hint">
                  <strong>Nouveau job</strong> — importe un média (glisser-déposer ou Parcourir) :
                  tu seras basculé vers le Studio pour les paramètres et le lancement.
                </p>
                <NewJobDropZone
                  selectedLabel={
                    importMedia.inputPath.trim() ? fileBasename(importMedia.inputPath) : undefined
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

            {onAnnotationRunCreated ? (
              <div className="player-empty-annotation">
                <p className="player-empty-annotation-hint small">
                  <strong>Annoter directement</strong> — ouvre un audio sans transcription ASR. Tu
                  peux importer un transcript existant (SRT/VTT/JSON) ou annoter manuellement.
                </p>
                <p className="player-empty-annotation-steps small">
                  <strong>Étapes :</strong> 1) fichier audio · 2) dossier <em>parent</em> où le run
                  sera créé (un sous-dossier est ajouté automatiquement — ce n’est pas
                  l’enregistrement d’un fichier transcript). Après succès, tu restes sur{" "}
                  <strong>Player</strong> avec le run chargé : ouvre l’onglet <strong>Éditeur</strong>{" "}
                  pour annoter, ou écoute l’audio ici.
                </p>
                {annotationImport.error ? (
                  <p className="player-empty-annotation-error small">{annotationImport.error}</p>
                ) : null}
                <div className="player-empty-import-row">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={annotationImport.step === "running"}
                    onClick={() =>
                      void annotationImport.importWithTranscript().then((dir) => {
                        if (dir) onAnnotationRunCreated(dir);
                      })
                    }
                  >
                    {annotationImport.step === "running" ? "Création…" : "Audio + Transcript…"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={annotationImport.step === "running"}
                    onClick={() =>
                      void annotationImport.importAudioOnly().then((dir) => {
                        if (dir) onAnnotationRunCreated(dir);
                      })
                    }
                  >
                    Audio seul (run vide)
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="player-empty-cta">
              <p className="player-empty-cta-hint small">
                Pour lancer un <strong>job WhisperX</strong> (pipeline ASR) depuis un média, va sur
                l’onglet Import.
              </p>
              <Button type="button" variant="secondary" onClick={onBack}>
                Ouvrir l’onglet Import
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
                {(
                  [
                    ["lanes", "Lanes", "1"],
                    ["chat", "Chat", "2"],
                    ["words", "Mots", "3"],
                    ["columns", "Colonnes", "4"],
                    ["rythmo", "Rythmo", "5"],
                    ["karaoke", "Karaoké", "6"],
                    ["stats", "Stats", "7"],
                  ] as const
                ).map(([mode, label, key]) => (
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

            {/* ── 3. Filtres ── */}
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
          <main className="player-viewport">
            {/* WX-725 — Zone sticky : media + transport + waveform toujours visibles */}
            <div className="player-sticky-zone">
              <div
                className={`player-media-stage${mediaSrc && !isVideo ? " player-media-stage--audio" : ""}`}
              >
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
                    <span className="player-audio-mini-bar__icon" aria-hidden>
                      {playing ? "⏸" : "▶"}
                    </span>
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
                    waveformOverlay={waveformOverlay}
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
                    activeSpeaker={activeSpeaker}
                    fullscreenMode={fullscreenMode}
                    onToggleFullscreen={runDir ? () => setFullscreenMode((v) => !v) : undefined}
                  />
                ) : null}
              </div>
            </div>
            {/* /player-sticky-zone */}
            <div className="player-content-zone">
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
                  runSpeakerIds={runSpeakerIds}
                  longPauseMs={longPauseMs}
                  highlightRangeMs={statsBrushRange ? { start: statsBrushRange.startMs, end: statsBrushRange.endMs } : null}
                  statsBrushRange={statsBrushRange}
                  onStatsBrushChange={handleStatsBrushChange}
                />
              </div>
              {runDir ? <p className="small mono player-viewport-path">{runDir}</p> : null}
            </div>
            {/* /player-content-zone */}
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
                    disabled={!runDir || reportBusy}
                    title="Rapport HTML complet (metadata + stats + transcript)"
                    onClick={() => void exportHtmlReport()}
                  >
                    {reportBusy ? "Rapport…" : "Rapport HTML"}
                  </button>
                </div>
                {exportFolderError ? (
                  <span className="player-export-error" role="alert">
                    {exportFolderError}
                  </span>
                ) : null}
                {exportPackError ? (
                  <span className="player-export-error" role="alert">
                    {exportPackError}
                  </span>
                ) : null}
                {exportPackHint ? (
                  <span className="player-export-hint mono" title={exportPackHint}>
                    {exportPackHint.length > 80
                      ? `${exportPackHint.slice(0, 80)}…`
                      : exportPackHint}
                  </span>
                ) : null}
                {reportError ? (
                  <span className="player-export-error" role="alert">
                    {reportError}
                  </span>
                ) : null}
                {reportHint ? (
                  <span className="player-export-hint mono" title={reportHint}>
                    {reportHint.length > 80 ? `${reportHint.slice(0, 80)}…` : reportHint}
                  </span>
                ) : null}
              </div>
            </details>

            {/* WX-706 — Segment sélectionné */}
            <details className="player-panel-section" open>
              <summary className="player-panel-section-summary">Segment sélectionné</summary>
              {(() => {
                const turn = runWindow.slice?.turns.find(
                  (t) => t.startMs <= playheadMs && playheadMs < t.endMs,
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
              })()}
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
                      QC Rust : {lastRecomputeStats.nOverlapTurn} chev. ·{" "}
                      {lastRecomputeStats.nLongPause} pauses · {lastRecomputeStats.nTurnsInWindow}{" "}
                      tours · {lastRecomputeStats.nPausesInWindow} pauses (fenêtre)
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
                      const full = buildSliceExportStats(runWindow.slice!, durationSec);
                      void navigator.clipboard.writeText(buildFullStatsCsv(full));
                    }}
                  >
                    {"\u2913"} CSV complet
                  </button>
                  <button
                    type="button"
                    className="player-panel-export-btn"
                    onClick={() => {
                      const full = buildSliceExportStats(runWindow.slice!, durationSec);
                      void navigator.clipboard.writeText(JSON.stringify(full, null, 2));
                    }}
                  >
                    {"\u2913"} JSON complet
                  </button>
                </div>
              </details>
            )}

            {/* Contrôles — lien vers aide globale */}
            <details className="player-panel-section">
              <summary className="player-panel-section-summary">Contrôles</summary>
              <p className="small">
                Lecture, saut, vitesse et volume sont sous le média. Boucle A–B et export en haut.
              </p>
              <p className="small">
                Appuyez sur <kbd className="player-kbd">?</kbd> pour voir tous les raccourcis
                clavier.
              </p>
            </details>
          </aside>
        </div>
      )}
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
              activeSpeaker={activeSpeaker}
              onToggleFollowPlayhead={() => setFollowPlayhead((v) => !v)}
              runSpeakerIds={runSpeakerIds}
              speakerSolo={speakerSolo}
              onSetSpeakerSolo={setSpeakerSolo}
              longPauseMs={longPauseMs}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
