//! Vérification de mise à jour via l’API GitHub Releases (dépôt public).

use serde::Serialize;
use tauri::AppHandle;

/// Dépôt source des releases installateurs (MSI / NSIS).
const GITHUB_API_LATEST: &str = "https://api.github.com/repos/Hsbtqemy/LingWhistX/releases/latest";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheck {
    pub current_version: String,
    pub latest_version: Option<String>,
    /// Installée >= dernière release (y compris build local plus récent que GitHub).
    pub is_up_to_date: bool,
    /// Une release GitHub a un numéro de version strictement supérieur.
    pub update_available: bool,
    pub release_url: Option<String>,
    /// Asset Windows (.msi / setup .exe) si détecté sur la release.
    pub installer_download_url: Option<String>,
    pub published_at: Option<String>,
    pub fetch_error: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubLatestRelease {
    tag_name: String,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

fn normalize_version_str(raw: &str) -> &str {
    raw.trim().trim_start_matches(|c| c == 'v' || c == 'V')
}

fn parse_semver(raw: &str) -> Option<semver::Version> {
    semver::Version::parse(normalize_version_str(raw)).ok()
}

fn pick_windows_installer_url(assets: &[GithubAsset]) -> Option<String> {
    let mut candidates: Vec<&GithubAsset> = assets
        .iter()
        .filter(|a| {
            let n = a.name.to_lowercase();
            (n.ends_with(".msi") || n.ends_with(".exe")) && n.contains("whisperx-studio")
        })
        .collect();
    if candidates.is_empty() {
        candidates = assets
            .iter()
            .filter(|a| {
                let n = a.name.to_lowercase();
                n.ends_with(".msi") || (n.ends_with(".exe") && n.contains("setup"))
            })
            .collect();
    }
    candidates.first().map(|a| a.browser_download_url.clone())
}

async fn fetch_latest_release() -> Result<GithubLatestRelease, String> {
    let ua = format!(
        "LingWhistX-Studio/{} (desktop; update check)",
        env!("CARGO_PKG_VERSION")
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .user_agent(ua)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(GITHUB_API_LATEST)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "GitHub API {} : {}",
            status.as_u16(),
            body.chars().take(200).collect::<String>()
        ));
    }
    resp.json::<GithubLatestRelease>()
        .await
        .map_err(|e| format!("Réponse release invalide : {e}"))
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<AppUpdateCheck, String> {
    let current_version = app.package_info().version.to_string();
    let current_v = parse_semver(&current_version);

    let release = match fetch_latest_release().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(AppUpdateCheck {
                current_version,
                latest_version: None,
                is_up_to_date: true,
                update_available: false,
                release_url: None,
                installer_download_url: None,
                published_at: None,
                fetch_error: Some(e),
            });
        }
    };

    let latest_raw = release.tag_name.clone();
    let installer_download_url = pick_windows_installer_url(&release.assets);

    let Some(latest_sem) = parse_semver(&latest_raw) else {
        return Ok(AppUpdateCheck {
            current_version,
            latest_version: Some(latest_raw.clone()),
            is_up_to_date: true,
            update_available: false,
            release_url: Some(release.html_url.clone()),
            installer_download_url,
            published_at: release.published_at.clone(),
            fetch_error: Some(format!(
                "Tag de release non semver : {latest_raw:?} (comparaison impossible)."
            )),
        });
    };

    let (update_available, is_up_to_date) = match current_v {
        Some(ref c) => {
            let avail = latest_sem > *c;
            (avail, !avail)
        }
        None => (false, true),
    };

    Ok(AppUpdateCheck {
        current_version,
        latest_version: Some(latest_raw),
        is_up_to_date,
        update_available,
        release_url: Some(release.html_url),
        installer_download_url,
        published_at: release.published_at,
        fetch_error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_v_prefix() {
        assert_eq!(normalize_version_str("v1.2.3"), "1.2.3");
        assert_eq!(normalize_version_str("1.2.3"), "1.2.3");
    }

    #[test]
    fn pick_prefers_whisperx_studio_asset() {
        let assets = vec![
            GithubAsset {
                name: "source.zip".into(),
                browser_download_url: "https://x/z.zip".into(),
            },
            GithubAsset {
                name: "whisperx-studio_0.1.1_x64-setup.exe".into(),
                browser_download_url: "https://x/setup.exe".into(),
            },
        ];
        assert_eq!(
            pick_windows_installer_url(&assets).as_deref(),
            Some("https://x/setup.exe")
        );
    }
}
