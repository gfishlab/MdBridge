use serde::Serialize;
use tauri::AppHandle;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: String,
}

pub async fn check_for_updates(app: AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    match update {
        Some(update) => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("update-available", UpdateInfo {
                    version: update.version.clone(),
                    body: update.body.clone().unwrap_or_default(),
                });
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        update.download_and_install(|_chunk, _total| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }

    Ok(())
}
