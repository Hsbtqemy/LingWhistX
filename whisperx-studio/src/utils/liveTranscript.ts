import type { JobLogEvent, LiveTranscriptSegment } from "../types";

export function parseLiveTranscriptPayload(message: string): LiveTranscriptSegment | null {
  try {
    const o = JSON.parse(message) as Record<string, unknown>;
    const start = o.start;
    const end = o.end;
    const text = o.text;
    if (typeof start !== "number" || typeof end !== "number" || typeof text !== "string") {
      return null;
    }
    return { start, end, text };
  } catch {
    return null;
  }
}

export function formatLiveTranscriptSegment(seg: LiveTranscriptSegment): string {
  return `[${seg.start.toFixed(2)} → ${seg.end.toFixed(2)}] ${seg.text}`;
}

/** Formate une ligne de journal pour l’affichage (JSON wx_live → texte lisible). */
export function formatJobLogMessageForDisplay(log: JobLogEvent): string {
  if (log.stage === "wx_live_transcript") {
    const seg = parseLiveTranscriptPayload(log.message);
    if (seg) {
      return formatLiveTranscriptSegment(seg);
    }
  }
  return log.message;
}
