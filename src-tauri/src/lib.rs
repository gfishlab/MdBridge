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
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// 进程启动时刻（Unix 秒），用于区分「文件启动」与「应用已运行后追加打开」。
/// macOS 通过 "Open With" 启动时，`RunEvent::Opened` 会在启动后毫秒级触发；
/// 若 Opened 在进程启动 `FILE_LAUNCH_WINDOW_SECS` 秒后才触发，则认为是已运行
/// 应用收到新文件请求，此时不应隐藏用户正在使用的 main 窗口。
const FILE_LAUNCH_WINDOW_SECS: u64 = 3;
static LAUNCH_TIME_SECS: AtomicU64 = AtomicU64::new(0);

pub fn run() {
    let launch_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    LAUNCH_TIME_SECS.store(launch_time, Ordering::Relaxed);

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
                    // 启动后短时间内的 Opened 视为「文件启动」：Tauri 此时已按
                    // tauri.conf.json 静态创建了可见的 main 窗口，若不隐藏会出现
                    // 空白 main 与 doc 窗口并存的「双窗口」问题。
                    // 启动 FILE_LAUNCH_WINDOW_SECS 秒后的 Opened 视为「已运行应用
                    // 收到新文件请求」，此时应保留用户正在使用的 main 窗口。
                    let is_file_launch = {
                        let launch = LAUNCH_TIME_SECS.load(Ordering::Relaxed);
                        launch > 0
                            && now_secs().saturating_sub(launch) <= FILE_LAUNCH_WINDOW_SECS
                    };
                    if is_file_launch && !urls.is_empty() {
                        if let Some(window) = _app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
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

/// 当前 Unix 秒数。用于在 `RunEvent::Opened` 中判断是否处于文件启动窗口期。
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
