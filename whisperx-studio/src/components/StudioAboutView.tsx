import type { LocalRuntimePanelProps } from "./LocalRuntimePanel";
import { AppUpdateSection } from "./AppUpdateSection";
import { LocalRuntimePanel } from "./LocalRuntimePanel";
import { MachineSummaryPanel } from "./MachineSummaryPanel";
import { StudioPreferencesPanel } from "./StudioPreferencesPanel";
import { APP_VERSION } from "../appVersion";

export type StudioAboutViewProps = {
  runtime: LocalRuntimePanelProps;
};

export function StudioAboutView({ runtime }: StudioAboutViewProps) {
  return (
    <div className="about-view">
      <section className="panel about-intro">
        <div className="tagline">LingWhistX Studio</div>
        <h2>À propos &amp; diagnostic</h2>
        <p className="subtitle">
          Application desktop local-first pour orchestrer WhisperX, éditer les transcripts et
          exporter vers plusieurs formats.
        </p>
        <p className="small">
          <strong>Version</strong> <span className="mono">{APP_VERSION}</span>
        </p>
        <p className="small">
          Documentation : voir <span className="mono">README.md</span> à la racine du dépôt et{" "}
          <span className="mono">whisperx-studio/README.md</span> pour le mode Studio.
        </p>
      </section>

      <AppUpdateSection />

      <StudioPreferencesPanel />

      <MachineSummaryPanel runtimeStatus={runtime.runtimeStatus} />

      <section className="panel about-runtime-section">
        <LocalRuntimePanel {...runtime} />
      </section>
    </div>
  );
}
