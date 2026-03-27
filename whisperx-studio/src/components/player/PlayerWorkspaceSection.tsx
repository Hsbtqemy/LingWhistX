import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { runInTransition } from "../../whisperxOptionsTransitions";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { clampNumber, formatClockSeconds, parsePlayerTimecodeToSeconds } from "../../appUtils";
import { usePlayerPlayback } from "../../hooks/usePlayerPlayback";
import { usePlayerKeyboard } from "../../hooks/usePlayerKeyboard";
import { usePlayerRunWindow } from "../../hooks/usePlayerRunWindow";
import { derivePlayerAlerts } from "../../player/derivePlayerAlerts";
import type { PlayerDerivedAlertKind } from "../../player/derivePlayerAlerts";
import type { ExportRunTimingPackResponse, StudioView } from "../../types";
import { PlayerRunWindowViews, type PlayerViewportMode } from "./PlayerRunWindowViews";
import { PlayerJumpPanel } from "./PlayerJumpPanel";
import { PlayerTopBar } from "./PlayerTopBar";
import { Button } from "../ui";

export type PlayerWorkspaceSectionProps = {
  runDir: string | null;
  runLabel?: string | null;
  onBack: (view: StudioView) => void;
};

type AlertListFilter = "all" | PlayerDerivedAlertKind;

/**
 * Player multi-vues (WX-624) — layout TopBar + colonnes + viewport ; transport via usePlayerPlayback.
 */
