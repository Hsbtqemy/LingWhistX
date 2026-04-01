//! Réduction des chemins absolus sensibles dans les textes (logs console, événements UI, erreurs).

/// Remplace les préfixes d’environnement usagers (`HOME`, `USERPROFILE`, `LOCALAPPDATA`) pour limiter l’exposition des chemins personnels.
pub(crate) fn redact_user_home_in_text(s: &str) -> String {
    let mut out = s.to_string();
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            out = out.replace(&home, "~");
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            out = out.replace(&profile, "~");
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if !local.is_empty() {
            out = out.replace(&local, "~LOCALAPPDATA");
        }
    }
    out
}
