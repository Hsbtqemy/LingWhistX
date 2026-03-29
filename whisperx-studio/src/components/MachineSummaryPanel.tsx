import type { RuntimeStatus } from "../types";

export type MachineSummaryPanelProps = {
  runtimeStatus: RuntimeStatus | null;
};

/**
 * Résumé navigateur + pile Python/PyTorch/ffmpeg (après « Vérifier le runtime »).
 */
export function MachineSummaryPanel({ runtimeStatus }: MachineSummaryPanelProps) {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  const lang = typeof navigator !== "undefined" ? navigator.language : "";

  return (
    <section className="panel about-machine-panel" aria-labelledby="about-machine-title">
      <h3 id="about-machine-title">Environnement &amp; machine</h3>
      <p className="small about-machine-lead">
        Informations côté interface (WebView) et, après vérification du runtime, la pile Python
        détectée.
      </p>
      <dl className="about-machine-dl">
        <dt>Plateforme (OS / UI)</dt>
        <dd className="mono">{platform || "—"}</dd>
        <dt>Langue UI</dt>
        <dd>{lang || "—"}</dd>
        <dt>User-Agent</dt>
        <dd className="mono about-machine-ua" title={ua}>
          {ua ? (ua.length > 160 ? `${ua.slice(0, 160)}…` : ua) : "—"}
        </dd>
      </dl>

      {runtimeStatus?.whisperxOk ? (
        <>
          <h4 className="about-machine-sub">Pile locale (sonde Python)</h4>
          <dl className="about-machine-dl">
            <dt>sys.platform (Python)</dt>
            <dd className="mono">{runtimeStatus.pythonPlatform ?? "—"}</dd>
            <dt>PyTorch — CUDA</dt>
            <dd>{runtimeStatus.torchCudaAvailable ? "oui" : "non"}</dd>
            <dt>PyTorch — MPS (Apple)</dt>
            <dd>{runtimeStatus.torchMpsAvailable ? "oui" : "non"}</dd>
            <dt>Défaut WhisperX (device)</dt>
            <dd className="mono">{runtimeStatus.whisperxDefaultDevice ?? "—"}</dd>
            <dt>WhisperX</dt>
            <dd className="mono">{runtimeStatus.whisperxVersion ?? "—"}</dd>
            <dt>Demucs (WX-666)</dt>
            <dd>
              {runtimeStatus.demucsOk ? (
                <span className="mono">{runtimeStatus.demucsVersion ?? "ok"}</span>
              ) : (
                <span className="about-machine-missing">
                  non installé —{" "}
                  <code>pip install demucs</code>
                </span>
              )}
            </dd>
            <dt>Python</dt>
            <dd className="mono">{runtimeStatus.pythonCommand}</dd>
          </dl>
        </>
      ) : (
        <p className="small about-machine-hint">
          Lance <strong>Vérifier le runtime</strong> dans le panneau ci-dessous pour afficher
          PyTorch, CUDA/MPS et la commande Python utilisée par l&apos;app.
        </p>
      )}
    </section>
  );
}
