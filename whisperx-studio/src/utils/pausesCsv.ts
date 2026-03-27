/**
 * Parse un `*.pauses.csv` WhisperX (colonnes speaker, start, end, dur, type — secondes).
 */

export type PauseIntervalSec = { start: number; end: number };

/** Découpe une ligne CSV simple (guillemets optionnels). */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

/**
 * Retourne les intervalles [start, end] en secondes (pauses valides uniquement).
 */
export function parsePausesCsv(text: string): PauseIntervalSec[] {
  const raw = text.replace(/^\uFEFF/, "").trim();
  if (!raw) {
    return [];
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return [];
  }
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const iStart = header.indexOf("start");
  const iEnd = header.indexOf("end");
  if (iStart < 0 || iEnd < 0) {
    return [];
  }
  const out: PauseIntervalSec[] = [];
  for (let li = 1; li < lines.length; li += 1) {
    const parts = splitCsvLine(lines[li]);
    const start = Number(parts[iStart]?.replace(",", "."));
    const end = Number(parts[iEnd]?.replace(",", "."));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    out.push({ start, end });
  }
  return out;
}
