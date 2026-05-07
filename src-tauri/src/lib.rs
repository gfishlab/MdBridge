mod clipboard;
mod commands;
mod config;
mod converter;
mod image_cache;
mod tray;
mod updater;

#[cfg(test)]
pub mod test_utils;

use commands::AppState;
use config::AppConfig;
use image_cache::ImageCache;
use std::sync::Mutex;

pub fn run() {
    let config = AppConfig::load();
    let cache_size = Some(config.image_cache_size_mb * 1024 * 1024);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config: Mutex::new(config),
            image_cache: Mutex::new(ImageCache::new(cache_size)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platforms,
            commands::convert_and_copy,
            commands::read_file,
            commands::write_file,
            commands::delete_file,
            commands::read_folder,
            commands::get_config,
            commands::update_config,
            commands::clear_image_cache,
            commands::check_for_updates,
            commands::install_update,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;

            // Auto-check for updates on startup
            let app_handle = app.handle().clone();
            let config = AppConfig::load();
            if config.check_updates_on_startup {
                tauri::async_runtime::spawn(async move {
                    let _ = updater::check_for_updates(app_handle).await;
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
