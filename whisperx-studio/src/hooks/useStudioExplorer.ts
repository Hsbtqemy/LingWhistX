import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipcInvokeDev } from "../dev/ipcPerf";
import { pathsEqualNormalized } from "../appUtils";
import type {
  ExplorerLayerToggles,
  Job,
  QueryWindowResult,
  RecalcPausesIpuConfig,
  RecalcPausesIpuResult,
  RecalcPausesIpuStats,
  RunEventsImportResult,
  RunManifestSummary,
  RuntimeStatus,
} from "../types";
import { QUERY_WINDOW_DEFAULT_MAX } from "../types";
import type { WaveformWorkspace } from "./useWaveformWorkspace";

const LAYERS_STORAGE_KEY = "lingwhistx-explorer-layers-v1";

const DEFAULT_LAYERS: ExplorerLayerToggles = {
  turns: true,
  pauses: true,
  ipus: true,
  overlap: false,
  words: true,
  wordsAutoZoom: false,
  segments: true,
};

function loadLayers(): ExplorerLayerToggles {
  try {
    const raw = sessionStorage.getItem(LAYERS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_LAYERS };
    }
    const parsed = JSON.parse(raw) as Partial<ExplorerLayerToggles>;
    return { ...DEFAULT_LAYERS, ...parsed };
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) {
    return "—";
  }
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fileBasename(path: string): string {
  const n = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return n[n.length - 1] ?? path;
}

function parseOptionalFloat(raw: string): number | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type ExplorerSpeakerUi = {
  id: string;
  alias: string;
  visible: boolean;
};

export type UseStudioExplorerOptions = {
  selectedJob: Job | null;
  wf: WaveformWorkspace;
  setSelectedJobId: (id: string) => void;
  setError: (message: string) => void;
  runtimeStatus: RuntimeStatus | null;
  exportTimingPack: () => Promise<void>;
  hasTranscriptSource: boolean;
};

