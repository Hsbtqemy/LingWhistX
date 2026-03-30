import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fileBasename, upsertJobInList } from "../appUtils";
import type {
  AudioQualityReport,
  Job,
  JobLogEvent,
  JobsPaginationInfo,
  LiveTranscriptSegment,
  SessionRestorePrompt,
} from "../types";
import { parseLiveTranscriptPayload } from "../utils/liveTranscript";

/** Rafraîchissement liste jobs quand au moins un job est `queued` ou `running`. */
const JOBS_REFRESH_MS_ACTIVE = 1500;
/** Sinon : moins d’appels IPC tant que l’historique est statique. */
const JOBS_REFRESH_MS_IDLE = 20_000;

const SELECTED_JOB_STORAGE_KEY = "lx-studio-selected-job-id";
/** Dernier job consulté — survit à la fermeture de l’app (proposition « Restaurer la session »). */
const LOCAL_LAST_SESSION_JOB_KEY = "lx-studio-last-session-job-id";

/** Limite de segments ASR en mémoire par job (fichiers très longs). */
const LIVE_TRANSCRIPT_MAX_SEGMENTS = 8000;

export type UseJobsListOptions = {
  runDetailsRef: RefObject<HTMLElement | null>;
  setError: (message: string) => void;
  onSelectedJobBecameInvalid: () => void;
  /** Ex. basculer vers l’onglet Studio après sélection depuis l’historique (onglet séparé). */
  onAfterFocusJobDetails?: () => void;
};

