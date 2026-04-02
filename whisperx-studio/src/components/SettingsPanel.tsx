import type { LocalRuntimePanelProps } from "./LocalRuntimePanel";
import { StudioAboutView } from "./StudioAboutView";

export type SettingsPanelProps = {
  runtime: LocalRuntimePanelProps;
};

/**
 * Panneau Paramètres — coquille prête à accueillir WX-719 conventions.
 * Pour l'instant réutilise StudioAboutView (diagnostic runtime + préférences).
 */
export function SettingsPanel({ runtime }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <StudioAboutView runtime={runtime} />
    </div>
  );
}
