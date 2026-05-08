use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: String,
    pub current_version: String,
    pub release_url: Option<String>,
    pub can_install: bool,
}

pub async fn check_for_updates(app: AppHandle) -> Result<bool, String> {
    if let Ok(updater) = app.updater() {
        if let Ok(Some(update)) = updater.check().await {
            emit_update_available(
                &app,
                UpdateInfo {
                    version: update.version.clone(),
                    body: update.body.clone().unwrap_or_default(),
                    current_version: current_version(),
                    release_url: None,
                    can_install: true,
                },
            );
            return Ok(true);
        }
    }

    let release = fetch_latest_github_release().await?;
    if !is_newer_version(&release.tag_name, &current_version()) {
        return Ok(false);
    }

    emit_update_available(
        &app,
        UpdateInfo {
            version: normalize_version(&release.tag_name),
            body: release.body.unwrap_or_default(),
            current_version: current_version(),
            release_url: Some(release.html_url),
            can_install: false,
        },
    );
    Ok(true)
}

pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }

    Ok(())
}

pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn open_release_page(url: String) -> Result<(), String> {
    if !(url.starts_with("https://github.com/gfishlab/MdBridge/releases/")
        || url == "https://github.com/gfishlab/MdBridge/releases")
    {
        return Err("不允许打开未知更新链接".into());
    }

    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/C").arg("start").arg("");
        cmd
    };
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");

    command
        .arg(url)
        .spawn()
        .map_err(|e| format!("打开下载页面失败: {}", e))?;
    Ok(())
}

fn emit_update_available(app: &AppHandle, info: UpdateInfo) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("update-available", info);
    }
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
}

async fn fetch_latest_github_release() -> Result<GithubRelease, String> {
    let response = reqwest::Client::new()
        .get("https://api.github.com/repos/gfishlab/MdBridge/releases/latest")
        .header("User-Agent", "MDBridge")
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("检查更新失败: HTTP {}", response.status()));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("读取更新信息失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("解析更新信息失败: {}", e))
}

fn is_newer_version(remote: &str, current: &str) -> bool {
    let remote_parts = version_parts(remote);
    let current_parts = version_parts(current);
    for i in 0..remote_parts.len().max(current_parts.len()) {
        let remote_part = *remote_parts.get(i).unwrap_or(&0);
        let current_part = *current_parts.get(i).unwrap_or(&0);
        if remote_part > current_part {
            return true;
        }
        if remote_part < current_part {
            return false;
        }
    }
    false
}

fn version_parts(version: &str) -> Vec<u64> {
    normalize_version(version)
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn normalize_version(version: &str) -> String {
    version.trim().trim_start_matches('v').to_string()
}

#[cfg(test)]
mod tests {
    use super::is_newer_version;

    #[test]
    fn compares_versions_with_v_prefix() {
        assert!(is_newer_version("v0.1.5", "0.1.4"));
        assert!(!is_newer_version("v0.1.4", "0.1.4"));
        assert!(!is_newer_version("v0.1.3", "0.1.4"));
    }

    #[test]
    fn compares_versions_with_missing_patch_parts() {
        assert!(is_newer_version("0.2", "0.1.9"));
        assert!(!is_newer_version("0.1", "0.1.1"));
    }
}
