import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { EditableSegment } from "../../types";
import { formatClockSeconds, roundSecondsMs } from "../../appUtils";

type SegmentBoundaryTimeInputProps = {
  ariaLabel: string;
  seconds: number;
  onCommit: (nextSeconds: number) => void;
};

/** État local pour éviter que les re-rendus fréquents (curseur waveform, etc.) réinitialisent la saisie. */
function SegmentBoundaryTimeInput({ ariaLabel, seconds, onCommit }: SegmentBoundaryTimeInputProps) {
  const [text, setText] = useState(() => seconds.toFixed(3));
  const [focused, setFocused] = useState(false);
  const secondsRef = useRef(seconds);
  secondsRef.current = seconds;

  useEffect(() => {
    if (!focused) {
      setText(seconds.toFixed(3));
    }
  }, [seconds, focused]);

  return (
    <input
      type="number"
      className="editor-segment-row__time-input mono small"
      value={text}
      step={0.001}
      min={0}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const v = parseFloat(text);
        if (!Number.isFinite(v)) {
          setText(secondsRef.current.toFixed(3));
          return;
        }
        if (roundSecondsMs(v) !== roundSecondsMs(secondsRef.current)) {
          onCommit(v);
          // Après mutation, le parent peut mettre à jour `seconds` au prochain tick ; on resynchronise.
          setTimeout(() => {
            setText(secondsRef.current.toFixed(3));
          }, 0);
        } else {
          setText(secondsRef.current.toFixed(3));
        }
      }}
    />
  );
}

export type EditorSegmentListProps = {
  transcriptSourcePath: string;
  segments: EditableSegment[];
  allSegments: EditableSegment[];
  allSegmentsCount: number;
  activeSegmentIndex: number | null;
  hasMoreSegments: boolean;
  editorVisibleCount: number;
  focusSegment: (index: number) => void;
  setActiveSegmentIndex: (n: number | null) => void;
  updateSegmentText: (index: number, text: string) => void;
  updateSegmentBoundary: (index: number, edge: "start" | "end", value: number) => void;
  updateSegmentSpeaker: (index: number, speaker: string | null) => void;
  setEditorVisibleCount: Dispatch<SetStateAction<number>>;
  /* Actions contextuelles sur le segment actif */
  canSplitActiveSegment: boolean;
  canMergePrev: boolean;
  canMergeNext: boolean;
  canDeleteSegment: boolean;
  splitActiveSegmentAtCursor: () => void;
  mergeActiveSegment: (dir: "prev" | "next") => void;
  deleteActiveSegment: () => void;
};