export function useJobsList({
  runDetailsRef,
  setError,
  onSelectedJobBecameInvalid,
  onAfterFocusJobDetails,
}: UseJobsListOptions) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobLogs, setJobLogs] = useState<Record<string, JobLogEvent[]>>({});
  const [liveTranscriptByJob, setLiveTranscriptByJob] = useState<
    Record<string, LiveTranscriptSegment[]>
  >({});
  /** WX-661 — rapport qualité audio par job (réinitialisé à chaque nouveau run). */
  const [audioQualityByJob, setAudioQualityByJob] = useState<Record<string, AudioQualityReport>>(
    {},
  );
  const [selectedJobId, setSelectedJobId] = useState(() => {
    try {
      return sessionStorage.getItem(SELECTED_JOB_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [jobsPagination, setJobsPagination] = useState<JobsPaginationInfo | null>(null);
  const [loadMoreJobsLoading, setLoadMoreJobsLoading] = useState(false);
  const [sessionRestorePrompt, setSessionRestorePrompt] = useState<SessionRestorePrompt | null>(
    null,
  );
  const sessionRestoreOfferedRef = useRef(false);

  const refreshJobs = useCallback(async () => {
    try {
      const nextJobs = await invoke<Job[]>("list_jobs");
      setJobs(nextJobs);
      const info = await invoke<JobsPaginationInfo>("get_jobs_pagination_info");
      setJobsPagination(info);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const loadMoreJobs = useCallback(async () => {
    setError("");
    setLoadMoreJobsLoading(true);
    try {
      await invoke("load_more_jobs_from_db");
      await refreshJobs();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadMoreJobsLoading(false);
    }
  }, [refreshJobs, setError]);

  const runningJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running").length,
    [jobs],
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(SELECTED_JOB_STORAGE_KEY, selectedJobId);
    } catch {
      /* ignore */
    }
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }
    try {
      localStorage.setItem(LOCAL_LAST_SESSION_JOB_KEY, selectedJobId);
    } catch {
      /* ignore */
    }
  }, [selectedJobId]);

  useEffect(() => {
    if (jobs.length === 0 || sessionRestoreOfferedRef.current) {
      return;
    }
    let lastId: string;
    try {
      lastId = localStorage.getItem(LOCAL_LAST_SESSION_JOB_KEY) ?? "";
    } catch {
      return;
    }
    if (!lastId || !jobs.some((j) => j.id === lastId) || lastId === selectedJobId) {
      return;
    }
    sessionRestoreOfferedRef.current = true;
    const job = jobs.find((j) => j.id === lastId);
    const label = job ? fileBasename(job.inputPath) || job.id : lastId;
    setSessionRestorePrompt({ jobId: lastId, label });
  }, [jobs, selectedJobId]);

  useEffect(() => {
    void refreshJobs();
    const intervalMs = runningJobs > 0 ? JOBS_REFRESH_MS_ACTIVE : JOBS_REFRESH_MS_IDLE;
    const timer = window.setInterval(() => {
      void refreshJobs();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [refreshJobs, runningJobs]);

  /** Reprendre un état à jour après retour dans l’app (polling idle = 20 s). */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshJobs();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshJobs]);

  useEffect(() => {
    const unlistenJobPromise = listen<Job>("job-updated", (event) => {
      const payload = event.payload;
      setJobs((current) => upsertJobInList(current, payload));
      const segs = payload.liveTranscriptSegments;
      if (segs?.length) {
        setLiveTranscriptByJob((prev) => {
          const existing = prev[payload.id] ?? [];
          if (segs.length < existing.length) {
            return prev;
          }
          return { ...prev, [payload.id]: segs };
        });
      }
    });

    const unlistenDeletedPromise = listen<{ jobId: string }>("job-deleted", (event) => {
      const id = event.payload.jobId;
      setJobs((prev) => prev.filter((j) => j.id !== id));
      setJobLogs((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setLiveTranscriptByJob((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setAudioQualityByJob((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });

    const unlistenLogPromise = listen<JobLogEvent>("job-log", (event) => {
      const payload = event.payload;
      setJobLogs((current) => {
        const existing = current[payload.jobId] ?? [];
        const nextLogs = [...existing, payload].slice(-600);
        return { ...current, [payload.jobId]: nextLogs };
      });
      if (payload.stage === "wx_live_transcript") {
        const seg = parseLiveTranscriptPayload(payload.message);
        if (seg) {
          setLiveTranscriptByJob((prev) => {
            const list = prev[payload.jobId] ?? [];
            if (list.length >= LIVE_TRANSCRIPT_MAX_SEGMENTS) {
              return prev;
            }
            return { ...prev, [payload.jobId]: [...list, seg] };
          });
        }
      }
    });

    const unlistenAudioQualityPromise = listen<{ jobId: string; report: AudioQualityReport }>(
      "job-audio-quality",
      (event) => {
        const { jobId, report } = event.payload;
        setAudioQualityByJob((prev) => ({ ...prev, [jobId]: report }));
      },
    );

    return () => {
      void unlistenJobPromise.then((unlisten) => unlisten());
      void unlistenDeletedPromise.then((unlisten) => unlisten());
      void unlistenLogPromise.then((unlisten) => unlisten());
      void unlistenAudioQualityPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) {
      setSelectedJobId(jobs[0].id);
      return;
    }
    if (selectedJobId && !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0]?.id ?? "");
      onSelectedJobBecameInvalid();
    }
  }, [jobs, selectedJobId, onSelectedJobBecameInvalid]);

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

  const selectedLiveTranscript = useMemo((): LiveTranscriptSegment[] => {
    if (!selectedJob) {
      return [];
    }
    const fromSession = liveTranscriptByJob[selectedJob.id] ?? [];
    const fromDb = selectedJob.liveTranscriptSegments ?? [];
    if (fromSession.length >= fromDb.length) {
      return fromSession;
    }
    return fromDb;
  }, [selectedJob, liveTranscriptByJob]);

  const selectedJobHasJsonOutput = useMemo(() => {
    if (!selectedJob) {
      return false;
    }
    return selectedJob.outputFiles.some((path) => path.toLowerCase().endsWith(".json"));
  }, [selectedJob]);

  const focusJobDetails = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId);
      onAfterFocusJobDetails?.();
      window.setTimeout(() => {
        runDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    },
    [runDetailsRef, onAfterFocusJobDetails],
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      setError("");
      try {
        await invoke("cancel_job", { jobId });
        await refreshJobs();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshJobs, setError],
  );

  const deleteJob = useCallback(
    async (jobId: string) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          "Retirer ce job de l'historique ? Les fichiers sur disque (dossier de sortie) ne sont pas supprimés.",
        )
      ) {
        return;
      }
      setError("");
      try {
        await invoke("delete_job", { jobId });
        setJobLogs((current) => {
          const next = { ...current };
          delete next[jobId];
          return next;
        });
        setLiveTranscriptByJob((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
        await refreshJobs();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshJobs, setError],
  );

  const restoreSession = useCallback(() => {
    if (!sessionRestorePrompt) {
      return;
    }
    const { jobId } = sessionRestorePrompt;
    setSessionRestorePrompt(null);
    focusJobDetails(jobId);
  }, [sessionRestorePrompt, focusJobDetails]);

  const dismissSessionRestore = useCallback(() => {
    setSessionRestorePrompt(null);
    try {
      localStorage.removeItem(LOCAL_LAST_SESSION_JOB_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // WX-672 — Priorité et réordonnancement
  const setJobPriority = useCallback(
    async (jobId: string, priority: 0 | 1 | 2 | 3) => {
      try {
        const updated = await invoke<Job>("set_job_priority", { jobId, priority });
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      } catch (err) {
        setError(String(err));
      }
    },
    [setError],
  );

  const reorderJobs = useCallback(
    async (orderedIds: string[]) => {
      // Optimistic update
      setJobs((prev) => {
        const byId = new Map(prev.map((j) => [j.id, j]));
        const reordered = orderedIds.map((id, idx) => {
          const j = byId.get(id);
          return j ? { ...j, queueOrder: idx } : null;
        }).filter(Boolean) as Job[];
        const rest = prev.filter((j) => !orderedIds.includes(j.id));
        return [...reordered, ...rest];
      });
      try {
        await invoke("reorder_jobs", { orderedIds });
      } catch (err) {
        setError(String(err));
        void refreshJobs();
      }
    },
    [setError, refreshJobs],
  );

  return {
    jobs,
    jobLogs,
    selectedJobId,
    setSelectedJobId,
    refreshJobs,
    loadMoreJobs,
    loadMoreJobsLoading,
    jobsPagination,
    cancelJob,
    deleteJob,
    focusJobDetails,
    selectedJob,
    selectedJobLogs,
    selectedLiveTranscript,
    selectedJobHasJsonOutput,
    runningJobs,
    audioQualityByJob,
    sessionRestorePrompt,
    restoreSession,
    dismissSessionRestore,
    setJobPriority,
    reorderJobs,
  };
}
