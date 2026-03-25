import type { WheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MAX_WAVEFORM_ZOOM, MIN_WAVEFORM_ZOOM } from "../constants";
import { clampNumber } from "../appUtils";
import type {
  Job,
  WaveformCancelledEvent,
  WaveformErrorEvent,
  WaveformDetailEnvelope,
  WaveformPeaks,
  WaveformProgressEvent,
  WaveformReadyEvent,
  WaveformOverviewEnvelope,
  WaveformPyramidBuilt,
  WaveformTaskStarted,
} from "../types";
import {
  loadDetailEnvelopeForView,
  loadFullOverviewMinMax,
  resolveOverviewLevelPath,
  shouldDrawSegmentOverlays,
} from "../waveformWxenv";
import { WebAudioWindowPlayer } from "../webAudioPlayback";

export type UseWaveformWorkspaceOptions = {
  selectedJob: Job | null;
  selectedJobId: string;
  selectedIsVideo: boolean;
  /** Flux « Nouveau job » : média sans Job encore créé (chemin local). */
  previewMediaPath?: string | null;
};

export function useWaveformWorkspace({
  selectedJob,
  selectedJobId,
  selectedIsVideo,
  previewMediaPath = null,
}: UseWaveformWorkspaceOptions) {
  const [waveform, setWaveform] = useState<WaveformPeaks | null>(null);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const [waveformTaskId, setWaveformTaskId] = useState("");
  const [waveformProgress, setWaveformProgress] = useState(0);
  const [waveformProgressMessage, setWaveformProgressMessage] = useState("");
  const [waveformError, setWaveformError] = useState("");
  const [waveformBinsPerSecond, setWaveformBinsPerSecond] = useState("50");
  const [waveformZoom, setWaveformZoom] = useState(1);
  const [waveformViewStartSec, setWaveformViewStartSec] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapStepMs, setSnapStepMs] = useState<"10" | "20" | "40">("20");
  const [waveformCursorSec, setWaveformCursorSec] = useState<number | null>(null);
  const [mediaCurrentSec, setMediaCurrentSec] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  const waveformTaskIdRef = useRef("");
  const webAudioPlayerRef = useRef<WebAudioWindowPlayer | null>(null);
  const [webAudioMode, setWebAudioMode] = useState(false);
  const [webAudioError, setWebAudioError] = useState("");
  /** WX-622 — plage [t0,t1] sur la timeline (audio / ondeforme). */
  const [previewRangeSec, setPreviewRangeSec] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [rangeSelectionMode, setRangeSelectionMode] = useState(false);
  const [rangeDragStartSec, setRangeDragStartSec] = useState<number | null>(null);
  const [rangeDragEndSec, setRangeDragEndSec] = useState<number | null>(null);
  const rangeDragStartRef = useRef<number | null>(null);
  const rangeDragEndRef = useRef<number | null>(null);
  const [previewWaveGainDb, setPreviewWaveGainDb] = useState(0);
  const [previewWaveEqLowDb, setPreviewWaveEqLowDb] = useState(0);
  const [previewWaveBalance, setPreviewWaveBalance] = useState(0);
  const [previewWaveBypassEffects, setPreviewWaveBypassEffects] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waveformPyramid, setWaveformPyramid] = useState<WaveformPyramidBuilt | null>(null);
  const [isPyramidBuilding, setIsPyramidBuilding] = useState(false);
  const [pyramidError, setPyramidError] = useState("");
  const [overviewEnvelope, setOverviewEnvelope] = useState<WaveformOverviewEnvelope | null>(null);
  const [isOverviewLoading, setIsOverviewLoading] = useState(false);
  const [detailEnvelope, setDetailEnvelope] = useState<WaveformDetailEnvelope | null>(null);

  const waveformDurationSec = waveform?.durationSec ?? 0;

  const effectiveMediaPath = useMemo(() => {
    const jobPath = selectedJob?.inputPath?.trim();
    if (jobPath) {
      return jobPath;
    }
    const preview = previewMediaPath?.trim();
    return preview ?? "";
  }, [previewMediaPath, selectedJob?.inputPath]);

  const webAudioSourcePath = effectiveMediaPath;
  const waveformVisibleDurationSec = useMemo(() => {
    if (waveformDurationSec <= 0) {
      return 0;
    }
    return waveformDurationSec / clampNumber(waveformZoom, MIN_WAVEFORM_ZOOM, MAX_WAVEFORM_ZOOM);
  }, [waveformDurationSec, waveformZoom]);

  const showSegmentOverlaysOnWaveform = useMemo(
    () => shouldDrawSegmentOverlays(waveformVisibleDurationSec),
    [waveformVisibleDurationSec],
  );

  const buildWaveformPyramid = useCallback(async () => {
    if (!effectiveMediaPath) {
      setPyramidError("Aucun fichier media.");
      return;
    }
    setIsPyramidBuilding(true);
    setPyramidError("");
    try {
      const built = await invoke<WaveformPyramidBuilt>("build_waveform_pyramid", {
        path: effectiveMediaPath,
        sampleRate: 16000,
      });
      setWaveformPyramid(built);
    } catch (e) {
      setPyramidError(String(e));
      setWaveformPyramid(null);
      setOverviewEnvelope(null);
    } finally {
      setIsPyramidBuilding(false);
    }
  }, [effectiveMediaPath]);

  const waveformViewEndSec = useMemo(
    () => waveformViewStartSec + waveformVisibleDurationSec,
    [waveformViewStartSec, waveformVisibleDurationSec],
  );

  const rangeDragPreviewSec = useMemo(() => {
    if (rangeDragStartSec === null || rangeDragEndSec === null) {
      return null;
    }
    return {
      start: Math.min(rangeDragStartSec, rangeDragEndSec),
      end: Math.max(rangeDragStartSec, rangeDragEndSec),
    };
  }, [rangeDragEndSec, rangeDragStartSec]);

  const waveformMaxViewStartSec = useMemo(() => {
    if (waveformDurationSec <= 0 || waveformVisibleDurationSec <= 0) {
      return 0;
    }
    return Math.max(0, waveformDurationSec - waveformVisibleDurationSec);
  }, [waveformDurationSec, waveformVisibleDurationSec]);

  const getActiveMediaElement = useCallback((): HTMLMediaElement | null => {
    return selectedIsVideo ? videoRef.current : audioRef.current;
  }, [selectedIsVideo]);

  const applySnap = useCallback(
    (seconds: number): number => {
      if (!snapEnabled) {
        return seconds;
      }
      const step = Number(snapStepMs) / 1000;
      if (!Number.isFinite(step) || step <= 0) {
        return seconds;
      }
      return Math.round(seconds / step) * step;
    },
    [snapEnabled, snapStepMs],
  );

  const clampWaveformViewStart = useCallback(
    (rawStart: number, totalDuration: number, visibleDuration: number): number => {
      const maxStart = Math.max(0, totalDuration - visibleDuration);
      return clampNumber(rawStart, 0, maxStart);
    },
    [],
  );

  const setWaveformZoomAround = useCallback(
    (nextZoomRaw: number, anchorSec: number, anchorRatio = 0.5) => {
      if (!waveform || waveform.durationSec <= 0) {
        return;
      }
      const total = waveform.durationSec;
      const nextZoom = clampNumber(nextZoomRaw, MIN_WAVEFORM_ZOOM, MAX_WAVEFORM_ZOOM);
      const nextVisibleDuration = total / nextZoom;
      const clampedAnchor = clampNumber(anchorSec, 0, total);
      const ratio = clampNumber(anchorRatio, 0, 1);
      const rawStart = clampedAnchor - ratio * nextVisibleDuration;
      const nextStart = clampWaveformViewStart(rawStart, total, nextVisibleDuration);
      setWaveformZoom(nextZoom);
      setWaveformViewStartSec(nextStart);
    },
    [clampWaveformViewStart, waveform],
  );

  const ensureTimeVisible = useCallback(
    (seconds: number) => {
      if (!waveform || waveform.durationSec <= 0 || waveformVisibleDurationSec <= 0) {
        return;
      }
      const total = waveform.durationSec;
      const clampedTime = clampNumber(seconds, 0, total);
      if (clampedTime >= waveformViewStartSec && clampedTime <= waveformViewEndSec) {
        return;
      }
      const targetStart = clampedTime - waveformVisibleDurationSec / 2;
      const nextStart = clampWaveformViewStart(targetStart, total, waveformVisibleDurationSec);
      setWaveformViewStartSec(nextStart);
    },
    [
      clampWaveformViewStart,
      waveform,
      waveformViewEndSec,
      waveformViewStartSec,
      waveformVisibleDurationSec,
    ],
  );

  const seekMedia = useCallback(
    (seconds: number) => {
      const durationMax =
        waveform?.durationSec && waveform.durationSec > 0
          ? waveform.durationSec
          : Number.POSITIVE_INFINITY;
      const clamped = clampNumber(applySnap(seconds), 0, durationMax);
      setWaveformCursorSec(clamped);
      setMediaCurrentSec(clamped);
      ensureTimeVisible(clamped);
      if (webAudioMode && !selectedIsVideo && webAudioPlayerRef.current) {
        setWebAudioError("");
        const p = webAudioPlayerRef.current;
        p.setPreviewEffects({
          gainDb: previewWaveGainDb,
          eqLowDb: previewWaveEqLowDb,
          balance: previewWaveBalance,
          bypass: previewWaveBypassEffects,
        });
        void p
          .loadWindowAtSeek(clamped)
          .then(() => {
            setMediaCurrentSec(p.getCurrentFileTime());
          })
          .catch((e: unknown) => {
            setWebAudioError(String(e));
          });
        const a = audioRef.current;
        if (a) {
          a.currentTime = clamped;
        }
        return;
      }
      const media = getActiveMediaElement();
      if (media) {
        media.currentTime = clamped;
      }
    },
    [
      applySnap,
      ensureTimeVisible,
      getActiveMediaElement,
      previewWaveBalance,
      previewWaveBypassEffects,
      previewWaveEqLowDb,
      previewWaveGainDb,
      selectedIsVideo,
      webAudioMode,
      waveform?.durationSec,
    ],
  );

  const toggleMediaPlayback = useCallback(async () => {
    if (!webAudioMode || selectedIsVideo) {
      const media = getActiveMediaElement();
      if (!media) {
        return;
      }
      if (media.paused) {
        void media.play().catch(() => undefined);
      } else {
        media.pause();
      }
      return;
    }
    const p = webAudioPlayerRef.current;
    if (!p) {
      return;
    }
    setWebAudioError("");
    try {
      if (p.isPlaying()) {
        p.pause();
      } else {
        p.setPreviewEffects({
          gainDb: previewWaveGainDb,
          eqLowDb: previewWaveEqLowDb,
          balance: previewWaveBalance,
          bypass: previewWaveBypassEffects,
        });
        const hasRange =
          previewRangeSec !== null && previewRangeSec.end - previewRangeSec.start >= 0.05;
        if (hasRange) {
          await p.loadRangeChunk(previewRangeSec.start, previewRangeSec.end);
        } else {
          await p.loadWindowAtSeek(mediaCurrentSec);
        }
        await p.play();
      }
    } catch (e) {
      setWebAudioError(String(e));
    }
  }, [
    getActiveMediaElement,
    mediaCurrentSec,
    previewRangeSec,
    previewWaveBalance,
    previewWaveBypassEffects,
    previewWaveEqLowDb,
    previewWaveGainDb,
    selectedIsVideo,
    webAudioMode,
  ]);

  const setWaveformViewStart = useCallback(
    (nextStartRaw: number) => {
      if (!waveform || waveform.durationSec <= 0 || waveformVisibleDurationSec <= 0) {
        return;
      }
      const nextStart = clampWaveformViewStart(
        nextStartRaw,
        waveform.durationSec,
        waveformVisibleDurationSec,
      );
      setWaveformViewStartSec(nextStart);
    },
    [clampWaveformViewStart, waveform, waveformVisibleDurationSec],
  );

  const zoomWaveform = useCallback(
    (factor: number) => {
      if (!waveform || waveform.durationSec <= 0) {
        return;
      }
      const anchor = waveformCursorSec ?? mediaCurrentSec;
      setWaveformZoomAround(waveformZoom * factor, anchor, 0.5);
    },
    [mediaCurrentSec, setWaveformZoomAround, waveform, waveformCursorSec, waveformZoom],
  );

  const resetWaveformZoom = useCallback(() => {
    setWaveformZoom(1);
    setWaveformViewStartSec(0);
  }, []);

  const beginRangeDrag = useCallback((sec: number) => {
    rangeDragStartRef.current = sec;
    rangeDragEndRef.current = sec;
    setRangeDragStartSec(sec);
    setRangeDragEndSec(sec);
  }, []);

  const updateRangeDrag = useCallback((sec: number) => {
    rangeDragEndRef.current = sec;
    setRangeDragEndSec(sec);
  }, []);

  const commitRangeDrag = useCallback(() => {
    const a = rangeDragStartRef.current;
    const b = rangeDragEndRef.current;
    rangeDragStartRef.current = null;
    rangeDragEndRef.current = null;
    setRangeDragStartSec(null);
    setRangeDragEndSec(null);
    if (a === null || b === null) {
      return;
    }
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end - start < 0.05) {
      return;
    }
    setPreviewRangeSec({ start, end });
  }, []);

  const cancelRangeDrag = useCallback(() => {
    rangeDragStartRef.current = null;
    rangeDragEndRef.current = null;
    setRangeDragStartSec(null);
    setRangeDragEndSec(null);
  }, []);

  const setPreviewRangeFromVisibleWindow = useCallback(() => {
    if (waveformDurationSec <= 0) {
      return;
    }
    const a = waveformViewStartSec;
    const b = waveformViewEndSec;
    setPreviewRangeSec({ start: Math.min(a, b), end: Math.max(a, b) });
  }, [waveformDurationSec, waveformViewEndSec, waveformViewStartSec]);

  const clearPreviewRange = useCallback(() => {
    setPreviewRangeSec(null);
  }, []);

  const resetPreviewWaveEffects = useCallback(() => {
    setPreviewWaveGainDb(0);
    setPreviewWaveEqLowDb(0);
    setPreviewWaveBalance(0);
    setPreviewWaveBypassEffects(false);
    webAudioPlayerRef.current?.resetPreviewEffects();
  }, []);

  const requestCancelWaveformGeneration = useCallback(async (taskIdOverride?: string) => {
    const taskId = taskIdOverride ?? waveformTaskIdRef.current;
    if (!taskId) {
      return;
    }
    try {
      await invoke<boolean>("cancel_waveform_generation", { taskId });
    } catch (e) {
      setWaveformError(String(e));
    }
  }, []);

  const loadWaveformForSelectedJob = useCallback(async () => {
    if (!effectiveMediaPath) {
      setWaveformError("Aucun fichier media.");
      return;
    }

    const parsedBins = Number(waveformBinsPerSecond);
    const binsPerSecond =
      Number.isFinite(parsedBins) && parsedBins > 0 ? Math.floor(parsedBins) : 50;

    if (waveformTaskIdRef.current) {
      await requestCancelWaveformGeneration(waveformTaskIdRef.current);
    }

    setWaveformError("");
    setWaveformProgressMessage("Initialisation generation waveform...");
    setWaveformProgress(1);
    setWaveform(null);
    setIsWaveformLoading(true);
    try {
      const started = await invoke<WaveformTaskStarted>("start_waveform_generation", {
        path: effectiveMediaPath,
        binsPerSecond,
        sampleRate: 16000,
      });
      setWaveformTaskId(started.taskId);
      waveformTaskIdRef.current = started.taskId;
    } catch (e) {
      setWaveformTaskId("");
      waveformTaskIdRef.current = "";
      setWaveformError(String(e));
      setWaveformProgressMessage("");
      setWaveformProgress(0);
      setIsWaveformLoading(false);
    }
  }, [effectiveMediaPath, requestCancelWaveformGeneration, waveformBinsPerSecond]);

  const onWaveformWheel = useCallback(
    (event: WheelEvent<HTMLCanvasElement>) => {
      if (!waveform || waveform.durationSec <= 0 || !event.ctrlKey) {
        return;
      }
      event.preventDefault();

      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      const clampedRatio = Math.min(1, Math.max(0, ratio));
      const anchorSec = waveformViewStartSec + clampedRatio * waveformVisibleDurationSec;

      const zoomIn = event.deltaY < 0;
      const factor = zoomIn ? 1.18 : 1 / 1.18;
      const nextZoom = waveformZoom * factor;
      setWaveformZoomAround(nextZoom, anchorSec, clampedRatio);
    },
    [
      setWaveformZoomAround,
      waveform,
      waveformViewStartSec,
      waveformVisibleDurationSec,
      waveformZoom,
    ],
  );

  useEffect(() => {
    const unlistenWaveformProgressPromise = listen<WaveformProgressEvent>(
      "waveform-progress",
      (event) => {
        if (event.payload.taskId !== waveformTaskIdRef.current) {
          return;
        }
        setWaveformProgress(event.payload.progress);
        setWaveformProgressMessage(event.payload.message);
        setIsWaveformLoading(true);
      },
    );

    const unlistenWaveformReadyPromise = listen<WaveformReadyEvent>("waveform-ready", (event) => {
      if (event.payload.taskId !== waveformTaskIdRef.current) {
        return;
      }
      setWaveform(event.payload.peaks);
      setWaveformTaskId("");
      waveformTaskIdRef.current = "";
      setWaveformError("");
      setWaveformProgress(100);
      setWaveformProgressMessage(
        event.payload.peaks.cached ? "Waveform chargee (cache)." : "Waveform generee.",
      );
      setWaveformZoom(1);
      setWaveformViewStartSec(0);
      const playerTime = videoRef.current?.currentTime ?? audioRef.current?.currentTime ?? 0;
      setMediaCurrentSec(playerTime);
      setWaveformCursorSec(playerTime);
      setIsWaveformLoading(false);
    });

    const unlistenWaveformErrorPromise = listen<WaveformErrorEvent>("waveform-error", (event) => {
      if (event.payload.taskId !== waveformTaskIdRef.current) {
        return;
      }
      setWaveformTaskId("");
      waveformTaskIdRef.current = "";
      setWaveformError(event.payload.error);
      setWaveformProgressMessage("Generation waveform en erreur.");
      setIsWaveformLoading(false);
    });

    const unlistenWaveformCancelledPromise = listen<WaveformCancelledEvent>(
      "waveform-cancelled",
      (event) => {
        if (event.payload.taskId !== waveformTaskIdRef.current) {
          return;
        }
        setWaveformTaskId("");
        waveformTaskIdRef.current = "";
        setWaveformProgressMessage(event.payload.message);
        setWaveformProgress(0);
        setIsWaveformLoading(false);
      },
    );

    return () => {
      void unlistenWaveformProgressPromise.then((unlisten) => unlisten());
      void unlistenWaveformReadyPromise.then((unlisten) => unlisten());
      void unlistenWaveformErrorPromise.then((unlisten) => unlisten());
      void unlistenWaveformCancelledPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    waveformTaskIdRef.current = waveformTaskId;
  }, [waveformTaskId]);

  useEffect(() => {
    return () => {
      const taskId = waveformTaskIdRef.current;
      if (!taskId) {
        return;
      }
      void invoke<boolean>("cancel_waveform_generation", { taskId });
    };
  }, []);

  useEffect(() => {
    const prev = webAudioPlayerRef.current;
    if (prev) {
      prev.dispose();
      webAudioPlayerRef.current = null;
    }
    if (!webAudioSourcePath || waveformDurationSec <= 0) {
      return;
    }
    const p = new WebAudioWindowPlayer();
    p.setSource(webAudioSourcePath, waveformDurationSec);
    webAudioPlayerRef.current = p;
    return () => {
      p.dispose();
      if (webAudioPlayerRef.current === p) {
        webAudioPlayerRef.current = null;
      }
    };
  }, [webAudioSourcePath, waveformDurationSec]);

  useEffect(() => {
    const p = webAudioPlayerRef.current;
    if (!p) {
      return;
    }
    p.setPreviewEffects({
      gainDb: previewWaveGainDb,
      eqLowDb: previewWaveEqLowDb,
      balance: previewWaveBalance,
      bypass: previewWaveBypassEffects,
    });
  }, [previewWaveBalance, previewWaveBypassEffects, previewWaveEqLowDb, previewWaveGainDb]);

  useEffect(() => {
    if (rangeDragStartSec === null) {
      return;
    }
    const onUp = () => {
      commitRangeDrag();
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [commitRangeDrag, rangeDragStartSec]);

  useEffect(() => {
    if (rangeDragStartSec === null || !waveform || waveform.durationSec <= 0) {
      return;
    }
    const onMove = (e: MouseEvent) => {
      const canvas = waveformCanvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const ratio = (e.clientX - rect.left) / rect.width;
      const clampedRatio = Math.min(1, Math.max(0, ratio));
      const raw = waveformViewStartSec + clampedRatio * waveformVisibleDurationSec;
      const sec = applySnap(clampNumber(raw, 0, waveform.durationSec));
      updateRangeDrag(sec);
      setWaveformCursorSec(sec);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [
    applySnap,
    rangeDragStartSec,
    updateRangeDrag,
    waveform,
    waveformViewStartSec,
    waveformVisibleDurationSec,
  ]);

  useEffect(() => {
    if (!webAudioMode || selectedIsVideo) {
      return;
    }
    let cancelled = false;
    const loop = () => {
      if (cancelled) {
        return;
      }
      const p = webAudioPlayerRef.current;
      if (p?.isPlaying()) {
        const t = p.getCurrentFileTime();
        if (previewRangeSec && previewRangeSec.end - previewRangeSec.start >= 0.05) {
          if (t >= previewRangeSec.end - 0.03) {
            p.pause();
            setMediaCurrentSec(previewRangeSec.end);
          } else {
            setMediaCurrentSec(t);
          }
        } else {
          setMediaCurrentSec(t);
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => {
      cancelled = true;
    };
  }, [previewRangeSec, selectedIsVideo, webAudioMode]);

  useEffect(() => {
    if (!webAudioMode || selectedIsVideo) {
      return;
    }
    audioRef.current?.pause();
  }, [selectedIsVideo, webAudioMode]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (waveformTaskIdRef.current) {
      void requestCancelWaveformGeneration(waveformTaskIdRef.current);
    }
    setWaveformTaskId("");
    waveformTaskIdRef.current = "";
    setWaveform(null);
    setWaveformError("");
    setWaveformProgress(0);
    setWaveformProgressMessage("");
    setWaveformZoom(1);
    setWaveformViewStartSec(0);
    setWaveformCursorSec(null);
    setMediaCurrentSec(0);
    setIsWaveformLoading(false);
    setWaveformPyramid(null);
    setOverviewEnvelope(null);
    setDetailEnvelope(null);
    setPyramidError("");
    setPreviewRangeSec(null);
    setRangeSelectionMode(false);
    rangeDragStartRef.current = null;
    rangeDragEndRef.current = null;
    setRangeDragStartSec(null);
    setRangeDragEndSec(null);
    setPreviewWaveGainDb(0);
    setPreviewWaveEqLowDb(0);
    setPreviewWaveBalance(0);
    setPreviewWaveBypassEffects(false);
  }, [selectedJobId, requestCancelWaveformGeneration]);

  useEffect(() => {
    if (!waveformPyramid) {
      setOverviewEnvelope(null);
      return;
    }
    let cancelled = false;
    setIsOverviewLoading(true);
    void (async () => {
      try {
        const { path, levelIndex } = await resolveOverviewLevelPath(waveformPyramid);
        const { minMax, meta } = await loadFullOverviewMinMax(path);
        if (!cancelled) {
          setOverviewEnvelope({
            minMax,
            sampleRate: meta.sampleRate,
            blockSize: meta.blockSize,
            nBlocks: meta.nBlocks,
            levelIndex,
          });
        }
      } catch {
        if (!cancelled) {
          setOverviewEnvelope(null);
        }
      } finally {
        if (!cancelled) {
          setIsOverviewLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [waveformPyramid]);

  useEffect(() => {
    if (
      !waveform ||
      !waveformPyramid ||
      waveform.durationSec <= 0 ||
      waveformVisibleDurationSec <= 0
    ) {
      setDetailEnvelope(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const env = await loadDetailEnvelopeForView(
            waveformPyramid,
            waveformViewStartSec,
            waveformVisibleDurationSec,
          );
          if (!cancelled) {
            setDetailEnvelope(env);
          }
        } catch {
          if (!cancelled) {
            setDetailEnvelope(null);
          }
        }
      })();
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [waveform, waveformPyramid, waveformViewStartSec, waveformVisibleDurationSec]);

  useEffect(() => {
    if (!waveform || waveform.durationSec <= 0) {
      return;
    }
    const visible =
      waveform.durationSec / clampNumber(waveformZoom, MIN_WAVEFORM_ZOOM, MAX_WAVEFORM_ZOOM);
    const nextStart = clampWaveformViewStart(waveformViewStartSec, waveform.durationSec, visible);
    if (Math.abs(nextStart - waveformViewStartSec) > 0.0001) {
      setWaveformViewStartSec(nextStart);
    }
  }, [clampWaveformViewStart, waveform, waveformViewStartSec, waveformZoom]);

  return {
    waveform,
    setWaveform,
    isWaveformLoading,
    waveformTaskId,
    waveformProgress,
    waveformProgressMessage,
    waveformError,
    waveformBinsPerSecond,
    setWaveformBinsPerSecond,
    waveformZoom,
    setWaveformZoom,
    waveformViewStartSec,
    setWaveformViewStartSec,
    snapEnabled,
    setSnapEnabled,
    snapStepMs,
    setSnapStepMs,
    waveformCursorSec,
    setWaveformCursorSec,
    mediaCurrentSec,
    setMediaCurrentSec,
    viewportWidth,
    waveformTaskIdRef,
    audioRef,
    videoRef,
    waveformCanvasRef,
    waveformDurationSec,
    waveformVisibleDurationSec,
    waveformViewEndSec,
    waveformMaxViewStartSec,
    getActiveMediaElement,
    toggleMediaPlayback,
    webAudioMode,
    setWebAudioMode,
    webAudioError,
    setWebAudioError,
    applySnap,
    clampWaveformViewStart,
    setWaveformZoomAround,
    ensureTimeVisible,
    seekMedia,
    setWaveformViewStart,
    zoomWaveform,
    resetWaveformZoom,
    requestCancelWaveformGeneration,
    loadWaveformForSelectedJob,
    onWaveformWheel,
    waveformPyramid,
    isPyramidBuilding,
    pyramidError,
    buildWaveformPyramid,
    overviewEnvelope,
    isOverviewLoading,
    detailEnvelope,
    showSegmentOverlaysOnWaveform,
    previewRangeSec,
    setPreviewRangeSec,
    rangeDragPreviewSec,
    rangeSelectionMode,
    setRangeSelectionMode,
    rangeDragStartSec,
    beginRangeDrag,
    updateRangeDrag,
    cancelRangeDrag,
    setPreviewRangeFromVisibleWindow,
    clearPreviewRange,
    previewWaveGainDb,
    setPreviewWaveGainDb,
    previewWaveEqLowDb,
    setPreviewWaveEqLowDb,
    previewWaveBalance,
    setPreviewWaveBalance,
    previewWaveBypassEffects,
    setPreviewWaveBypassEffects,
    resetPreviewWaveEffects,
  };
}

export type WaveformWorkspace = ReturnType<typeof useWaveformWorkspace>;
