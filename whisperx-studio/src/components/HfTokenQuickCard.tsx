import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { UiWhisperxOptions } from "../types";

export type HfTokenQuickCardProps = {
  whisperxOptions: UiWhisperxOptions;
  setWhisperxOptions: Dispatch<SetStateAction<UiWhisperxOptions>>;
};

/**
 * Zone dédiée en tête du formulaire — plus visible que le champ dans les options WhisperX avancées.
 */
export function HfTokenQuickCard({ whisperxOptions, setWhisperxOptions }: HfTokenQuickCardProps) {
  const patch = useCallback(
    (hfToken: string) => {
      setWhisperxOptions((prev) => ({ ...prev, hfToken }));
    },
    [setWhisperxOptions],
  );

  const needsToken = whisperxOptions.diarize && !whisperxOptions.hfToken.trim();

  return (
    <div className="hf-token-card">
      <div className="hf-token-card__header">
        <h3 className="hf-token-card__title">Token Hugging Face</h3>
        <p className="hf-token-card__subtitle">
          Obligatoire si tu actives la <strong>diarization</strong> (modèles pyannote, dépôts
          soumis à accord sur Hugging Face). Le token est mémorisé sur cette machine.
        </p>
      </div>
      <label className="hf-token-card__label">
        <span className="hf-token-card__label-text">Coller le token (lecture)</span>
        <input
          type="password"
          className="hf-token-card__input mono"
          value={whisperxOptions.hfToken}
          onChange={(e) => patch(e.currentTarget.value)}
          placeholder="hf_…"
          autoComplete="off"
          spellCheck={false}
          aria-required={whisperxOptions.diarize}
          aria-invalid={needsToken}
          aria-describedby="hf-token-card-help"
        />
      </label>
      <p id="hf-token-card-help" className="hf-token-card__help">
        Créer un token :{" "}
        <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
          huggingface.co/settings/tokens
        </a>
        {" · "}
        Accepter les conditions des modèles pyannote sur leur page HF si demandé.
      </p>
      {needsToken ? (
        <p className="import-summary-warning hf-token-card__warn" role="alert">
          Diarization activée : renseigne le token ci-dessus, sinon le lancement du job sera refusé.
        </p>
      ) : null}
    </div>
  );
}
