/**
 * Extensions d’export WhisperX alignées sur `whisperx.utils.get_writer` / worker
 * (`_normalize_output_format_for_cli`). Hors options « data science » additionnelles (.csv, etc.).
 */
const ALL_WRITER_EXTENSIONS = ["txt", "vtt", "srt", "tsv", "json"] as const;

/**
 * Extensions d’annotation (WX-670) produites selon les flags d’options.
 */
export function expectedAnnotationExtensions(
  opts:
    | {
        exportAnnotationEaf?: boolean;
        exportAnnotationTextgrid?: boolean;
      }
    | undefined
    | null,
): string[] {
  const out: string[] = [];
  if (opts?.exportAnnotationEaf) out.push("eaf");
  if (opts?.exportAnnotationTextgrid) out.push("TextGrid");
  return out;
}

/**
 * Liste d’extensions attendues pour le fichier principal `{stem}.{ext}` selon `outputFormat` du job.
 */
export function expectedWhisperxStemExtensions(outputFormat: string | undefined | null): string[] {
  const raw = (outputFormat ?? "all").trim().toLowerCase();
  if (!raw || raw === "all") {
    return [...ALL_WRITER_EXTENSIONS];
  }
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set<string>(["json", "srt", "vtt", "txt", "tsv", "aud"]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (!allowed.has(p) || seen.has(p)) {
      continue;
    }
    seen.add(p);
    out.push(p);
  }
  if (!seen.has("json")) {
    out.unshift("json");
  }
  return out;
}

export function mediaStemFromInputPath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return base;
  }
  return base.slice(0, dot);
}

/** Indique si la liste de chemins absolus contient `{stem}.{ext}`. */
export function hasStemExtensionFile(paths: readonly string[], stem: string, ext: string): boolean {
  const want = `${stem}.${ext}`.toLowerCase();
  for (const p of paths) {
    const normalized = p.replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    if (base.toLowerCase() === want) {
      return true;
    }
  }
  return false;
}
