import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UiWhisperxOptions } from "../types";
import { HfScopeBadge } from "./HfScopeBadge";

type HfValidationState = { ok: boolean; message: string } | null;

export type HfTokenQuickCardProps = {
  whisperxOptions: UiWhisperxOptions;
  setWhisperxOptions: Dispatch<SetStateAction<UiWhisperxOptions>>;
  /** Permet d’adapter le libellé (mock / analyze_only = pas de WhisperX). */
  mode: "mock" | "whisperx" | "analyze_only";
};

/**
 * Zone dédiée en tête du formulaire — plus visible que le champ dans les options WhisperX avancées.
 */
export function HfTokenQuickCard({
  whisperxOptions,
  setWhisperxOptions,
  mode,
}: HfTokenQuickCardProps) {
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<HfValidationState>(null);

  const patch = useCallback(
    (hfToken: string) => {
      setWhisperxOptions((prev) => ({ ...prev, hfToken }));
    },
    [setWhisperxOptions],
  );

  useEffect(() => {
    setValidation(null);
  }, [whisperxOptions.hfToken]);

  const validateToken = useCallback(async () => {
    const raw = whisperxOptions.hfToken.trim();
    if (!raw) {
      setValidation({ ok: false, message: "Colle d’abord un token dans le champ." });
      return;
    }
    setValidating(true);
    setValidation(null);
    try {
      const result = await invoke<{ ok: boolean; message: string }>("validate_hf_token", {
        token: raw,
      });
      setValidation({ ok: result.ok, message: result.message });
    } catch (e) {
      setValidation({ ok: false, message: String(e) });
    } finally {
      setValidating(false);
    }
  }, [whisperxOptions.hfToken]);

  const needsToken = whisperxOptions.diarize && !whisperxOptions.hfToken.trim();
  const whisperxNoDiarize = mode === "whisperx" && !whisperxOptions.diarize;
  const hfRelevant = mode === "whisperx";

  const title =
    mode !== "whisperx"
      ? "Token Hugging Face"
      : whisperxNoDiarize
        ? "Token Hugging Face (optionnel)"
        : "Token Hugging Face (diarization)";

  return (
    <div
      className={`hf-token-card${hfRelevant ? "" : " hf-token-card--muted"}${
        mode === "whisperx" && whisperxOptions.diarize ? " hf-token-card--required" : ""
      }`}
    >
      <div className="hf-token-card__header">
        <h3 className="hf-token-card__title">
          {title}
          {mode === "whisperx" ? (
            <span className="hf-token-card__title-badges">
              {whisperxOptions.diarize ? (
                <HfScopeBadge variant="hf_required" />
              ) : (
                <HfScopeBadge variant="hf_not_required" />
              )}
            </span>
          ) : null}
        </h3>
        <p className="hf-token-card__subtitle">
          {mode !== "whisperx" ? (
            <>
              Utilisé uniquement pour un job <strong>WhisperX</strong> avec{" "}
              <strong>diarization</strong>. En mode mock ou analyze-only, aucun token n’est
              nécessaire.
            </>
          ) : whisperxNoDiarize ? (
            <>
              Pour une <strong>simple retranscription</strong> Whisper + alignement, tu n’as pas
              besoin de compte Hugging Face. Le token ne devient obligatoire que si tu coches{" "}
              <strong>Diarization</strong> dans les options avancées (modèles pyannote sur le Hub).
            </>
          ) : (
            <>
              Obligatoire pour cette run : la <strong>diarization</strong> télécharge des modèles
              pyannote soumis à accord sur Hugging Face. Sur la page du modèle par défaut, accepte
              les conditions (« Agree and access repository ») sinon le Hub renvoie une erreur 401.
              Le token est mémorisé sur cette machine.
            </>
          )}
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
          aria-required={mode === "whisperx" && whisperxOptions.diarize}
          aria-invalid={mode === "whisperx" && needsToken}
          aria-describedby={
            validation ? "hf-token-card-help hf-token-card-validation" : "hf-token-card-help"
          }
        />
      </label>
      <div className="hf-token-card__actions">
        <button
          type="button"
          className="ghost inline hf-token-card__validate-btn"
          onClick={() => void validateToken()}
          disabled={validating || !whisperxOptions.hfToken.trim()}
        >
          {validating ? "Vérification…" : "Valider le token"}
        </button>
        <span className="hf-token-card__actions-hint">
          Appel Hugging Face <code>whoami</code> (compte associé au token).
        </span>
      </div>
      {validation ? (
        <p
          id="hf-token-card-validation"
          className={
            validation.ok
              ? "hf-token-card__validation hf-token-card__validation--ok"
              : "hf-token-card__validation hf-token-card__validation--err"
          }
          role="status"
        >
          {validation.message}
        </p>
      ) : null}
      <p id="hf-token-card-help" className="hf-token-card__help">
        Créer un token :{" "}
        <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
          huggingface.co/settings/tokens
        </a>
        {" · "}
        Modèle diarization par défaut (conditions à accepter) :{" "}
        <a
          href="https://huggingface.co/pyannote/speaker-diarization-community-1"
          target="_blank"
          rel="noreferrer"
        >
          pyannote/speaker-diarization-community-1
        </a>
      </p>

      <div className="hf-token-card__credits-note">
        <p className="hf-token-card__credits-lead">
          <strong>Crédits / solde</strong> : Hugging Face ne fournit pas d’API publique et stable
          pour afficher le montant exact restant dans une app externe (le tableau de bord web reste
          la référence). Par ailleurs, <strong>WhisperX en local</strong> ne consomme pas les
          crédits « Inference Providers » comme une API cloud : tu télécharges les poids une fois ;
          la transcription ne débite pas ce compteur à la minute.
        </p>
        <div className="hf-token-card__credits-actions">
          <button
            type="button"
            className="ghost inline"
            onClick={() => void openUrl("https://huggingface.co/settings/billing")}
          >
            Facturation et crédits (navigateur)
          </button>
          <button
            type="button"
            className="ghost inline"
            onClick={() =>
              void openUrl("https://huggingface.co/settings/inference-providers/overview")
            }
          >
            Usage Inference Providers
          </button>
        </div>
      </div>

      {mode === "whisperx" && needsToken ? (
        <p className="import-summary-warning hf-token-card__warn" role="alert">
          Diarization activée : renseigne le token ci-dessus, sinon le lancement du job sera refusé.
        </p>
      ) : null}
    </div>
  );
}
