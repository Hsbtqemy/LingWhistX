/**
 * @vitest-environment jsdom
 */
import { createRef, act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useJobsList } from "./useJobsList";
import type { Job, JobsPaginationInfo } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

const paginationSample: JobsPaginationInfo = {
  hasMore: true,
  totalInDb: 500,
  nextDbOffset: 200,
};

function jobStub(id: string): Job {
  return {
    id,
    inputPath: "/in.wav",
    outputDir: "/out",
    mode: "mock",
    status: "done",
    progress: 100,
    message: "",
    createdAtMs: 1,
    updatedAtMs: 1,
    outputFiles: [],
  };
}

describe("useJobsList — loadMoreJobs", () => {
  const setError = vi.fn();
  const onInvalid = vi.fn();
  const runDetailsRef = createRef<HTMLElement | null>();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setError.mockClear();
    onInvalid.mockClear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_jobs") {
        return [] as Job[];
      }
      if (cmd === "get_jobs_pagination_info") {
        return paginationSample;
      }
      if (cmd === "load_more_jobs_from_db") {
        return undefined;
      }
      throw new Error(`invoke inattendu: ${cmd}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appelle load_more puis refresh (list_jobs + get_jobs_pagination_info)", async () => {
    const { result } = renderHook(() =>
      useJobsList({
        runDetailsRef,
        setError,
        onSelectedJobBecameInvalid: onInvalid,
      }),
    );

    await waitFor(() => {
      expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const callsAfterMount = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(callsAfterMount[0]).toBe("list_jobs");
    expect(callsAfterMount[1]).toBe("get_jobs_pagination_info");

    vi.mocked(invoke).mockClear();

    await act(async () => {
      await result.current.loadMoreJobs();
    });

    const loadMoreCalls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(loadMoreCalls).toEqual([
      "load_more_jobs_from_db",
      "list_jobs",
      "get_jobs_pagination_info",
    ]);
    expect(result.current.loadMoreJobsLoading).toBe(false);
    expect(setError).toHaveBeenCalledWith("");
  });

  it("réinitialise loadMoreJobsLoading et propage l’erreur si load_more échoue", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_jobs") {
        return [] as Job[];
      }
      if (cmd === "get_jobs_pagination_info") {
        return paginationSample;
      }
      if (cmd === "load_more_jobs_from_db") {
        throw new Error("sqlite busy");
      }
      throw new Error(`invoke inattendu: ${cmd}`);
    });

    const { result } = renderHook(() =>
      useJobsList({
        runDetailsRef,
        setError,
        onSelectedJobBecameInvalid: onInvalid,
      }),
    );

    await waitFor(() => {
      expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    await act(async () => {
      await result.current.loadMoreJobs();
    });

    expect(result.current.loadMoreJobsLoading).toBe(false);
    expect(setError).toHaveBeenCalledWith("Error: sqlite busy");
  });

  it("après load_more, les jobs listés reflètent list_jobs", async () => {
    let listCall = 0;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_jobs") {
        listCall += 1;
        return listCall === 1 ? ([] as Job[]) : ([jobStub("j-after")] as Job[]);
      }
      if (cmd === "get_jobs_pagination_info") {
        return paginationSample;
      }
      if (cmd === "load_more_jobs_from_db") {
        return undefined;
      }
      throw new Error(`invoke inattendu: ${cmd}`);
    });

    const { result } = renderHook(() =>
      useJobsList({
        runDetailsRef,
        setError,
        onSelectedJobBecameInvalid: onInvalid,
      }),
    );

    await waitFor(() => {
      expect(result.current.jobs).toEqual([]);
    });

    await act(async () => {
      await result.current.loadMoreJobs();
    });

    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(1);
      expect(result.current.jobs[0]?.id).toBe("j-after");
    });
  });
});
