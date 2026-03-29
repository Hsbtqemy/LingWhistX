import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { clampNumber, isVideoFile } from "../appUtils";
import type { RunManifestSummary } from "../types";

/** Message lisible quand le moteur ne donne que « Load failed » (WebKit). */
function describeMediaElementError(el: HTMLMediaElement, path: string | null): string {
  const code = el.error?.code;
  const codeHint =
    code === MediaError.MEDIA_ERR_ABORTED
      ? "chargement interrompu"
      : code === MediaError.MEDIA_ERR_NETWORK
        ? "erreur réseau / lecture fichier"
        : code === MediaError.MEDIA_ERR_DECODE
          ? "décodage impossible (fichier corrompu ou format ambigu)"
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? "format non supporté, ou fichier hors périmètre du protocole asset (chemins sous $HOME, etc. — redémarrer l’app après config)"
            : code != null
              ? `code média ${code}`
              : "";
  const pathLine = path?.trim() ? `Chemin : ${path}` : "Chemin inconnu.";
  return [
    "Impossible de charger le média dans le lecteur.",
    codeHint && `(${codeHint})`,
    pathLine,
    "Vérifie que le fichier existe, lance l’app avec « npm run tauri dev » (pas le navigateur seul), et que le chemin est couvert par security.assetProtocol.scope dans tauri.conf.json (souvent sous $HOME ou dossiers utilisateur).",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Rend les erreurs IPC manifest lisibles (chemins refusés côté Rust / périmètre sortie). */
function formatManifestReadError(err: unknown): string {
  const s = String(err);
  const lower = s.toLowerCase();
  if (
    lower.includes("path") &&
    (lower.includes("denied") ||
      lower.includes("not allowed") ||
      lower.includes("must be") ||
      lower.includes("invalid") ||
      lower.includes("unable to resolve"))
  ) {
    return [
      "Le dossier du run ou le chemin média n’est pas accepté par l’application (règles de sécurité des chemins).",
      "Place le run sous une racine autorisée : données app, Documents, Téléchargements, répertoire utilisateur ou volume amovible — voir README « Chemins et médias ».",
      `Détail : ${s}`,
    ].join(" ");
  }
  return s;
}

const PLAYBACK_RATE_MIN = 0.5;
const PLAYBACK_RATE_MAX = 2;
const PLAYBACK_RATE_STEP = 0.25;

function clampPlaybackRate(rate: number): number {
  return clampNumber(rate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX);
}

const WX_PLAYER_VOLUME_KEY = "wx-player-volume";
const WX_PLAYER_MUTED_KEY = "wx-player-muted";

function readStoredVolume(): number {
  if (typeof sessionStorage === "undefined") {
    return 1;
  }
  const raw = sessionStorage.getItem(WX_PLAYER_VOLUME_KEY);
  if (raw == null) {
    return 1;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
}

function readStoredMuted(): boolean {
  if (typeof sessionStorage === "undefined") {
    return false;
  }
  return sessionStorage.getItem(WX_PLAYER_MUTED_KEY) === "1";
}

export { PLAYBACK_RATE_STEP };

export type PlayerMediaHandlers = {
  onLoadedMetadata: () => void;
  onPlay: () => void;
  onPause: () => void;
  onError: (event: SyntheticEvent<HTMLMediaElement>) => void;
};

export type UsePlayerPlaybackResult = {
  manifestLoading: boolean;
  manifestError: string | null;
  /** Échec chargement `<audio>` / `<video>` (ex. TypeError / Load failed). */
  mediaLoadError: string | null;
  summary: RunManifestSummary | null;
  mediaSrc: string | null;
  mediaPath: string | null;
  isVideo: boolean;
  durationSec: number | null;
  currentTimeSec: number;
  playing: boolean;
  playbackRate: number;
  loopAsec: number | null;
  loopBsec: number | null;
  mediaRef: RefObject<HTMLMediaElement | null>;
  mediaHandlers: PlayerMediaHandlers;
  play: () => Promise<void>;
  pause: () => void;
  togglePlayPause: () => Promise<void>;
  /** Pause et retour au début (spec transport). */
  stop: () => void;
  seek: (sec: number) => void;
  seekRelative: (deltaSec: number) => void;
  nudgePlaybackRate: (delta: number) => void;
  setPlaybackRate: (rate: number) => void;
  markLoopA: () => void;
  markLoopB: () => void;
  clearLoop: () => void;
  /** Définit la boucle A–B en secondes (ex. mini-carte Lanes, WX-653). */
  setLoopRange: (aSec: number, bSec: number) => void;
  /** 0–1 */
  volume: number;
  muted: boolean;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleMute: () => void;
};

/**
 * Lecture média pour le Player (WX-624) : manifest → chemin média, transport, RAF pour le timecode.
 * Pas d’IPC à haute fréquence : seule la lecture fichier + événements navigateur.
 */
export function usePlayerPlayback(runDir: string | null): UsePlayerPlaybackResult {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [mediaLoadError, setMediaLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunManifestSummary | null>(null);
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [loopAsec, setLoopAsec] = useState<number | null>(null);
  const [loopBsec, setLoopBsec] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(readStoredVolume);
  const [muted, setMutedState] = useState(readStoredMuted);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    sessionStorage.setItem(WX_PLAYER_VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    sessionStorage.setItem(WX_PLAYER_MUTED_KEY, muted ? "1" : "0");
  }, [muted]);

  useEffect(() => {
    if (!runDir) {
      setManifestError(null);
      setMediaLoadError(null);
      setSummary(null);
      setMediaSrc(null);
      setMediaPath(null);
      setIsVideo(false);
      setDurationSec(null);
      setCurrentTimeSec(0);
      setPlaying(false);
      setLoopAsec(null);
      setLoopBsec(null);
      return;
    }

    let cancelled = false;
    setManifestLoading(true);
    setManifestError(null);
    setMediaLoadError(null);
    setSummary(null);
    setMediaSrc(null);
    setMediaPath(null);

    void (async () => {
      try {
        const s = await invoke<RunManifestSummary>("read_run_manifest_summary", {
          inputPath: runDir,
        });
        if (cancelled) {
          return;
        }
        setSummary(s);
        const raw = s.inputMediaResolved?.trim() || s.inputMediaPath?.trim() || "";
        if (!raw) {
          setManifestError("Aucun média d’entrée dans le manifest (inputMediaPath).");
          return;
        }
        setMediaPath(raw);
        setMediaSrc(convertFileSrc(raw));
        setIsVideo(isVideoFile(raw));
      } catch (e) {
        if (!cancelled) {
          setManifestError(formatManifestReadError(e));
        }
      } finally {
        if (!cancelled) {
          setManifestLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runDir]);

  const seek = useCallback(
    (sec: number) => {
      const el = mediaRef.current;
      if (!el) {
        return;
      }
      const dur =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (durationSec ?? Infinity);
      const clamped = Math.max(0, Math.min(sec, dur));
      el.currentTime = clamped;
      setCurrentTimeSec(clamped);
    },
    [durationSec],
  );

  const seekRelative = useCallback(
    (deltaSec: number) => {
      const el = mediaRef.current;
      const t = el?.currentTime ?? currentTimeSec;
      seek(t + deltaSec);
    },
    [currentTimeSec, seek],
  );

  const play = useCallback(async () => {
    const el = mediaRef.current;
    if (!el) {
      return;
    }
    try {
      await el.play();
    } catch {
      /* ignore */
    }
  }, []);

  const pause = useCallback(() => {
    mediaRef.current?.pause();
  }, []);

  const togglePlayPause = useCallback(async () => {
    const el = mediaRef.current;
    if (!el) {
      return;
    }
    if (el.paused) {
      try {
        await el.play();
      } catch {
        /* ignore */
      }
    } else {
      el.pause();
    }
  }, []);

  const stop = useCallback(() => {
    mediaRef.current?.pause();
    seek(0);
  }, [seek]);

  const setVolume = useCallback((v: number) => {
    const nv = clampNumber(v, 0, 1);
    setVolumeState(nv);
    const el = mediaRef.current;
    if (el) {
      el.volume = nv;
    }
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    const el = mediaRef.current;
    if (el) {
      el.muted = m;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) {
      return;
    }
    const next = !el.muted;
    setMutedState(next);
    el.muted = next;
  }, []);

  const applyPlaybackRate = useCallback((rate: number) => {
    const r = clampPlaybackRate(rate);
    setPlaybackRateState(r);
    const el = mediaRef.current;
    if (el) {
      el.playbackRate = r;
    }
  }, []);

  const nudgePlaybackRate = useCallback((delta: number) => {
    setPlaybackRateState((prev) => {
      const next = clampPlaybackRate(prev + delta);
      const el = mediaRef.current;
      if (el) {
        el.playbackRate = next;
      }
      return next;
    });
  }, []);

  const markLoopA = useCallback(() => {
    const t = mediaRef.current?.currentTime ?? currentTimeSec;
    setLoopAsec(t);
  }, [currentTimeSec]);

  const markLoopB = useCallback(() => {
    const t = mediaRef.current?.currentTime ?? currentTimeSec;
    setLoopBsec(t);
  }, [currentTimeSec]);

  const clearLoop = useCallback(() => {
    setLoopAsec(null);
    setLoopBsec(null);
  }, []);

  const setLoopRange = useCallback(
    (aSec: number, bSec: number) => {
      let a = Math.min(aSec, bSec);
      let b = Math.max(aSec, bSec);
      const dur =
        durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;
      if (dur != null) {
        a = clampNumber(a, 0, dur);
        b = clampNumber(b, 0, dur);
      } else {
        a = Math.max(0, a);
        b = Math.max(0, b);
      }
      if (b <= a) {
        b = Math.min(a + 0.05, dur ?? a + 0.05);
      }
      setLoopAsec(a);
      setLoopBsec(b);
    },
    [durationSec],
  );

  const onLoadedMetadata = useCallback(() => {
    const el = mediaRef.current;
    if (!el) {
      return;
    }
    setMediaLoadError(null);
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) {
      setDurationSec(d);
    }
  }, []);

  const onMediaError = useCallback(
    (event: SyntheticEvent<HTMLMediaElement>) => {
      const el = event.currentTarget;
      if (!el) {
        return;
      }
      setMediaLoadError(describeMediaElementError(el, mediaPath));
    },
    [mediaPath],
  );

  const onPlay = useCallback(() => setPlaying(true), []);
  const onPause = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    const el = mediaRef.current;
    if (el) {
      el.playbackRate = clampPlaybackRate(playbackRate);
    }
  }, [playbackRate, mediaSrc]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) {
      return;
    }
    el.volume = volume;
    el.muted = muted;
  }, [mediaSrc, volume, muted]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !playing) {
      return;
    }
    let raf = 0;
    const tick = () => {
      const m = mediaRef.current;
      if (!m) {
        return;
      }
      setCurrentTimeSec(m.currentTime);
      if (
        loopAsec != null &&
        loopBsec != null &&
        loopBsec > loopAsec &&
        m.currentTime >= loopBsec
      ) {
        m.currentTime = loopAsec;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loopAsec, loopBsec]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) {
      return;
    }
    const onTimeUpdate = () => {
      if (!playing) {
        setCurrentTimeSec(el.currentTime);
      }
    };
    el.addEventListener("timeupdate", onTimeUpdate);
    return () => el.removeEventListener("timeupdate", onTimeUpdate);
  }, [mediaSrc, playing]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) {
      return;
    }
    const onEnded = () => setPlaying(false);
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [mediaSrc]);

  return {
    manifestLoading,
    manifestError,
    mediaLoadError,
    summary,
    mediaSrc,
    mediaPath,
    isVideo,
    durationSec,
    currentTimeSec,
    playing,
    playbackRate,
    loopAsec,
    loopBsec,
    mediaRef,
    mediaHandlers: {
      onLoadedMetadata,
      onPlay,
      onPause,
      onError: onMediaError,
    },
    play,
    pause,
    togglePlayPause,
    stop,
    seek,
    seekRelative,
    nudgePlaybackRate,
    setPlaybackRate: applyPlaybackRate,
    markLoopA,
    markLoopB,
    clearLoop,
    setLoopRange,
    volume,
    muted,
    setVolume,
    setMuted,
    toggleMute,
  };
}
