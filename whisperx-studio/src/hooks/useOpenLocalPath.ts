import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useOpenLocalPath(setError: Dispatch<SetStateAction<string>>) {
  return useCallback(
    async (path: string) => {
      try {
        await invoke("open_local_path", { path });
      } catch (e) {
        setError(String(e));
      }
    },
    [setError],
  );
}
