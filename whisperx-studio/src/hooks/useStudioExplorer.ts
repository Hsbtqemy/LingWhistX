import { useCallback, useEffect, useMemo, useState } from "react";
import { ipcInvokeDev } from "../dev/ipcPerf";
import { fileBasename } from "../appUtils";
import type { ExplorerLayerToggles, Job, QueryWindowResult, RuntimeStatus } from "../types";
import { QUERY_WINDOW_DEFAULT_MAX } from "../types";
import type { WaveformWorkspace } from "./useWaveformWorkspace";
import { EXPLORER_LAYERS_STORAGE_KEY, loadExplorerLayers } from "./explorer/studioExplorerLayers";
import { formatDuration } from "./explorer/studioExplorerUi";
import { useExplorerRecalc } from "./explorer/useExplorerRecalc";
import { useExplorerRunContext } from "./explorer/useExplorerRunContext";

export type { ExplorerSpeakerUi } from "./explorer/useExplorerRunContext";

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
  const {
    activeRunSummary,
    resumeFileLabel,
    speakerRows,
    soloSpeakerId,
    explorerBusy,
    importBusy,
    lastImport,
    pickOpenRun,
    pickOpenFile,
    importRunEvents,
    updateSpeakerAlias,
    toggleSpeakerVisible,
    toggleSolo,
  } = useExplorerRunContext({ selectedJob, setSelectedJobId, setError });

  const [layers, setLayers] = useState<ExplorerLayerToggles>(() => loadExplorerLayers());
  const [goToTimeInput, setGoToTimeInput] = useState("");

  const {
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
  } = useExplorerRecalc(activeRunSummary?.runDir, setError);

  useEffect(() => {
    try {
      sessionStorage.setItem(EXPLORER_LAYERS_STORAGE_KEY, JSON.stringify(layers));
    } catch {
      /* ignore */
    }
  }, [layers]);

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
