import { useCallback, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { PLAYBACK_RATE_STEP } from "./usePlayerPlayback";
import type { PlayerDerivedAlert } from "../player/derivePlayerAlerts";
import type { PlayerViewportMode } from "../components/player/PlayerRunWindowViews";
import type { EditableSegment } from "../types";

function nextAlertIndex(alerts: PlayerDerivedAlert[], playheadMs: number): number {
  for (let i = 0; i < alerts.length; i++) {
    if (alerts[i].startMs > playheadMs + 80) {
      return i;
    }
  }
  return alerts.length > 0 ? 0 : -1;
}

function prevAlertIndex(alerts: PlayerDerivedAlert[], playheadMs: number): number {
  for (let i = alerts.length - 1; i >= 0; i--) {
    if (alerts[i].startMs < playheadMs - 80) {
      return i;
    }
  }
  return alerts.length > 0 ? alerts.length - 1 : -1;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) {
    return false;
  }
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}

export type UsePlayerKeyboardOptions = {
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: Dispatch<SetStateAction<boolean>>;
  togglePlayPause: () => void | Promise<void>;
  copyPlayheadToClipboard: () => void | Promise<void>;
  exportRunTimingPack: () => void | Promise<void>;
  exportPackBusy: boolean;
  openRunFolder: () => void | Promise<void>;
  runDir: string | null;
  stop: () => void;
  seek: (sec: number) => void;
  seekRelative: (delta: number) => void;
  durationSec: number | null | undefined;
  mediaSrc: string | null | undefined;
  manifestError: string | null | undefined;
  /** Même rôle que manifestError pour désactiver transport / raccourcis si le média ne charge pas. */
  mediaLoadError: string | null | undefined;
  nudgePlaybackRate: (delta: number) => void;
  setViewportMode: Dispatch<SetStateAction<PlayerViewportMode>>;
  displayedAlerts: PlayerDerivedAlert[];
  playheadMs: number;
  setFollowPlayhead: Dispatch<SetStateAction<boolean>>;
  setWordsWindowEnabled: Dispatch<SetStateAction<boolean>>;
  toggleMute: () => void;
  toggleVideoFullscreen: () => void | Promise<void>;
  isVideo: boolean;
  loopAsec: number | null | undefined;
  loopBsec: number | null | undefined;
  markLoopA: () => void;
  markLoopB: () => void;
  clearLoop: () => void;
  runSpeakerIds: string[];
  setSpeakerSolo: Dispatch<SetStateAction<string | null>>;
  fullscreenMode?: boolean;
  setFullscreenMode?: Dispatch<SetStateAction<boolean>>;
  editorSegments?: EditableSegment[];
};

export function usePlayerKeyboard(o: UsePlayerKeyboardOptions) {
  return useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (isEditableTarget(e.target)) {
        return;
      }
      if (e.code === "Escape" && o.shortcutsHelpOpen) {
        e.preventDefault();
        o.setShortcutsHelpOpen(false);
        return;
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        o.setShortcutsHelpOpen((v) => !v);
        return;
      }
      if (e.code === "F11" && o.setFullscreenMode) {
        e.preventDefault();
        o.setFullscreenMode((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyF" && o.setFullscreenMode) {
        e.preventDefault();
        o.setFullscreenMode((v) => !v);
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        void o.togglePlayPause();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyC" && !e.altKey) {
        e.preventDefault();
        void o.copyPlayheadToClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyE" && !e.altKey) {
        e.preventDefault();
        if (!o.runDir || o.exportPackBusy) {
          return;
        }
        void o.exportRunTimingPack();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyO" && !e.altKey) {
        e.preventDefault();
        if (!o.runDir) {
          return;
        }
        void o.openRunFolder();
        return;
      }
      if (e.code === "Home" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!o.mediaSrc || o.manifestError) {
          return;
        }
        o.stop();
        return;
      }
      if (e.code === "End" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!o.mediaSrc || o.manifestError) {
          return;
        }
        const dur = o.durationSec;
        if (dur != null && Number.isFinite(dur) && dur > 0) {
          o.seek(dur);
        }
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
        o.seekRelative(-step);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
        o.seekRelative(step);
        return;
      }
      if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        o.nudgePlaybackRate(-PLAYBACK_RATE_STEP);
        return;
      }
      if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        o.nudgePlaybackRate(PLAYBACK_RATE_STEP);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "Digit1") {
        e.preventDefault();
        o.setViewportMode("lanes");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "Digit2") {
        e.preventDefault();
        o.setViewportMode("chat");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "Digit3") {
        e.preventDefault();
        o.setViewportMode("words");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "Digit4") {
        e.preventDefault();
        o.setViewportMode("columns");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "Digit5") {
        e.preventDefault();
        o.setViewportMode("rythmo");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "Digit6") {
        e.preventDefault();
        o.setViewportMode("karaoke");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "Digit7") {
        e.preventDefault();
        o.setViewportMode("stats");
        return;
      }
      if (e.code === "KeyN" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const idx = nextAlertIndex(o.displayedAlerts, o.playheadMs);
        if (idx >= 0) {
          o.seek(o.displayedAlerts[idx].startMs / 1000);
        }
        return;
      }
      if (e.code === "KeyP" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const idx = prevAlertIndex(o.displayedAlerts, o.playheadMs);
        if (idx >= 0) {
          o.seek(o.displayedAlerts[idx].startMs / 1000);
        }
        return;
      }
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        o.setFollowPlayhead((v) => !v);
        return;
      }
      if (e.code === "KeyW" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        o.setWordsWindowEnabled((v) => !v);
        return;
      }
      if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!o.mediaSrc || o.manifestError || o.mediaLoadError) {
          return;
        }
        o.toggleMute();
        return;
      }
      if (e.code === "Enter" && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!o.mediaSrc || o.manifestError || o.mediaLoadError || !o.isVideo) {
          return;
        }
        void o.toggleVideoFullscreen();
        return;
      }
      if (e.code === "KeyL" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!o.mediaSrc || o.manifestError || o.mediaLoadError) {
          return;
        }
        if (o.loopAsec == null) {
          o.markLoopA();
        } else if (o.loopBsec == null) {
          o.markLoopB();
        } else {
          o.clearLoop();
        }
        return;
      }
      if (e.code === "BracketLeft" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const segs = o.editorSegments;
        if (segs && segs.length > 0) {
          const playheadSec = o.playheadMs / 1000;
          for (let i = segs.length - 1; i >= 0; i--) {
            if (segs[i].start < playheadSec - 0.08) {
              o.seek(segs[i].start);
              break;
            }
          }
        }
        return;
      }
      if (e.code === "BracketRight" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const segs = o.editorSegments;
        if (segs && segs.length > 0) {
          const playheadSec = o.playheadMs / 1000;
          for (const seg of segs) {
            if (seg.start > playheadSec + 0.08) {
              o.seek(seg.start);
              break;
            }
          }
        }
        return;
      }
      if (e.code === "Digit0" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        o.setSpeakerSolo(null);
        return;
      }
      if (
        e.code.startsWith("Digit") &&
        e.code !== "Digit0" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const n = Number.parseInt(e.code.replace("Digit", ""), 10);
        if (n >= 1 && n <= 9) {
          e.preventDefault();
          const id = o.runSpeakerIds[n - 1];
          if (!id) {
            return;
          }
          o.setSpeakerSolo((prev) => (prev === id ? null : id));
        }
        return;
      }
    },
    [o],
  );
}
