import { useCallback, useState } from "react";

/** Nombre maximal de messages conservés (les plus récents). */
export const APP_ERROR_STACK_MAX = 5;

export type UseAppErrorStackResult = {
  errors: string[];
  /** Chaîne vide : vide la pile ; sinon : ajoute un message (sans écraser les précédents). */
  setError: (message: string) => void;
  clearErrors: () => void;
};

/**
 * Pile d’erreurs globales pour le shell Studio (voir backlog **WX-625**, `audit/refactor-hooks-plan.md`).
 * Styles associés : `ErrorBanner` + `.error-banner` dans `App.css` (tokens `--lx-danger` / surface, **WX-634**).
 */
export function useAppErrorStack(maxMessages = APP_ERROR_STACK_MAX): UseAppErrorStackResult {
  const [errors, setErrors] = useState<string[]>([]);

  const setError = useCallback(
    (message: string) => {
      if (!message.trim()) {
        setErrors([]);
      } else {
        setErrors((prev) => [...prev, message].slice(-maxMessages));
      }
    },
    [maxMessages],
  );

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  return { errors, setError, clearErrors };
}
