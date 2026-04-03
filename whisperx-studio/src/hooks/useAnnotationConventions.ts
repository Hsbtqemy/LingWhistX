import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AnnotationConvention } from "../types";
import {
  ANNOTATION_CONVENTION_STORAGE_KEY,
  BUILTIN_ANNOTATION_CONVENTIONS,
  DEFAULT_ANNOTATION_CONVENTION_ID,
} from "../constants";

type UserConventionJson = {
  id: string;
  label: string;
  description: string;
  marks: AnnotationConvention["marks"];
};

export type UseAnnotationConventionsReturn = {
  /** Toutes les conventions disponibles (built-in + utilisateur). */
  conventions: AnnotationConvention[];
  activeConventionId: string;
  setActiveConventionId: (id: string) => void;
  /** Convention active résolue (null si l'id n'est plus valide). */
  activeConvention: AnnotationConvention | null;
  saveUserConvention: (convention: AnnotationConvention) => Promise<void>;
  deleteUserConvention: (id: string) => Promise<void>;
  isLoading: boolean;
  error: string;
};

export function useAnnotationConventions(): UseAnnotationConventionsReturn {
  const [userConventions, setUserConventions] = useState<AnnotationConvention[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeConventionId, setActiveConventionIdState] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(ANNOTATION_CONVENTION_STORAGE_KEY) ?? DEFAULT_ANNOTATION_CONVENTION_ID
      );
    } catch {
      return DEFAULT_ANNOTATION_CONVENTION_ID;
    }
  });

  useEffect(() => {
    setIsLoading(true);
    void invoke<UserConventionJson[]>("read_user_conventions")
      .then((raw) => {
        setUserConventions(raw.map((c) => ({ ...c, isBuiltin: false })));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setIsLoading(false));
  }, []);

  const conventions = useMemo<AnnotationConvention[]>(
    () => [...BUILTIN_ANNOTATION_CONVENTIONS, ...userConventions],
    [userConventions],
  );

  const activeConvention = useMemo(
    () => conventions.find((c) => c.id === activeConventionId) ?? null,
    [conventions, activeConventionId],
  );

  const setActiveConventionId = useCallback((id: string) => {
    setActiveConventionIdState(id);
    try {
      localStorage.setItem(ANNOTATION_CONVENTION_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const saveUserConvention = useCallback(async (convention: AnnotationConvention) => {
    await invoke("save_user_convention", { convention });
    setUserConventions((prev) => {
      const idx = prev.findIndex((c) => c.id === convention.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...convention, isBuiltin: false };
        return next;
      }
      return [...prev, { ...convention, isBuiltin: false }];
    });
  }, []);

  const deleteUserConvention = useCallback(async (id: string) => {
    await invoke("delete_user_convention", { id });
    setUserConventions((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return {
    conventions,
    activeConventionId,
    setActiveConventionId,
    activeConvention,
    saveUserConvention,
    deleteUserConvention,
    isLoading,
    error,
  };
}
