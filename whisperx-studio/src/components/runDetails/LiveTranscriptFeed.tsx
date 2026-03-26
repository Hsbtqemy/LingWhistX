import { useEffect, useRef } from "react";
import type { Job, LiveTranscriptSegment } from "../../types";
import { formatLiveTranscriptSegment } from "../../utils/liveTranscript";

export type LiveTranscriptFeedProps = {
  job: Job;
  segments: LiveTranscriptSegment[];
};

/**
 * Texte ASR au fil de l’eau (lignes « Transcript: » captées par le worker).
 */
export function LiveTranscriptFeed({ job, segments }: LiveTranscriptFeedProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [segments.length]);

  if (job.mode !== "whisperx") {
    return null;
  }

  const running = job.status === "running";
  const empty = segments.length === 0;

  return (
    <div className="live-transcript-feed" role="region" aria-label="Retranscription en direct">
      <div className="live-transcript-feed__head">
        <h4 className="live-transcript-feed__title">Retranscription en direct</h4>
        {running ? (
          <span className="live-transcript-feed__badge" aria-live="polite">
            En cours
          </span>
        ) : null}
      </div>
      {empty ? (
        <p className="live-transcript-feed__empty small">
          {running
            ? "Les segments apparaissent ici au fil de la transcription (comme dans le terminal Whisper)."
            : "Aucun segment reçu en direct pour ce job (lance un run WhisperX ou vérifie que la sortie verbose est active)."}
        </p>
      ) : (
        <div className="live-transcript-feed__body">
          {segments.map((seg, i) => (
            <p key={`${seg.start}-${seg.end}-${i}`} className="live-transcript-feed__line">
              {formatLiveTranscriptSegment(seg)}
            </p>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