export const EditorSegmentList = memo(function EditorSegmentList({
  transcriptSourcePath,
  segments,
  allSegments,
  allSegmentsCount,
  activeSegmentIndex,
  hasMoreSegments,
  editorVisibleCount,
  focusSegment,
  setActiveSegmentIndex,
  updateSegmentText,
  updateSegmentBoundary,
  updateSegmentSpeaker,
  setEditorVisibleCount,
  canSplitActiveSegment,
  canMergePrev,
  canMergeNext,
  canDeleteSegment,
  splitActiveSegmentAtCursor,
  mergeActiveSegment,
  deleteActiveSegment,
}: EditorSegmentListProps) {
  const uniqueSpeakers = useMemo(() => {
    const seen = new Set<string>();
    for (const seg of allSegments) {
      if (seg.speaker) seen.add(seg.speaker);
    }
    return [...seen].sort();
  }, [allSegments]);

  if (segments.length === 0 && allSegmentsCount === 0) {
    const hasPath = transcriptSourcePath.trim().length > 0;
    return (
      <div className="editor-segment-list editor-segment-list--empty">
        {hasPath ? (
          <>
            <p className="small">Transcript ouvert : aucun segment (run vide ou audio seul).</p>
            <p className="small editor-segment-list__empty-hint">
              Utilisez <strong>+ Segment</strong> dans la barre d'outils (curseur sur la waveform),
              ou l'onglet Import pour WhisperX / import d'un fichier. Enregistrez le JSON lorsque
              c'est prêt.
            </p>
          </>
        ) : (
          <p className="small">Aucun segment. Ouvrez un transcript JSON pour commencer.</p>
        )}
      </div>
    );
  }

  return (
    <div className="editor-segment-list">
      <div className="editor-segment-list__header small">
        <span>
          {allSegmentsCount} segment{allSegmentsCount !== 1 ? "s" : ""}
        </span>
        {hasMoreSegments && (
          <span className="editor-segment-list__more-hint">— {segments.length} affichés</span>
        )}
      </div>

      <ol className="editor-segment-list__items">
        {segments.map((seg, visIndex) => {
          const isActive = visIndex === activeSegmentIndex;

          return (
            <li
              key={`${seg.start}-${seg.end}`}
              className={`editor-segment-row${isActive ? " editor-segment-row--active" : ""}`}
              onClick={() => setActiveSegmentIndex(visIndex)}
            >
              <div className="editor-segment-row__meta">
                <span className="editor-segment-row__idx mono small">#{visIndex + 1}</span>

                <input
                  type="number"
                  className="editor-segment-row__time-input mono small"
                  value={seg.start.toFixed(3)}
                  step={0.001}
                  min={0}
                  aria-label={`Début segment ${visIndex + 1}`}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v !== seg.start) {
                      updateSegmentBoundary(visIndex, "start", v);
                    }
                  }}
                  onChange={() => {
                    /* commit on blur */
                  }}
                />
                <span className="editor-segment-row__arrow small" aria-hidden>
                  →
                </span>
                <SegmentBoundaryTimeInput
                  ariaLabel={`Fin segment ${visIndex + 1}`}
                  seconds={seg.end}
                  onCommit={(v) => updateSegmentBoundary(visIndex, "end", v)}
                />

                <span className="editor-segment-row__dur mono small" aria-label="Durée">
                  {formatClockSeconds(seg.end - seg.start)}
                </span>

                <button
                  type="button"
                  className="ghost small editor-segment-row__focus-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    focusSegment(visIndex);
                  }}
                  title="Aller à ce segment sur la waveform"
                  aria-label={`Focus segment ${visIndex + 1}`}
                >
                  ⊙
                </button>
              </div>

              <div className="editor-segment-row__speaker-row">
                <select
                  className="editor-segment-row__speaker-select small"
                  value={seg.speaker ?? ""}
                  aria-label={`Locuteur segment ${visIndex + 1}`}
                  onChange={(e) => updateSegmentSpeaker(visIndex, e.target.value || null)}
                >
                  <option value="">—</option>
                  {uniqueSpeakers.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                  {seg.speaker && !uniqueSpeakers.includes(seg.speaker) && (
                    <option value={seg.speaker}>{seg.speaker}</option>
                  )}
                </select>

                {/* Actions inline — visibles uniquement sur le segment actif */}
                {isActive && (
                  <div className="editor-segment-row__inline-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={!canSplitActiveSegment}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={splitActiveSegmentAtCursor}
                      title="Couper au curseur waveform"
                      aria-label="Split"
                    >
                      ✂
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={!canMergePrev}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => mergeActiveSegment("prev")}
                      title="Fusionner avec le précédent"
                      aria-label="Fusionner précédent"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={!canMergeNext}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => mergeActiveSegment("next")}
                      title="Fusionner avec le suivant"
                      aria-label="Fusionner suivant"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="ghost small editor-segment-row__delete-btn"
                      disabled={!canDeleteSegment}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={deleteActiveSegment}
                      title="Supprimer ce segment"
                      aria-label="Supprimer"
                    >
                      🗑
                    </button>
                  </div>
                )}
              </div>

              <textarea
                className="editor-segment-row__text"
                value={seg.text ?? ""}
                rows={Math.max(1, Math.ceil((seg.text?.length ?? 0) / 60))}
                aria-label={`Texte segment ${visIndex + 1}`}
                onChange={(e) => updateSegmentText(visIndex, e.target.value)}
              />
            </li>
          );
        })}
      </ol>

      {hasMoreSegments && (
        <button
          type="button"
          className="ghost small editor-segment-list__load-more"
          onClick={() => setEditorVisibleCount((n) => n + 120)}
        >
          Charger 120 de plus… ({allSegmentsCount - editorVisibleCount} restants)
        </button>
      )}
    </div>
  );
});
