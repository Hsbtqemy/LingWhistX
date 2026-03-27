import { useCallback, useEffect, useState } from "react";
import { readStoredHfToken, writeStoredHfToken } from "../hfTokenStorage";
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
