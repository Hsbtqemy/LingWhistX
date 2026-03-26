/**
 * Résout un chemin local depuis un événement `drop` (Tauri WebView, navigateur, macOS uri-list).
 */

function fileUrlToLocalPath(fileUrl: string): string | null {
  try {
    const u = new URL(fileUrl);
    if (u.protocol !== "file:") {
      return null;
    }
    let p = decodeURIComponent(u.pathname);
    // Windows file:///C:/... → pathname /C:/...
    if (/^\/[A-Za-z]:\//.test(p)) {
      p = p.slice(1);
    }
    return p.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Premier fichier droppé avec chemin exploitable pour `create_job` (disque local).
 */
export function resolveDroppedFilePathFromDragEvent(event: DragEvent): string | null {
  const dt = event.dataTransfer;
  if (!dt) {
    return null;
  }

  const file = dt.files?.[0];
  if (file) {
    const p = (file as File & { path?: string }).path;
    if (typeof p === "string" && p.trim()) {
      return p.trim();
    }
  }

  const uriList = dt.getData("text/uri-list").trim();
  if (uriList) {
    const first = uriList.split(/\r?\n/u)[0]?.trim();
    if (first) {
      const fromUrl = fileUrlToLocalPath(first);
      if (fromUrl) {
        return fromUrl;
      }
    }
  }

  return null;
}
