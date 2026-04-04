/**
 * Exécute la fonction retournée par `listen()` sans laisser filer une rejection
 * si le listener est déjà désenregistré (Strict Mode React, navigation rapide,
 * double appel — ex. `listeners[eventId]` undefined côté plugin Tauri).
 */
export function unlistenFromPromise(promise: Promise<() => void>): void {
  void promise
    .then((unlisten) => {
      void Promise.resolve()
        .then(() => unlisten())
        .catch(() => {
          /* déjà désenregistré ou webview invalide */
        });
    })
    .catch(() => {
      /* listen() n’a pas abouti avant le cleanup */
    });
}
