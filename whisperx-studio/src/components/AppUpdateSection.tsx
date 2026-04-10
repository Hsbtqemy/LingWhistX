import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { APP_VERSION } from "../appVersion";
import type { AppUpdateCheck } from "../types";

export function AppUpdateSection() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AppUpdateCheck | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await invoke<AppUpdateCheck>("check_app_update");
      setResult(r);
    } catch (e) {
      setResult({
        currentVersion: APP_VERSION,
        latestVersion: null,
        isUpToDate: true,
        updateAvailable: false,
        releaseUrl: null,
        installerDownloadUrl: null,
        publishedAt: null,
        fetchError: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <section className="panel about-update-panel" aria-labelledby="about-update-title">
      <h3 id="about-update-title">Mises à jour</h3>
      <p className="small about-update-lead">
        Vérifie la dernière release publique sur GitHub (nécessite une connexion Internet). Les
        installateurs MSI / NSIS y sont publiés ; l’installation reste manuelle.
      </p>
      <div className="about-update-actions">
        <button type="button" className="ghost" onClick={() => void check()} disabled={loading}>
          {loading ? "Vérification…" : "Vérifier les mises à jour"}
        </button>
      </div>

      {result && (
        <div className="about-update-status" role="status" aria-live="polite">
          {result.fetchError ? (
            <>
              <p className="small about-update-error">
                {result.fetchError.startsWith("GitHub API") || result.fetchError.includes("GitHub")
                  ? result.fetchError
                  : `Impossible de joindre GitHub : ${result.fetchError}`}
              </p>
              {result.releaseUrl ? (
                <div className="about-update-links">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void openUrl(result.releaseUrl!)}
                  >
                    Ouvrir la page de la release
                  </button>
                </div>
              ) : null}
            </>
          ) : result.updateAvailable ? (
            <>
              <p className="small about-update-available">
                Une nouvelle version est disponible :{" "}
                <span className="mono">{result.latestVersion ?? "—"}</span>
                {result.publishedAt ? (
                  <> (publiée le {new Date(result.publishedAt).toLocaleString()})</>
                ) : null}
              </p>
              <p className="small">
                Version installée : <span className="mono">{result.currentVersion}</span>
              </p>
              <div className="about-update-links">
                {result.releaseUrl ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void openUrl(result.releaseUrl!)}
                  >
                    Ouvrir la page de la release
                  </button>
                ) : null}
                {result.installerDownloadUrl ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void openUrl(result.installerDownloadUrl!)}
                  >
                    Télécharger l’installateur
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <p className="small about-update-ok">
                {result.isUpToDate
                  ? "Vous utilisez la dernière version publique (ou une version plus récente)."
                  : "Aucune mise à jour obligatoire détectée."}
              </p>
              {result.latestVersion ? (
                <p className="small">
                  Dernière release GitHub : <span className="mono">{result.latestVersion}</span>
                  {result.publishedAt ? (
                    <> — {new Date(result.publishedAt).toLocaleDateString()}</>
                  ) : null}
                </p>
              ) : null}
              <p className="small">
                Version installée : <span className="mono">{result.currentVersion}</span>
              </p>
              {result.releaseUrl ? (
                <div className="about-update-links">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void openUrl(result.releaseUrl!)}
                  >
                    Voir les notes de version
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}
