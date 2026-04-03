import type { LocalRuntimePanelProps } from "./LocalRuntimePanel";
import { StudioAboutView } from "./StudioAboutView";
import { AnnotationConventionEditor } from "./AnnotationConventionEditor";

export type SettingsPanelProps = {
  runtime: LocalRuntimePanelProps;
};

export function SettingsPanel({ runtime }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3 className="settings-section-title">Conventions d'annotation</h3>
        <AnnotationConventionEditor />
      </section>
      <section className="settings-section">
        <h3 className="settings-section-title">Environnement</h3>
        <StudioAboutView runtime={runtime} />
      </section>
    </div>
  );
}
