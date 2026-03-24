import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipcInvokeDev } from "../../dev/ipcPerf";
import { fileBasename, pathsEqualNormalized } from "../../appUtils";
import type { Job, RunEventsImportResult, RunManifestSummary } from "../../types";

export type ExplorerSpeakerUi = {
  id: string;
  alias: string;
  visible: boolean;
};

export type UseExplorerRunContextOptions = {
  selectedJob: Job | null;
  setSelectedJobId: (id: string) => void;
  setError: (message: string) => void;
};

export function useExplorerRunContext({
  selectedJob,
  setSelectedJobId,
  setError,
}: UseExplorerRunContextOptions) {
  const [activeRunSummary, setActiveRunSummary] = useState<RunManifestSummary | null>(null);
  const [resumeFileLabel, setResumeFileLabel] = useState<string | null>(null);
  const [speakerRows, setSpeakerRows] = useState<ExplorerSpeakerUi[]>([]);
  const [soloSpeakerId, setSoloSpeakerId] = useState<string | null>(null);
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [lastImport, setLastImport] = useState<RunEventsImportResult | null>(null);

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

  const updateSpeakerAlias = useCallback((id: string, alias: string) => {
    setSpeakerRows((rows) => rows.map((r) => (r.id === id ? { ...r, alias } : r)));
  }, []);

  const toggleSpeakerVisible = useCallback((id: string) => {
    setSpeakerRows((rows) => rows.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r)));
  }, []);

  const toggleSolo = useCallback((id: string) => {
    setSoloSpeakerId((cur) => (cur === id ? null : id));
  }, []);

  return {
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
  };
}