export function PlayerWorkspaceSection({ runDir, runLabel, onBack }: PlayerWorkspaceSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewportMode, setViewportMode] = useState<PlayerViewportMode>("lanes");
  const [wordsWindowEnabled, setWordsWindowEnabled] = useState(false);
  const [exportFolderError, setExportFolderError] = useState("");
  const [exportPackBusy, setExportPackBusy] = useState(false);
  const [exportPackError, setExportPackError] = useState("");
  const [exportPackHint, setExportPackHint] = useState("");
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [speakerSolo, setSpeakerSolo] = useState<string | null>(null);
  const [runSpeakerIds, setRunSpeakerIds] = useState<string[]>([]);
  const [alertListFilter, setAlertListFilter] = useState<AlertListFilter>("all");
  const [jumpTimeInput, setJumpTimeInput] = useState("");
  const [jumpTimeError, setJumpTimeError] = useState("");
  const [copyPositionHint, setCopyPositionHint] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const eventsPanelRef = useRef<HTMLDivElement | null>(null);
  const programmaticPanelScrollRef = useRef(false);
  const copyPositionHintTimeoutRef = useRef<number | null>(null);
  const shortcutsHelpPanelRef = useRef<HTMLDivElement | null>(null);
  const pb = usePlayerPlayback(runDir);

  const {
    manifestLoading,
    manifestError,
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
    mediaHandlers,
    togglePlayPause,
    stop,
    seek,
    seekRelative,
    nudgePlaybackRate,
    markLoopA,
    markLoopB,
    clearLoop,
    volume,
    muted,
    setVolume,
    setMuted,
    toggleMute,
  } = pb;

  const runWindowEnabled = Boolean(runDir && !manifestLoading && !manifestError);
  const runWindow = usePlayerRunWindow({
    runDir,
    centerTimeSec: currentTimeSec,
    enabled: runWindowEnabled,
    queryPreset: wordsWindowEnabled ? "words_detail" : "standard",
    speakersFilter: speakerSolo ? [speakerSolo] : null,
  });

  const derivedAlerts = useMemo(
    () => (runWindow.slice ? derivePlayerAlerts(runWindow.slice) : []),
    [runWindow.slice],
  );

  const displayedAlerts = useMemo(() => {
    if (alertListFilter === "all") {
      return derivedAlerts;
    }
    return derivedAlerts.filter((a) => a.kind === alertListFilter);
  }, [derivedAlerts, alertListFilter]);

  const playheadMs = Math.round(currentTimeSec * 1000);

  const qcSummary = useMemo(() => {
    const parts: string[] = [];
    const nOv = derivedAlerts.filter((a) => a.kind === "overlap_turn").length;
    const nPa = derivedAlerts.filter((a) => a.kind === "long_pause").length;
    parts.push(`${derivedAlerts.length} alerte${derivedAlerts.length === 1 ? "" : "s"}`);
    if (derivedAlerts.length > 0) {
      parts.push(`${nOv} chev. · ${nPa} pause${nPa === 1 ? "" : "s"}`);
    }
    const ns = summary?.statsNSegments;
    const nt = summary?.statsNSpeakerTurns;
    const nw = summary?.statsNWords;
    const statBits = [
      ns != null ? `${ns} seg.` : null,
      nt != null ? `${nt} tours` : null,
      nw != null ? `~${nw} mots` : null,
    ].filter(Boolean) as string[];
    if (statBits.length > 0) {
      parts.push(statBits.join(" · "));
    }
    const nwarnings = summary?.warnings?.length ?? 0;
    if (nwarnings > 0) {
      parts.push(`${nwarnings} avert. manifest`);
    }
    const tr = runWindow.slice?.truncated;
    if (tr && (tr.words || tr.turns || tr.pauses || tr.ipus)) {
      parts.push("troncature fenêtre");
    }
    return parts.join(" · ");
  }, [derivedAlerts, runWindow.slice?.truncated, summary]);

  const sliceTruncationLayers = useMemo(() => {
    const tr = runWindow.slice?.truncated;
    if (!tr) {
      return null;
    }
    const parts: string[] = [];
    if (tr.words) {
      parts.push("mots");
    }
    if (tr.turns) {
      parts.push("tours");
    }
    if (tr.pauses) {
      parts.push("pauses");
    }
    if (tr.ipus) {
      parts.push("IPU");
    }
    return parts.length > 0 ? parts : null;
  }, [runWindow.slice?.truncated]);

  const openRunFolder = useCallback(async () => {
    if (!runDir) {
      return;
    }
    setExportFolderError("");
    try {
      await invoke("open_local_path", { path: runDir });
    } catch (e) {
      setExportFolderError(String(e));
    }
  }, [runDir]);

  const exportRunTimingPack = useCallback(async () => {
    if (!runDir) {
      return;
    }
    setExportPackError("");
    setExportPackHint("");
    setExportPackBusy(true);
    try {
      const r = await invoke<ExportRunTimingPackResponse>("export_run_timing_pack", {
        request: { runDir },
      });
      setExportPackHint(`Pack exporté (JSON + SRT + CSV) · dernier fichier : ${r.lastOutputPath}`);
    } catch (e) {
      setExportPackError(String(e));
    } finally {
      setExportPackBusy(false);
    }
  }, [runDir]);

  useEffect(() => {
    setSpeakerSolo(null);
    setAlertListFilter("all");
    setJumpTimeInput("");
    setJumpTimeError("");
  }, [runDir]);

  const commitJumpToTime = useCallback(() => {
    setJumpTimeError("");
    const sec = parsePlayerTimecodeToSeconds(jumpTimeInput);
    if (sec == null) {
      setJumpTimeError("Ex. 42,5 · 1:02 · 1:02:03");
      return;
    }
    const maxSec = durationSec != null && Number.isFinite(durationSec) ? durationSec : sec;
    seek(clampNumber(sec, 0, Math.max(0, maxSec)));
    setJumpTimeInput("");
  }, [jumpTimeInput, durationSec, seek]);

  useEffect(() => {
    if (!runDir || !runWindowEnabled) {
      setRunSpeakerIds([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ids = await invoke<string[]>("list_run_speakers", { runDir });
        if (!cancelled) {
          setRunSpeakerIds([...ids].sort());
        }
      } catch {
        if (!cancelled) {
          setRunSpeakerIds([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runDir, runWindowEnabled]);

  useEffect(() => {
    if (!wordsWindowEnabled && viewportMode === "words") {
      setViewportMode("lanes");
    }
  }, [wordsWindowEnabled, viewportMode]);

  const followScrollKey = Math.floor(playheadMs / 250);
  const followResyncKey = `${viewportMode}-${runWindow.slice?.t0Ms ?? 0}-${runWindow.slice?.t1Ms ?? 0}`;

  useEffect(() => {
    if (!followPlayhead) {
      return;
    }
    const root = eventsPanelRef.current;
    if (!root) {
      return;
    }
    const target = root.querySelector(".is-active");
    if (!target || !(target instanceof HTMLElement)) {
      return;
    }
    programmaticPanelScrollRef.current = true;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    const t = window.setTimeout(() => {
      programmaticPanelScrollRef.current = false;
    }, 450);
    return () => window.clearTimeout(t);
  }, [followPlayhead, followScrollKey, followResyncKey]);

  const onEventsPanelScroll = useCallback(() => {
    if (programmaticPanelScrollRef.current) {
      return;
    }
    setFollowPlayhead(false);
  }, []);

  const durLabel = formatClockSeconds(durationSec ?? 0);
  const posLabel = formatClockSeconds(currentTimeSec);

  const copyPlayheadToClipboard = useCallback(async () => {
    if (!mediaSrc || manifestError) {
      return;
    }
    const text = formatClockSeconds(currentTimeSec);
    try {
      await navigator.clipboard.writeText(text);
      if (copyPositionHintTimeoutRef.current != null) {
        window.clearTimeout(copyPositionHintTimeoutRef.current);
      }
      setCopyPositionHint(true);
      copyPositionHintTimeoutRef.current = window.setTimeout(() => {
        setCopyPositionHint(false);
        copyPositionHintTimeoutRef.current = null;
      }, 1600);
    } catch {
      /* presse-papiers indisponible */
    }
  }, [currentTimeSec, mediaSrc, manifestError]);

  const toggleVideoFullscreen = useCallback(async () => {
    const el = mediaRef.current;
    if (!el || !isVideo) {
      return;
    }
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* navigateur refuse */
    }
  }, [isVideo, mediaRef]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const onFs = () => {
      const el = mediaRef.current;
      setVideoFullscreen(Boolean(el && document.fullscreenElement === el));
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [mediaSrc, mediaRef]);

  useEffect(() => {
    return () => {
      if (copyPositionHintTimeoutRef.current != null) {
        window.clearTimeout(copyPositionHintTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!shortcutsHelpOpen || typeof document === "undefined") {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [shortcutsHelpOpen]);

  useEffect(() => {
    if (!shortcutsHelpOpen) {
      return;
    }
    const id = window.requestAnimationFrame(() => {
      shortcutsHelpPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [shortcutsHelpOpen]);

  const loopHint =
    loopAsec != null && loopBsec != null && loopBsec > loopAsec
      ? `A ${formatClockSeconds(loopAsec)} → B ${formatClockSeconds(loopBsec)}`
      : "A–B : —";

  const transportDisabled = !mediaSrc || !!manifestError;

  const onKeyDown = usePlayerKeyboard({
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    togglePlayPause,
    copyPlayheadToClipboard,
    exportRunTimingPack,
    exportPackBusy,
    openRunFolder,
    runDir,
    stop,
    seek,
    seekRelative,
    durationSec,
    mediaSrc,
    manifestError,
    nudgePlaybackRate,
    setViewportMode,
    displayedAlerts,
    playheadMs,
    setFollowPlayhead,
    setWordsWindowEnabled,
    toggleMute,
    toggleVideoFullscreen,
    isVideo,
    loopAsec,
    loopBsec,
    markLoopA,
    markLoopB,
    clearLoop,
    runSpeakerIds,
    setSpeakerSolo,
  });

  useEffect(() => {
    rootRef.current?.focus();
  }, [runDir]);

  return (
    <div
      ref={rootRef}
      className="player-workspace"
      tabIndex={0}
      role="application"
      aria-label="Lecteur multi-vues"
      onKeyDown={onKeyDown}
    >
      <PlayerTopBar
        onBack={() => onBack("create")}
        runLabel={runLabel ?? "Player"}
        runDir={runDir}
        mediaPath={mediaPath}
        shortcutsHelpOpen={shortcutsHelpOpen}
        onToggleShortcutsHelp={() => setShortcutsHelpOpen((v) => !v)}
        transportDisabled={transportDisabled}
        playing={playing}
        onTogglePlayPause={togglePlayPause}
        onStop={stop}
        onSeekRelative={seekRelative}
        posLabel={posLabel}
        durLabel={durLabel}
        copyPositionHint={copyPositionHint}
        onCopyPlayhead={copyPlayheadToClipboard}
        playbackRate={playbackRate}
        onNudgePlaybackRate={nudgePlaybackRate}
        volume={volume}
        muted={muted}
        onVolumeChange={(v) => {
          setVolume(v);
          if (v > 0) {
            setMuted(false);
          }
        }}
        onToggleMute={toggleMute}
        isVideo={isVideo}
        videoFullscreen={videoFullscreen}
        onToggleVideoFullscreen={toggleVideoFullscreen}
        followPlayhead={followPlayhead}
        onToggleFollowPlayhead={() => setFollowPlayhead((v) => !v)}
        loopHint={loopHint}
        onMarkLoopA={markLoopA}
        onMarkLoopB={markLoopB}
        onClearLoop={clearLoop}
        loopAsec={loopAsec}
        loopBsec={loopBsec}
        qcSummary={qcSummary}
        exportFolderError={exportFolderError}
        exportPackError={exportPackError}
        exportPackHint={exportPackHint}
        exportPackBusy={exportPackBusy}
        onOpenRunFolder={openRunFolder}
        onExportRunTimingPack={exportRunTimingPack}
      />

      {!runDir ? (
        <div className="player-empty player-empty--no-run">
          <div
            className="empty-state-card empty-state-card--compact"
            role="status"
            aria-labelledby="player-empty-no-run-title"
          >
            <div className="empty-state-card-icon empty-state-card-icon--muted" aria-hidden />
            <h3 id="player-empty-no-run-title" className="empty-state-card-title">
              Aucun run ouvert pour la lecture
            </h3>
            <p className="empty-state-card-text">
              Depuis l&apos;accueil, ouvre un dossier de run (manifest) puis utilise{" "}
              <strong>Ouvrir le Player</strong>.
              <br />
              Depuis le Studio, sélectionne un job avec média pour lancer la lecture ici.
            </p>
            <div className="player-empty-cta">
              <Button type="button" variant="primary" onClick={() => onBack("create")}>
                Aller à l&apos;accueil
              </Button>
              <Button type="button" variant="secondary" onClick={() => onBack("workspace")}>
                Aller au Studio
              </Button>
            </div>
          </div>
        </div>
      ) : manifestLoading ? (
        <div className="player-empty">
          <p>Chargement du manifest…</p>
        </div>
      ) : manifestError ? (
        <div className="player-empty player-empty--error">
          <p>{manifestError}</p>
        </div>
      ) : (
        <div className="player-body">
          <aside className="player-panel player-panel--left">
            <h4 className="player-panel-title">Vues</h4>
            <div className="player-view-mode" role="tablist" aria-label="Mode de viewport">
              <button
                type="button"
                role="tab"
                aria-selected={viewportMode === "lanes"}
                className={`player-view-mode-btn ${viewportMode === "lanes" ? "is-active" : ""}`}
                onClick={() => setViewportMode("lanes")}
              >
                Lanes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewportMode === "chat"}
                className={`player-view-mode-btn ${viewportMode === "chat" ? "is-active" : ""}`}
                onClick={() => setViewportMode("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewportMode === "words"}
                className={`player-view-mode-btn ${viewportMode === "words" ? "is-active" : ""}`}
                onClick={() => setViewportMode("words")}
              >
                Mots
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewportMode === "columns"}
                className={`player-view-mode-btn ${viewportMode === "columns" ? "is-active" : ""}`}
                onClick={() => setViewportMode("columns")}
              >
                Colonnes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewportMode === "rythmo"}
                className={`player-view-mode-btn ${viewportMode === "rythmo" ? "is-active" : ""}`}
                onClick={() => setViewportMode("rythmo")}
              >
                Rythmo
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewportMode === "karaoke"}
                className={`player-view-mode-btn ${viewportMode === "karaoke" ? "is-active" : ""}`}
                onClick={() => setViewportMode("karaoke")}
              >
                Karaoké
              </button>
            </div>
            <label className="player-words-toggle small">
              <input
                type="checkbox"
                checked={wordsWindowEnabled}
                onChange={(e) => runInTransition(() => setWordsWindowEnabled(e.target.checked))}
              />
              Fenêtre mots (30s) + requête words
            </label>
            <p className="small mono player-view-mode-hint">⌃1 · ⌃2 · ⌃3 · ⌃4 · ⌃5 · ⌃6</p>
            <h4 className="player-panel-title">Filtres</h4>
            <p className="small">
              Locuteur : <span className="mono">{speakerSolo ?? "tous"}</span>
              {runSpeakerIds.length > 0 ? (
                <> · 1–9 (réappuyer = off) · 0 = tous</>
              ) : (
                <> — indexer le run pour le solo clavier</>
              )}
            </p>
            <h4 className="player-panel-title">Navigateur</h4>
            <PlayerJumpPanel
              jumpTimeInput={jumpTimeInput}
              onJumpTimeInputChange={(v) => {
                setJumpTimeInput(v);
                setJumpTimeError("");
              }}
              jumpTimeError={jumpTimeError}
              disabled={transportDisabled}
              onCommit={commitJumpToTime}
            />
          </aside>
          <main className="player-viewport">
            <div className="player-media-stage">
              {mediaSrc && isVideo ? (
                <video
                  ref={mediaRef as RefObject<HTMLVideoElement | null>}
                  className="player-viewport-video"
                  src={mediaSrc}
                  preload="metadata"
                  playsInline
                  controls={false}
                  {...mediaHandlers}
                />
              ) : null}
              {mediaSrc && !isVideo ? (
                <audio
                  ref={mediaRef as RefObject<HTMLAudioElement | null>}
                  className="player-viewport-audio"
                  src={mediaSrc}
                  preload="metadata"
                  {...mediaHandlers}
                />
              ) : null}
              {!mediaSrc ? (
                <p className="player-viewport-placeholder">
                  <strong>Média</strong> — aucune source après lecture du manifest.
                </p>
              ) : null}
            </div>
            <div
              ref={eventsPanelRef}
              className="player-events-panel"
              onScroll={onEventsPanelScroll}
            >
              {runWindow.lastT0Ms != null && runWindow.lastT1Ms != null ? (
                <div className="player-events-panel-head small mono">
                  <span className="player-events-window-bounds">
                    Fenêtre {runWindow.lastT0Ms}–{runWindow.lastT1Ms} ms
                  </span>
                </div>
              ) : null}
              {runWindow.error ? (
                <p className="player-window-error small" role="alert">
                  {runWindow.error}
                </p>
              ) : null}
              {sliceTruncationLayers ? (
                <p className="small player-slice-truncation-hint" role="status">
                  Troncature sur : {sliceTruncationLayers.join(" · ")} — plafonds fenêtre SQLite ;
                  pour les mots, garde la fenêtre ≤ 30 s.
                </p>
              ) : null}
              <PlayerRunWindowViews
                mode={viewportMode}
                slice={runWindow.slice}
                playheadMs={playheadMs}
                loading={runWindow.loading}
                queryError={runWindow.error}
                wordsLayerActive={wordsWindowEnabled}
                onSeekToMs={(ms) => seek(ms / 1000)}
              />
            </div>
            {runDir ? <p className="small mono player-viewport-path">{runDir}</p> : null}
          </main>
          <aside className="player-panel player-panel--right">
            <h4 className="player-panel-title">Alertes (fenêtre)</h4>
            <label className="player-alert-filter small">
              Liste :{" "}
              <select
                value={alertListFilter}
                onChange={(e) =>
                  runInTransition(() => setAlertListFilter(e.target.value as AlertListFilter))
                }
                aria-label="Filtrer le type d’alertes dans la liste"
              >
                <option value="all">Toutes</option>
                <option value="overlap_turn">Chevauchements</option>
                <option value="long_pause">Pauses longues</option>
              </select>
            </label>
            {derivedAlerts.length === 0 ? (
              <p className="small">
                Aucune alerte détectée (chevauchements de tours, pauses ≥ 3 s).
              </p>
            ) : displayedAlerts.length === 0 ? (
              <p className="small">Aucune alerte pour ce filtre.</p>
            ) : (
              <ul className="player-alert-list">
                {displayedAlerts.slice(0, 40).map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="player-alert-item"
                      title={`Aller à ${a.startMs} ms`}
                      onClick={() => seek(a.startMs / 1000)}
                    >
                      {a.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="player-panel-title">Contrôles</h4>
            <p className="small">Layout, recompute — bientôt</p>
            <p className="small player-shortcuts-hint">
              Espace · Home / Fin · ⌃⇧C copier · ⌃⇧O dossier · ⌃⇧E export · ← → · Shift / Alt · +/−
              vitesse · M muet · Alt+Entrée plein écran (vidéo) · F suivi · W mots · L boucle · ⌃1–6
              vues · N / P alertes · 0 / 1–9 locuteur · Aller au temps (panneau gauche) ·{" "}
              <strong>?</strong> aide
            </p>
          </aside>
        </div>
      )}
      {shortcutsHelpOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="player-shortcuts-help-overlay"
              role="presentation"
              onClick={() => setShortcutsHelpOpen(false)}
            >
              <div
                ref={shortcutsHelpPanelRef}
                id="player-shortcuts-help-dialog"
                className="player-shortcuts-help-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="player-shortcuts-help-title"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="player-shortcuts-help-head">
                  <h2 id="player-shortcuts-help-title" className="player-shortcuts-help-title">
                    Raccourcis Player
                  </h2>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => setShortcutsHelpOpen(false)}
                  >
                    Fermer
                  </button>
                </div>
                <ul className="player-shortcuts-help-list small">
                  <li>
                    <kbd className="player-kbd">Espace</kbd> Lecture / pause
                  </li>
                  <li>
                    <kbd className="player-kbd">Stop</kbd> · <kbd className="player-kbd">Home</kbd>{" "}
                    Arrêt + début
                  </li>
                  <li>
                    <kbd className="player-kbd">Fin</kbd> Fin de média
                  </li>
                  <li>
                    <kbd className="player-kbd">⌃⇧C</kbd> Copier timecode · double-clic sur le
                    timecode
                  </li>
                  <li>
                    <kbd className="player-kbd">⌃⇧O</kbd> Dossier run ·{" "}
                    <kbd className="player-kbd">⌃⇧E</kbd> Export pack
                  </li>
                  <li>
                    <kbd className="player-kbd">←</kbd> <kbd className="player-kbd">→</kbd> ±1 s ·{" "}
                    <kbd className="player-kbd">Shift</kbd>+flèches ±5 s ·{" "}
                    <kbd className="player-kbd">Alt</kbd>
                    +flèches ±0,1 s
                  </li>
                  <li>
                    <kbd className="player-kbd">+</kbd> / <kbd className="player-kbd">−</kbd>{" "}
                    Vitesse
                  </li>
                  <li>
                    <kbd className="player-kbd">F</kbd> Suivi viewport ·{" "}
                    <kbd className="player-kbd">W</kbd> Fenêtre mots ·{" "}
                    <kbd className="player-kbd">L</kbd> Boucle A→B ·{" "}
                    <kbd className="player-kbd">M</kbd> Muet · <kbd className="player-kbd">Alt</kbd>
                    +<kbd className="player-kbd">Entrée</kbd> Plein écran (vidéo)
                  </li>
                  <li>
                    <kbd className="player-kbd">⌃1</kbd>–<kbd className="player-kbd">6</kbd> Vues
                  </li>
                  <li>
                    <kbd className="player-kbd">N</kbd> / <kbd className="player-kbd">P</kbd> Alerte
                    suiv. / préc.
                  </li>
                  <li>
                    <kbd className="player-kbd">0</kbd>–<kbd className="player-kbd">9</kbd> Solo
                    locuteur
                  </li>
                  <li>
                    Navigateur : champ <strong>Aller au temps</strong> +{" "}
                    <kbd className="player-kbd">Entrée</kbd>
                  </li>
                </ul>
                <p className="small player-shortcuts-help-foot">
                  <kbd className="player-kbd">?</kbd> ouvre / ferme cette aide ·{" "}
                  <kbd className="player-kbd">Échap</kbd> ferme · détail dans{" "}
                  <code>audit/player-multi-view.md</code>
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