export function useStudioExplorer({
  selectedJob,
  wf,
  setSelectedJobId,
  setError,
  runtimeStatus,
  exportTimingPack,
  hasTranscriptSource,
}: UseStudioExplorerOptions) {
  const [activeRunSummary, setActiveRunSummary] = useState<RunManifestSummary | null>(null);
  const [resumeFileLabel, setResumeFileLabel] = useState<string | null>(null);
  const [layers, setLayers] = useState<ExplorerLayerToggles>(() => loadLayers());
  const [speakerRows, setSpeakerRows] = useState<ExplorerSpeakerUi[]>([]);
  const [soloSpeakerId, setSoloSpeakerId] = useState<string | null>(null);
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [lastImport, setLastImport] = useState<RunEventsImportResult | null>(null);
  const [goToTimeInput, setGoToTimeInput] = useState("");
  const [recalcMinPauseInput, setRecalcMinPauseInput] = useState("0.15");
  const [recalcIgnoreBelowInput, setRecalcIgnoreBelowInput] = useState("0.1");
  const [recalcPauseMaxInput, setRecalcPauseMaxInput] = useState("");
  const [recalcIpuMinWordsInput, setRecalcIpuMinWordsInput] = useState("1");
  const [recalcIpuMinDurInput, setRecalcIpuMinDurInput] = useState("0");
  const [recalcStats, setRecalcStats] = useState<RecalcPausesIpuStats | null>(null);
  const [recalcBusy, setRecalcBusy] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(layers));
    } catch {
      /* ignore */
    }
  }, [layers]);

  useEffect(() => {
    if (!selectedJob?.outputDir) {
      setActiveRunSummary(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await ipcInvokeDev<RunManifestSummary>(
          "explorer:jobOutputManifest",
          "read_run_manifest_summary",
          {
            inputPath: selectedJob.outputDir,
          },
        );
        if (!cancelled) {
          setActiveRunSummary(s);
        }
      } catch {
        if (!cancelled) {
          setActiveRunSummary(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedJob?.outputDir]);

  const buildRecalcConfig = useCallback((): RecalcPausesIpuConfig | null => {
    const minPauseSec = Number(recalcMinPauseInput);
    const ignoreBelowSec = Number(recalcIgnoreBelowInput);
    if (!Number.isFinite(minPauseSec) || !Number.isFinite(ignoreBelowSec)) {
      return null;
    }
    const mw = parseInt(recalcIpuMinWordsInput, 10);
    const ipuMinWords = Number.isFinite(mw) && mw > 0 ? mw : 1;
    const ipuMinDurationSec = Number(recalcIpuMinDurInput);
    const pmax = parseOptionalFloat(recalcPauseMaxInput);
    return {
      minPauseSec,
      ignoreBelowSec,
      pauseMaxSec: pmax ?? null,
      ipuMinWords,
      ipuMinDurationSec: Number.isFinite(ipuMinDurationSec) ? ipuMinDurationSec : 0,
    };
  }, [
    recalcMinPauseInput,
    recalcIgnoreBelowInput,
    recalcPauseMaxInput,
    recalcIpuMinWordsInput,
    recalcIpuMinDurInput,
  ]);

  useEffect(() => {
    if (!activeRunSummary?.runDir) {
      setRecalcStats(null);
      return;
    }
    const cfg = buildRecalcConfig();
    if (!cfg) {
      setRecalcStats(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setRecalcBusy(true);
        try {
          const r = await ipcInvokeDev<RecalcPausesIpuResult>(
            "explorer:recalcPreview",
            "recalc_pauses_ipu",
            {
              runDir: activeRunSummary.runDir,
              config: cfg,
              persist: false,
            },
          );
          if (!cancelled) {
            setRecalcStats(r.stats);
          }
        } catch {
          if (!cancelled) {
            setRecalcStats(null);
          }
        } finally {
          if (!cancelled) {
            setRecalcBusy(false);
          }
        }
      })();
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRunSummary?.runDir, buildRecalcConfig]);

  const applyRecalcPersist = useCallback(async () => {
    if (!activeRunSummary?.runDir) {
      setError("Ouvre un run avec events.sqlite indexe.");
      return;
    }
    const cfg = buildRecalcConfig();
    if (!cfg) {
      setError("Parametres pause / IPU invalides.");
      return;
    }
    setRecalcBusy(true);
    setError("");
    try {
      const r = await ipcInvokeDev<RecalcPausesIpuResult>(
        "explorer:recalcPersist",
        "recalc_pauses_ipu",
        {
          runDir: activeRunSummary.runDir,
          config: cfg,
          persist: true,
        },
      );
      setRecalcStats(r.stats);
    } catch (e) {
      setError(String(e));
    } finally {
      setRecalcBusy(false);
    }
  }, [activeRunSummary?.runDir, buildRecalcConfig, setError]);

  const refreshSpeakers = useCallback(async (runDir: string) => {
    try {
      const ids = await ipcInvokeDev<string[]>("explorer:speakers", "list_run_speakers", {
        runDir,
      });
      setSpeakerRows((prev) => {
        const map = new Map(prev.map((r) => [r.id, r] as const));
        return ids.map((id) => {
          const existing = map.get(id);
          return {
            id,
            alias: existing?.alias ?? id,
            visible: existing?.visible ?? true,
          };
        });
      });
    } catch {
      setSpeakerRows([]);
    }
  }, []);

  useEffect(() => {
    if (!activeRunSummary?.runDir) {
      setSpeakerRows([]);
      setSoloSpeakerId(null);
      return;
    }
    void refreshSpeakers(activeRunSummary.runDir);
  }, [activeRunSummary?.runDir, refreshSpeakers]);

  const findMatchingJobId = useCallback(async (runDir: string) => {
    try {
      const jobs = await ipcInvokeDev<Job[]>("explorer:findJob", "list_jobs");
      const hit = jobs.find((j) => pathsEqualNormalized(j.outputDir, runDir));
      return hit?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const applyRunSummary = useCallback(
    async (path: string) => {
      setError("");
      setExplorerBusy(true);
      setLastImport(null);
      try {
        const s = await ipcInvokeDev<RunManifestSummary>(
          "explorer:applyRunSummary",
          "read_run_manifest_summary",
          {
            inputPath: path,
          },
        );
        setActiveRunSummary(s);
        const jobId = await findMatchingJobId(s.runDir);
        if (jobId) {
          setSelectedJobId(jobId);
        }
        await refreshSpeakers(s.runDir);
      } catch (e) {
        setError(String(e));
      } finally {
        setExplorerBusy(false);
      }
    },
    [findMatchingJobId, refreshSpeakers, setError, setSelectedJobId],
  );

  const pickOpenRun = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Dossier de run (run_manifest.json)",
    });
    if (typeof selected === "string") {
      await applyRunSummary(selected);
    }
  }, [applyRunSummary]);

  const pickOpenFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Fichier média",
      filters: [
        {
          name: "Audio / video",
          extensions: ["wav", "mp3", "m4a", "flac", "ogg", "mp4", "mkv", "mov"],
        },
      ],
    });
    if (typeof selected === "string") {
      setResumeFileLabel(fileBasename(selected));
    }
  }, []);

  const importRunEvents = useCallback(async () => {
    if (!activeRunSummary?.runDir) {
      setError("Ouvre un run (manifest) avant d indexer.");
      return;
    }
    setImportBusy(true);
    setError("");
    try {
      const r = await ipcInvokeDev<RunEventsImportResult>(
        "explorer:importEvents",
        "import_run_events",
        {
          runDir: activeRunSummary.runDir,
        },
      );
      setLastImport(r);
      await refreshSpeakers(activeRunSummary.runDir);
    } catch (e) {
      setError(String(e));
    } finally {
      setImportBusy(false);
    }
  }, [activeRunSummary?.runDir, refreshSpeakers, setError]);

  const deviceLabel = useMemo(() => {
    const dev = selectedJob?.whisperxOptions?.device?.trim();
    if (dev) {
      return dev;
    }
    return "auto";
  }, [selectedJob?.whisperxOptions?.device]);

  const runtimeBadges = useMemo(() => {
    const rs = runtimeStatus;
    if (!rs) {
      return { python: "?", whisperx: "?", ffmpeg: "?" };
    }
    return {
      python: rs.pythonOk ? "OK" : "KO",
      whisperx: rs.whisperxOk ? "OK" : "KO",
      ffmpeg: rs.ffmpegOk ? "OK" : "KO",
    };
  }, [runtimeStatus]);

  const statusChips = useMemo(() => {
    const s = activeRunSummary;
    const overlapHint = s?.warnings?.filter((w) => w.toLowerCase().includes("overlap")).length ?? 0;
    return {
      words: s?.statsNWords ?? null,
      speakers: s?.statsNSpeakerTurns ?? null,
      overlapWarnings: overlapHint,
      segments: s?.statsNSegments ?? null,
    };
  }, [activeRunSummary]);

  const resumeLine = useMemo(() => {
    const path = activeRunSummary?.inputMediaResolved ?? activeRunSummary?.inputMediaPath ?? "";
    const base = path ? fileBasename(path) : (resumeFileLabel ?? "");
    const dur = formatDuration(activeRunSummary?.durationSec ?? undefined);
    if (!base && dur === "—") {
      return "Aucun média — ouvre un run ou un fichier.";
    }
    return `${base || "—"} · ${dur}`;
  }, [activeRunSummary, resumeFileLabel]);

  const updateSpeakerAlias = useCallback((id: string, alias: string) => {
    setSpeakerRows((rows) => rows.map((r) => (r.id === id ? { ...r, alias } : r)));
  }, []);

  const toggleSpeakerVisible = useCallback((id: string) => {
    setSpeakerRows((rows) => rows.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r)));
  }, []);

  const toggleSolo = useCallback((id: string) => {
    setSoloSpeakerId((cur) => (cur === id ? null : id));
  }, []);

  const seekToNextPause = useCallback(async () => {
    if (!activeRunSummary?.runDir || !wf.waveform) {
      setError("Run + waveform requis pour la navigation.");
      return;
    }
    const durMs = Math.ceil(wf.waveform.durationSec * 1000);
    const curMs = Math.floor(wf.mediaCurrentSec * 1000) + 1;
    const t0 = Math.min(Math.max(0, curMs), durMs);
    const t1 = Math.max(t0 + 1, durMs);
    try {
      const res = await ipcInvokeDev<QueryWindowResult>(
        "explorer:seekNextPause",
        "query_run_events_window",
        {
          request: {
            runDir: activeRunSummary.runDir,
            t0Ms: t0,
            t1Ms: t1,
            layers: { pauses: true, turns: false, ipus: false, words: false },
            speakers: [],
            limits: { maxPauses: QUERY_WINDOW_DEFAULT_MAX.pauses },
          },
        },
      );
      const next = res.pauses.find((p) => p.startMs >= curMs);
      if (next) {
        wf.seekMedia(next.startMs / 1000);
      } else {
        setError("Aucune pause apres la position courante.");
      }
    } catch (e) {
      setError(String(e));
    }
  }, [wf, activeRunSummary?.runDir, setError]);

  const applyGoToTime = useCallback(() => {
    const raw = goToTimeInput.trim();
    if (!raw) {
      return;
    }
    const parts = raw.split(":").map((p) => p.trim());
    let sec = 0;
    if (parts.length === 1) {
      sec = Number(parts[0]);
    } else if (parts.length === 2) {
      sec = Number(parts[0]) * 60 + Number(parts[1]);
    } else if (parts.length === 3) {
      sec = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    }
    if (!Number.isFinite(sec) || sec < 0) {
      setError("Heure invalide (ex: 1:02:05 ou 90 ou 1:30).");
      return;
    }
    wf.seekMedia(sec);
  }, [goToTimeInput, setError, wf]);

  const toggleLayer = useCallback((key: keyof ExplorerLayerToggles) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return {
    activeRunSummary,
    resumeLine,
    explorerBusy,
    importBusy,
    lastImport,
    layers,
    toggleLayer,
    speakerRows,
    soloSpeakerId,
    updateSpeakerAlias,
    toggleSpeakerVisible,
    toggleSolo,
    pickOpenRun,
    pickOpenFile,
    importRunEvents,
    deviceLabel,
    runtimeBadges,
    statusChips,
    seekToNextPause,
    goToTimeInput,
    setGoToTimeInput,
    applyGoToTime,
    exportTimingPack,
    hasTranscriptSource,
    recalcMinPauseInput,
    setRecalcMinPauseInput,
    recalcIgnoreBelowInput,
    setRecalcIgnoreBelowInput,
    recalcPauseMaxInput,
    setRecalcPauseMaxInput,
    recalcIpuMinWordsInput,
    setRecalcIpuMinWordsInput,
    recalcIpuMinDurInput,
    setRecalcIpuMinDurInput,
    recalcStats,
    recalcBusy,
    applyRecalcPersist,
  };
}

export type StudioExplorerModel = ReturnType<typeof useStudioExplorer>;
