import { describe, expect, it } from "vitest";
import { formatDuration, parseOptionalFloat } from "./studioExplorerUi";

describe("formatDuration (Explorer)", () => {
  it("retourne tiret pour null / invalide", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });

  it("formate mm:ss et hh:mm:ss", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });
});

describe("parseOptionalFloat (Explorer)", () => {
  it("retourne null pour vide ou invalide", () => {
    expect(parseOptionalFloat("")).toBeNull();
    expect(parseOptionalFloat("   ")).toBeNull();
    expect(parseOptionalFloat("abc")).toBeNull();
  });

  it("parse un nombre fini", () => {
    expect(parseOptionalFloat("3.14")).toBe(3.14);
    expect(parseOptionalFloat(" 2 ")).toBe(2);
  });
});
