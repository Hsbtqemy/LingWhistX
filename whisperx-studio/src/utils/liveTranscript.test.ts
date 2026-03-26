import { describe, expect, it } from "vitest";
import { formatLiveTranscriptSegment, parseLiveTranscriptPayload } from "./liveTranscript";

describe("parseLiveTranscriptPayload", () => {
  it("parse le JSON worker", () => {
    const s = parseLiveTranscriptPayload(
      JSON.stringify({ start: 1.2, end: 3.4, text: "hello" }),
    );
    expect(s).toEqual({ start: 1.2, end: 3.4, text: "hello" });
  });
});

describe("formatLiveTranscriptSegment", () => {
  it("formate les bornes", () => {
    expect(
      formatLiveTranscriptSegment({ start: 0, end: 1.25, text: "x" }),
    ).toMatch(/0\.00.*1\.25/);
  });
});
