import { useCallback, useEffect, useState } from "react";
import { readStoredHfToken, writeStoredHfToken } from "../hfTokenStorage";
import {
  LX_THEME_CHANGED_EVENT,
  readStoredThemePreference,
  setThemePreference as persistThemePreference,
  type LxThemePreference,
} from "../theme/applyStoredTheme";
import {
  notifyStudioPreferencesChanged,
  readWebAudioDefault,
  STUDIO_PREFS_CHANGED_EVENT,
  writeWebAudioDefault,
} from "../studioPreferences";

/**
 * Paramètres persistants (localStorage) : Web Audio par défaut, token Hugging Face.
 * À placer dans l’onglet À propos / diagnostic.
 */
export function StudioPreferencesPanel() {
  const [themePreference, setThemePreferenceState] = useState(readStoredThemePreference);
  const [webAudioDefault, setWebAudioDefault] = useState(readWebAudioDefault);
  const [hfToken, setHfToken] = useState(readStoredHfToken);
  const [hfSavedHint, setHfSavedHint] = useState(false);

  useEffect(() => {
    const onExternal = () => {
      setWebAudioDefault(readWebAudioDefault());
      setHfToken(readStoredHfToken());
    };
    window.addEventListener(STUDIO_PREFS_CHANGED_EVENT, onExternal);
    return () => window.removeEventListener(STUDIO_PREFS_CHANGED_EVENT, onExternal);
  }, []);

  useEffect(() => {
    const onThemeExternal = () => {
      setThemePreferenceState(readStoredThemePreference());
    };
    window.addEventListener(LX_THEME_CHANGED_EVENT, onThemeExternal);
    return () => window.removeEventListener(LX_THEME_CHANGED_EVENT, onThemeExternal);
  }, []);

  const onThemeChange = useCallback((pref: LxThemePreference) => {
    setThemePreferenceState(pref);
    persistThemePreference(pref);
  }, []);

  const onWebAudioChange = useCallback((checked: boolean) => {
    setWebAudioDefault(checked);
    writeWebAudioDefault(checked);
  }, []);

  const saveHfToken = useCallback(() => {
    writeStoredHfToken(hfToken);
    notifyStudioPreferencesChanged();
    setHfSavedHint(true);
    window.setTimeout(() => setHfSavedHint(false), 2000);
  }, [hfToken]);

  return (
    <section className="panel about-preferences-panel" aria-labelledby="about-prefs-title">
      <h3 id="about-prefs-title">Paramètres persistants</h3>
      <p className="small about-prefs-lead">
        Ces réglages sont enregistrés sur cette machine (navigateur / WebView). Ils complètent les
        options par job et le diagnostic runtime ci-dessous.
      </p>

      <fieldset className="about-prefs-row about-prefs-theme">
        <legend className="about-prefs-theme-legend">Apparence</legend>
        <p className="small about-prefs-theme-hint">
          Thème de l&apos;interface : <strong>Système</strong> suit le réglage du navigateur ou de
          l&apos;OS ; <strong>Clair</strong> ou <strong>Sombre</strong> force l&apos;affichage.
        </p>
        <div className="about-prefs-theme-radios" role="radiogroup" aria-label="Thème">
          {(
            [
              ["system", "Système"],
              ["light", "Clair"],
              ["dark", "Sombre"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="about-prefs-theme-option">
              <input
                type="radio"
                name="lx-theme-pref"
                value={value}
                checked={themePreference === value}
                onChange={() => onThemeChange(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="checkbox-row about-prefs-row">
        <input
          type="checkbox"
          checked={webAudioDefault}
          onChange={(e) => onWebAudioChange(e.currentTarget.checked)}
        />
        <span>
          <strong>Lecture Web Audio</strong> activée par défaut pour l&apos;audio (aperçu nouveau
          job, Alignement). Décoche pour utiliser le lecteur intégré tant que tu ne passes pas
          manuellement en Web Audio.
        </span>
      </label>

      <div className="about-prefs-hf">
        <label className="about-prefs-hf-label" htmlFor="about-hf-token">
          Token Hugging Face (diarisation / modèles gated)
        </label>
        <p className="small">
          Stocké localement ; utilisé comme valeur par défaut dans les formulaires WhisperX. Tu peux
          aussi le saisir par job dans les options avancées.
        </p>
        <div className="about-prefs-hf-row">
          <input
            id="about-hf-token"
            className="mono"
            type="password"
            autoComplete="off"
            value={hfToken}
            onChange={(e) => setHfToken(e.currentTarget.value)}
            onBlur={saveHfToken}
            placeholder="hf_…"
          />
          <button type="button" className="ghost" onClick={saveHfToken}>
            Enregistrer le token
          </button>
        </div>
        {hfSavedHint ? (
          <p className="small about-prefs-saved" role="status">
            Token enregistré — les formulaires ont été synchronisés.
          </p>
        ) : null}
      </div>
    </section>
  );
}
