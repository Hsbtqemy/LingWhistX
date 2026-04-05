import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Sous cette largeur : menu « Autres… » pour une partie des contrôles Lecture */
export const EDITOR_TOOLBAR_PLAYBACK_OVERFLOW_PX = 520;

/** Sous cette largeur : menu « Autres… » pour une partie des actions Segments */
export const EDITOR_TOOLBAR_SEGMENTS_OVERFLOW_PX = 420;

/** Sous cette largeur : options export (chevauchements, convention, marques) dans « Autres… » */
export const EDITOR_TOOLBAR_EXPORT_OVERFLOW_PX = 600;

export function useEditorToolbarLayout() {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [narrowPlayback, setNarrowPlayback] = useState(false);
  const [narrowSegments, setNarrowSegments] = useState(false);
  const [narrowExport, setNarrowExport] = useState(false);

  const measure = () => {
    const el = toolbarRef.current;
    if (!el) return;
    const w = el.getBoundingClientRect().width;
    setNarrowPlayback(w < EDITOR_TOOLBAR_PLAYBACK_OVERFLOW_PX);
    setNarrowSegments(w < EDITOR_TOOLBAR_SEGMENTS_OVERFLOW_PX);
    setNarrowExport(w < EDITOR_TOOLBAR_EXPORT_OVERFLOW_PX);
  };

  useLayoutEffect(() => {
    measure();
  }, []);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { toolbarRef, narrowPlayback, narrowSegments, narrowExport };
}
