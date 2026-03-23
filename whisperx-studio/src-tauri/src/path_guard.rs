//! Validation des chemins transmis via IPC (frontend -> Tauri).
//!
//! Objectifs: rejeter les chemins trivialement invalides (vide, NUL, trop longs),
//! utiliser un chemin canonique pour les lectures/ouvertures afin de reduire les ambiguites
//! sur les sequences `..` (le comportement exact depend du FS et des liens symboliques).
//!
//! Les dossiers de sortie personnalises (`outputDir`) doivent etre **absolus**, et apres
//! canonicalisation ils doivent rester sous des racines considerees comme stres (donnees app,
//! Documents, home, volumes amovibles, repertoire temporaire, etc.) — pas sous `/etc` ou
//! `C:\Windows`.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Limite alignee sur les chemins utilisateur raisonnables (protection contre allocations excessives).
pub const MAX_PATH_STRING_BYTES: usize = 8192;

pub fn validate_path_string(raw: &str) -> Result<(), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("path is required".into());
    }
    if trimmed.len() > MAX_PATH_STRING_BYTES {
        return Err("path exceeds maximum length".into());
    }
    if trimmed.as_bytes().contains(&0) {
        return Err("path contains invalid characters".into());
    }
    Ok(())
}

/// Dossier de sortie choisi par l'utilisateur : absolu, cree si besoin, canonique, sous une racine autorisee.
pub fn validate_custom_output_dir(app: &AppHandle, raw: &str) -> Result<PathBuf, String> {
    validate_path_string(raw)?;
    let path = Path::new(raw.trim());
    if !path.is_absolute() {
        return Err("outputDir must be an absolute path".into());
    }
    std::fs::create_dir_all(path).map_err(|e| format!("Unable to create output directory: {e}"))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Unable to resolve output path: {e}"))?;
    ensure_output_dir_allowed(app, &canonical)?;
    Ok(canonical)
}

fn ensure_output_dir_allowed(app: &AppHandle, canonical: &Path) -> Result<(), String> {
    if let Ok(td) = std::env::temp_dir().canonicalize() {
        if canonical.starts_with(&td) {
            return Ok(());
        }
    }

    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().app_local_data_dir() {
        bases.push(p);
    }
    if let Ok(p) = app.path().app_data_dir() {
        bases.push(p);
    }
    if let Ok(p) = app.path().document_dir() {
        bases.push(p);
    }
    if let Ok(p) = app.path().download_dir() {
        bases.push(p);
    }
    #[cfg(unix)]
    if let Ok(h) = std::env::var("HOME") {
        bases.push(PathBuf::from(h));
    }
    #[cfg(windows)]
    if let Ok(h) = std::env::var("USERPROFILE") {
        bases.push(PathBuf::from(h));
    }

    for base in bases {
        if let Ok(bc) = base.canonicalize() {
            if canonical.starts_with(&bc) {
                return Ok(());
            }
        }
    }

    #[cfg(target_os = "macos")]
    if canonical.starts_with(Path::new("/Volumes")) {
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    if canonical.starts_with(Path::new("/media")) || canonical.starts_with(Path::new("/mnt")) {
        return Ok(());
    }

    #[cfg(windows)]
    if !is_dangerous_windows_system_path(canonical) {
        return Ok(());
    }

    Err(
        "outputDir must be under app data, Documents, Downloads, home, temp, a removable volume, or a safe non-system path"
            .into(),
    )
}

#[cfg(windows)]
fn is_dangerous_windows_system_path(p: &Path) -> bool {
    let s = p.to_string_lossy().to_uppercase();
    s.starts_with("C:\\WINDOWS")
        || s.starts_with("C:\\PROGRAM FILES")
        || s.starts_with("C:\\PROGRAM FILES (X86)")
        || s.starts_with("C:\\PROGRAMDATA")
}

/// Fichier existant; chemin canonique (liens symboliques resolus par le systeme).
pub fn resolve_existing_file_path(
    raw: &str,
    not_exist_msg: &'static str,
    not_file_msg: &'static str,
) -> Result<PathBuf, String> {
    validate_path_string(raw)?;
    let path = Path::new(raw.trim());
    if !path.exists() {
        return Err(not_exist_msg.into());
    }
    if !path.is_file() {
        return Err(not_file_msg.into());
    }
    path.canonicalize()
        .map_err(|e| format!("Unable to resolve path: {e}"))
}

/// Chemin existant (fichier ou repertoire) pour ouverture via shell (`open` / `xdg-open` / `explorer`).
pub fn resolve_existing_path_for_open(raw: &str) -> Result<PathBuf, String> {
    validate_path_string(raw)?;
    let path = Path::new(raw.trim());
    if !path.exists() {
        return Err(format!("Path does not exist on disk: {}", raw.trim()));
    }
    path.canonicalize()
        .map_err(|e| format!("Unable to resolve path: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_nul_byte() {
        assert!(validate_path_string("foo\u{0}bar").is_err());
    }

    #[test]
    fn rejects_overlong_path() {
        let s = "a".repeat(MAX_PATH_STRING_BYTES + 1);
        assert!(validate_path_string(&s).is_err());
    }

    #[test]
    fn accepts_reasonable_path_string() {
        assert!(validate_path_string(" /tmp/x ").is_ok());
    }
}
