//! Vérification du token Hugging Face via l’API officielle (sans exposer le secret côté logs).

use serde::Serialize;

use crate::log_redaction::redact_user_home_in_text;

const HF_WHOAMI: &str = "https://huggingface.co/api/whoami-v2";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HfTokenValidationResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[tauri::command]
pub async fn validate_hf_token(token: String) -> Result<HfTokenValidationResult, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Colle d’abord un token (hf_…).".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Client HTTP: {}", redact_user_home_in_text(&e.to_string())))?;

    let response = client
        .get(HF_WHOAMI)
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "whisperx-studio/0.1 (token-validation)")
        .send()
        .await
        .map_err(|e| format!("Réseau: {}", redact_user_home_in_text(&e.to_string())))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(HfTokenValidationResult {
            ok: false,
            message:
                "Token refusé par Hugging Face (401). Vérifie la valeur, les droits de lecture, ou régénère le token."
                    .into(),
            username: None,
        });
    }

    if !status.is_success() {
        let body_hint = response.text().await.unwrap_or_default();
        let short = body_hint.chars().take(200).collect::<String>();
        return Ok(HfTokenValidationResult {
            ok: false,
            message: format!("Réponse Hugging Face inattendue ({status}). {short}",),
            username: None,
        });
    }

    let value: serde_json::Value = response.json().await.map_err(|e| {
        format!(
            "Réponse JSON invalide: {}",
            redact_user_home_in_text(&e.to_string())
        )
    })?;

    let username = value
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| value.get("id").and_then(|v| v.as_str()).map(str::to_string));

    let name_display = username.as_deref().unwrap_or("(compte inconnu)");

    Ok(HfTokenValidationResult {
        ok: true,
        message: format!("Token accepté — connecté en tant que « {name_display} »."),
        username,
    })
}
