import type { KeyboardEvent, ReactNode } from "react";
import { useCallback } from "react";

export type TabDef = { id: string; label: string };

export type TabListBarProps = {
  tabs: readonly TabDef[];
  value: string;
  onValueChange: (id: string) => void;
  /** Préfixe stable pour `id` / `aria-controls` (un par groupe d’onglets à l’écran). */
  idPrefix: string;
  "aria-label"?: string;
};

/**
 * Tablist avec flèches ←/→, Home/End (WX-629, pattern WAI-ARIA tabs).
 */
export function TabListBar({
  tabs,
  value,
  onValueChange,
  idPrefix,
  "aria-label": ariaLabel = "Sections",
}: TabListBarProps) {
  const selectTab = useCallback(
    (id: string) => {
      onValueChange(id);
      requestAnimationFrame(() => {
        document.getElementById(`${idPrefix}-tab-${id}`)?.focus();
      });
    },
    [onValueChange, idPrefix],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = tabs.map((t) => t.id);
    const i = ids.indexOf(value);
    if (i < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectTab(ids[(i + 1) % ids.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectTab(ids[(i - 1 + ids.length) % ids.length]);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectTab(ids[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      selectTab(ids[ids.length - 1]);
    }
  };

  return (
    <div role="tablist" className="lx-tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className={`lx-tab ${value === t.id ? "is-active" : ""}`}
          onClick={() => selectTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export type TabPanelProps = {
  tabId: string;
  idPrefix: string;
  hidden: boolean;
  children: ReactNode;
  className?: string;
};

export function TabPanel({ tabId, idPrefix, hidden, children, className }: TabPanelProps) {
  const panelClass = className ? `lx-tabpanel ${className}` : "lx-tabpanel";
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tabId}`}
      aria-labelledby={`${idPrefix}-tab-${tabId}`}
      hidden={hidden}
      className={panelClass}
    >
      {children}
    </div>
  );
}
