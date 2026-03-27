import type { UiWhisperxOptions } from "../types";

export type RunHfRequirementsSummaryProps = {
  whisperxOptions: UiWhisperxOptions;
};

/**
 * Récap avant lancement : qu’est-ce qui exige un compte / token Hugging Face vs transcription seule.
 */
export function RunHfRequirementsSummary({ whisperxOptions }: RunHfRequirementsSummaryProps) {
  const diarize = whisperxOptions.diarize;
  const hasToken = whisperxOptions.hfToken.trim().length > 0;

  return (
    <div className="run-hf-requirements" role="region" aria-label="Besoin d’un compte Hugging Face">
      <h4 className="run-hf-requirements__title">Compte Hugging Face et cette run</h4>
      <ul className="run-hf-requirements__list">
        <li>
          <strong>Transcription Whisper</strong> (ASR) et <strong>alignement</strong> des mots :{" "}
          <span className="run-hf-requirements__ok">aucun token HF requis</span> — les modèles
          Whisper utilisés ici sont utilisables sans compte.
        </li>
        <li>
          <strong>Diarization</strong> (qui parle, pyannote via Hugging Face) :{" "}
          {diarize ? (
            <>
              <span className="run-hf-requirements__warn">token HF obligatoire</span>
              {hasToken
                ? " — token renseigné dans la section ci-dessus."
                : " — renseigne le token dans la section Hugging Face ci-dessus."}
            </>
          ) : (
            <>
              <span className="run-hf-requirements__ok">désactivée — pas de token requis</span> pour
              les locuteurs.
            </>
          )}
        </li>
      </ul>
    </div>
  );
}
