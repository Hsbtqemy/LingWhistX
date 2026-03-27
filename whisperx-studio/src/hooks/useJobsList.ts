import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fileBasename, upsertJobInList } from "../appUtils";
import type {
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

    return () => {
      void unlistenJobPromise.then((unlisten) => unlisten());
      void unlistenLogPromise.then((unlisten) => unlisten());
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
    focusJobDetails,
    selectedJob,
    selectedJobLogs,
    selectedLiveTranscript,
    selectedJobHasJsonOutput,
    runningJobs,
    sessionRestorePrompt,
    restoreSession,
    dismissSessionRestore,
  };
}
