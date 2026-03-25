import { formatClockSeconds } from "../../appUtils";
import type { EventTurnRow, QueryWindowResult } from "../../types";

export type PlayerViewportMode = "lanes" | "chat" | "words" | "columns" | "rythmo" | "karaoke";

type Props = {
  mode: PlayerViewportMode;
  slice: QueryWindowResult | null;
  playheadMs: number;
  loading: boolean;
  /** Si défini, le parent affiche déjà l’erreur IPC. */
  queryError: string | null;
  /** Requête avec couche words (fenêtre 30s). */
  wordsLayerActive: boolean;
  /** Seek au début d’un bloc (ms) — Lanes / Chat / Mots. */
  onSeekToMs?: (ms: number) => void;
};

/**
 * Aperçu v1 Lanes / Chat (WX-624) à partir d’un `QueryWindowResult` déjà chargé.
 */
export function PlayerRunWindowViews({
  mode,
  slice,
  playheadMs,
  loading,
  queryError,
  wordsLayerActive,
  onSeekToMs,
}: Props) {
  if (queryError) {
    return null;
  }
  if (mode === "columns") {
    return (
      <PlayerComingSoonBody
        title="Colonnes"
        detail="Bins time-aligned / turn-aligned, virtualisation des lignes — prévu WX-624 v2."
      />
    );
  }
  if (mode === "rythmo") {
    return (
      <PlayerComingSoonBody
        title="Rythmo"
        detail="Repère NOW fixe, défilement vertical, scrub — prévu WX-624 v2."
      />
    );
  }
  if (mode === "karaoke") {
    return (
      <PlayerComingSoonBody
        title="Karaoké"
        detail="Bande continue, surlignage segment / mot, virtualisation — prévu WX-624 v2."
      />
    );
  }
  if (!slice) {
    if (loading) {
      return <p className="player-viewport-placeholder small">Chargement des événements…</p>;
    }
    return (
      <p className="player-viewport-placeholder small">
        Aucune donnée — importe <code>events.sqlite</code> depuis <strong>Open run</strong> si
        besoin.
      </p>
    );
  }

  if (mode === "lanes") {
    return <PlayerLanesBody slice={slice} playheadMs={playheadMs} onSeekToMs={onSeekToMs} />;
  }
  if (mode === "chat") {
    return <PlayerChatBody slice={slice} playheadMs={playheadMs} onSeekToMs={onSeekToMs} />;
  }
  return (
    <PlayerWordsBody
      slice={slice}
      playheadMs={playheadMs}
      wordsLayerActive={wordsLayerActive}
      onSeekToMs={onSeekToMs}
    />
  );
}

function PlayerComingSoonBody({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="player-coming-soon">
      <p className="player-coming-soon-title">{title}</p>
      <p className="small player-coming-soon-detail">{detail}</p>
      <p className="small mono player-coming-soon-hint">
        Placeholder v2 — aucune requête SQLite supplémentaire.
      </p>
    </div>
  );
}

function PlayerLanesBody({
  slice,
  playheadMs,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  const bySpeaker = new Map<string, EventTurnRow[]>();
  for (const turn of slice.turns) {
    const sp = turn.speaker || "—";
    const list = bySpeaker.get(sp) ?? [];
    list.push(turn);
    bySpeaker.set(sp, list);
  }
  const speakers = Array.from(bySpeaker.keys()).sort();

  return (
    <div className="player-lanes">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {slice.turns.length} tours ·{" "}
        {slice.truncated.turns ? "tronqué · " : ""}
        {slice.pauses.length} pauses · {slice.ipus.length} IPU
      </p>
      <div className="player-lanes-grid">
        {speakers.map((sp) => (
          <div key={sp} className="player-lanes-column">
            <div className="player-lanes-column-title">{sp}</div>
            <ul className="player-lanes-turns">
              {(bySpeaker.get(sp) ?? []).map((t) => {
                const active = playheadMs >= t.startMs && playheadMs < t.endMs;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`player-lanes-turn ${active ? "is-active" : ""}`}
                      title={`${t.startMs}–${t.endMs} ms — cliquer pour lire depuis ce tour`}
                      disabled={!onSeekToMs}
                      onClick={() => onSeekToMs?.(t.startMs)}
                    >
                      <span className="mono player-lanes-turn-time">
                        {formatClockSeconds(t.startMs / 1000)} →{" "}
                        {formatClockSeconds(t.endMs / 1000)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {slice.turns.length === 0 ? (
        <p className="small">Aucun tour de parole dans cette fenêtre.</p>
      ) : null}
    </div>
  );
}

function PlayerWordsBody({
  slice,
  playheadMs,
  wordsLayerActive,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  wordsLayerActive: boolean;
  onSeekToMs?: (ms: number) => void;
}) {
  if (!wordsLayerActive) {
    return (
      <p className="player-viewport-placeholder small">
        Active <strong>Fenêtre mots (30s)</strong> dans le panneau de gauche pour charger les tokens
        dans une fenêtre ≤ 30s (spec WX-624).
      </p>
    );
  }
  return (
    <div className="player-words">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {slice.words.length} mots
        {slice.truncated.words ? " · tronqué (zoom / réduire la fenêtre)" : ""}
      </p>
      <ul className="player-words-strip">
        {slice.words.map((w) => {
          const active = playheadMs >= w.startMs && playheadMs < w.endMs;
          return (
            <li key={w.id}>
              <button
                type="button"
                className={`player-word-chip ${active ? "is-active" : ""}`}
                title={`${w.startMs}–${w.endMs} ms — cliquer pour seek`}
                disabled={!onSeekToMs}
                onClick={() => onSeekToMs?.(w.startMs)}
              >
                {w.token?.trim() || "…"}
              </button>
            </li>
          );
        })}
      </ul>
      {slice.words.length === 0 ? <p className="small">Aucun mot dans cette fenêtre.</p> : null}
    </div>
  );
}

function PlayerChatBody({
  slice,
  playheadMs,
  onSeekToMs,
}: {
  slice: QueryWindowResult;
  playheadMs: number;
  onSeekToMs?: (ms: number) => void;
}) {
  return (
    <div className="player-chat">
      <p className="player-lanes-meta small mono">
        Fenêtre {slice.t0Ms}–{slice.t1Ms} ms · {slice.ipus.length} IPU
        {slice.truncated.ipus ? " · tronqué" : ""}
      </p>
      <div className="player-chat-thread" role="log">
        {slice.ipus.map((ipu) => {
          const active = playheadMs >= ipu.startMs && playheadMs < ipu.endMs;
          return (
            <button
              key={ipu.id}
              type="button"
              className={`player-chat-bubble ${active ? "is-active" : ""}`}
              title="Cliquer pour lire depuis ce bloc"
              disabled={!onSeekToMs}
              onClick={() => onSeekToMs?.(ipu.startMs)}
            >
              <div className="player-chat-bubble-head">
                <span className="player-chat-speaker">{ipu.speaker ?? "—"}</span>
                <span className="mono small player-chat-time">
                  {formatClockSeconds(ipu.startMs / 1000)}
                </span>
              </div>
              <p className="player-chat-text">{ipu.text?.trim() || "…"}</p>
            </button>
          );
        })}
      </div>
      {slice.ipus.length === 0 ? <p className="small">Aucun IPU dans cette fenêtre.</p> : null}
    </div>
  );
}
