import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { upsertJobInList } from "../appUtils";
import type { Job, JobLogEvent, JobsPaginationInfo } from "../types";

/** Rafraîchissement liste jobs quand au moins un job est `queued` ou `running`. */
const JOBS_REFRESH_MS_ACTIVE = 1500;
/** Sinon : moins d’appels IPC tant que l’historique est statique. */
const JOBS_REFRESH_MS_IDLE = 20_000;

const SELECTED_JOB_STORAGE_KEY = "lx-studio-selected-job-id";

export type UseJobsListOptions = {
  runDetailsRef: RefObject<HTMLElement | null>;
  setError: (message: string) => void;
  onSelectedJobBecameInvalid: () => void;
};

export function useJobsList({
  runDetailsRef,
  setError,
  onSelectedJobBecameInvalid,
}: UseJobsListOptions) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobLogs, setJobLogs] = useState<Record<string, JobLogEvent[]>>({});
  const [selectedJobId, setSelectedJobId] = useState(() => {
    try {
      return sessionStorage.getItem(SELECTED_JOB_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [jobsPagination, setJobsPagination] = useState<JobsPaginationInfo | null>(null);
  const [loadMoreJobsLoading, setLoadMoreJobsLoading] = useState(false);

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
      setJobs((current) => upsertJobInList(current, event.payload));
    });

    const unlistenLogPromise = listen<JobLogEvent>("job-log", (event) => {
      setJobLogs((current) => {
        const existing = current[event.payload.jobId] ?? [];
        const nextLogs = [...existing, event.payload].slice(-600);
        return { ...current, [event.payload.jobId]: nextLogs };
      });
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

  const selectedJobHasJsonOutput = useMemo(() => {
    if (!selectedJob) {
      return false;
    }
    return selectedJob.outputFiles.some((path) => path.toLowerCase().endsWith(".json"));
  }, [selectedJob]);

  const focusJobDetails = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId);
      window.setTimeout(() => {
        runDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    },
    [runDetailsRef],
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
    selectedJobHasJsonOutput,
    runningJobs,
  };
}
