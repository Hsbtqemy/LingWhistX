import type { ReactNode } from "react";

export type ErrorBannerProps = {
  /** Contenu : texte, paragraphes ou WorkerErrorMessage. */
  children: ReactNode;
  /** Zone scrollable (logs / erreurs longues). */
  multiline?: boolean;
  className?: string;
};

/**
 * Alerte d’erreur harmonisée (bannière + picto), utilisée dans tout le studio.
 */
export function ErrorBanner({ children, multiline, className }: ErrorBannerProps) {
  return (
    <div
      className={["error-banner", multiline ? "error-banner--multiline" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="alert"
    >
      <span className="error-banner-mark" aria-hidden />
      <div className="error-banner-body">{children}</div>
    </div>
  );
}
