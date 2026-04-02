//! Réduction des chemins absolus sensibles dans les textes (logs console, événements UI, erreurs).
//!
//! Les remplacements sont appliqués **du chemin le plus long au plus court**, puis dédupliqués,
//! pour éviter qu’un préfixe court (ex. `HOME`) ne casse une occurrence encore nécessaire
//! d’un chemin plus long (ex. `LOCALAPPDATA`, `XDG_CONFIG_HOME`).

/// Remplace les préfixes d’environnement usagers (`HOME`, `USERPROFILE`, `LOCALAPPDATA`, etc.)
/// pour limiter l’exposition des chemins personnels.
pub(crate) fn redact_user_home_in_text(s: &str) -> String {
    let pairs = collect_env_redaction_pairs();
    apply_redactions(s, &pairs)
}

fn collect_env_redaction_pairs() -> Vec<(String, &'static str)> {
    let mut pairs: Vec<(String, &'static str)> = Vec::new();

    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            pairs.push((home, "~"));
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            pairs.push((profile, "~"));
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if !local.is_empty() {
            pairs.push((local, "~LOCALAPPDATA"));
        }
    }
    if let Ok(roam) = std::env::var("APPDATA") {
        if !roam.is_empty() {
            pairs.push((roam, "~APPDATA"));
        }
    }
    for (var, placeholder) in [
        ("XDG_CONFIG_HOME", "~XDG_CONFIG_HOME"),
        ("XDG_DATA_HOME", "~XDG_DATA_HOME"),
        ("XDG_STATE_HOME", "~XDG_STATE_HOME"),
        ("XDG_CACHE_HOME", "~XDG_CACHE_HOME"),
    ] {
        if let Ok(v) = std::env::var(var) {
            if !v.is_empty() {
                pairs.push((v, placeholder));
            }
        }
    }

    pairs
}

fn apply_redactions(s: &str, pairs: &[(String, &str)]) -> String {
    let mut ordered: Vec<(String, &str)> = pairs
        .iter()
        .filter(|(v, _)| !v.is_empty())
        .map(|(a, b)| (a.clone(), *b))
        .collect();
    ordered.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    let mut seen = std::collections::HashSet::<String>::new();
    ordered.retain(|(path, _)| seen.insert(path.clone()));

    let mut out = s.to_string();
    for (value, ph) in ordered {
        out = out.replace(&value, ph);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{apply_redactions, collect_env_redaction_pairs, redact_user_home_in_text};

    #[test]
    fn longest_path_replaced_before_shorter_prefix() {
        let long = "/home/testuser/.config";
        let short = "/home/testuser";
        // Ordre volontairement « mauvais » : `apply_redactions` trie par longueur décroissante.
        let pairs = vec![
            (short.to_string(), "~"),
            (long.to_string(), "~XDG_CONFIG_HOME"),
        ];
        let s = format!("see {long}/app and {short}/other");
        let out = apply_redactions(&s, &pairs);
        assert!(
            out.contains("~XDG_CONFIG_HOME/"),
            "long path should be redacted first: {out}"
        );
        assert!(
            !out.contains(long),
            "full long path should not remain: {out}"
        );
    }

    #[test]
    fn redact_replaces_home_when_set() {
        let home = std::env::var("HOME").unwrap_or_default();
        if home.is_empty() {
            return;
        }
        let s = format!("before {home}/after");
        let pairs = collect_env_redaction_pairs();
        let out = apply_redactions(&s, &pairs);
        assert!(!out.contains(&home), "{out}");
        assert!(out.contains('~'));
    }

    #[test]
    fn redact_user_home_matches_apply_pipeline() {
        let s = "noop";
        assert_eq!(redact_user_home_in_text(s), apply_redactions(s, &collect_env_redaction_pairs()));
    }
}
