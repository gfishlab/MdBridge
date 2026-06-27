mod clipboard;
mod commands;
mod config;
mod converter;
mod git_integration;
mod image_cache;
mod tray;
mod updater;

#[cfg(test)]
pub mod test_utils;

use commands::AppState;
use config::AppConfig;
use image_cache::ImageCache;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    let config = AppConfig::load();
    let cache_size = Some(config.image_cache_size_mb * 1024 * 1024);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config: Mutex::new(config),
            image_cache: Mutex::new(ImageCache::new(cache_size)),
            folder_watchers: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platforms,
            commands::convert_and_copy,
            commands::read_file,
            commands::get_git_status,
            commands::get_git_branches,
            commands::get_git_file_history,
            commands::get_git_commit_graph,
            commands::get_git_file_diff,
            commands::restore_git_file_revision,
            commands::commit_git_file,
            commands::pull_git_repository,
            commands::push_git_repository,
            commands::get_git_conflicts,
            commands::resolve_git_conflict,
            commands::open_new_window,
            commands::open_file_in_new_window,
            commands::open_folder_in_new_window,
            commands::write_file,
            commands::delete_file,
            commands::read_folder,
            commands::watch_folder,
            commands::unwatch_folder,
            commands::get_config,
            commands::update_config,
            commands::clear_image_cache,
            commands::check_for_updates,
            commands::install_update,
            commands::get_app_version,
            commands::open_release_page,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // The main window is the tray entry point, so closing it keeps
                // the app alive. Extra document windows should close normally
                // so users can freely open and discard multiple MD windows.
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                } else {
                    let state = window.state::<AppState>();
                    let mut folder_watchers = state.folder_watchers.lock().unwrap();
                    folder_watchers.remove(window.label());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            match _event {
                tauri::RunEvent::Reopen { .. } => {
                    tray::restore_main_window(_app);
                }
                // Fired when the user opens a file via Finder double-click or
                // "Open With > MDBridge". Without this, the OS-provided paths
                // were dropped and the app only showed the blank default doc.
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            if let Err(err) = commands::open_path_in_new_window(_app.clone(), &path)
                            {
                                eprintln!("打开文件失败 {}: {}", path.display(), err);
                            }
                        }
                    }
                }
                _ => {}
            }
        })
}
