mod clipboard;
mod commands;
mod config;
mod converter;
mod image_cache;
mod image_import;
mod tray;
mod updater;

#[cfg(test)]
pub mod test_utils;

use commands::AppState;
use config::AppConfig;
use image_cache::ImageCache;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// 进程启动时刻（Unix 秒），用于区分「文件启动」与「应用已运行后追加打开」。
/// macOS 通过 "Open With" 启动时，`RunEvent::Opened` 会在启动后毫秒级触发；
/// 若 Opened 在进程启动 `FILE_LAUNCH_WINDOW_SECS` 秒后才触发，则认为是已运行
/// 应用收到新文件请求，此时不应隐藏用户正在使用的 main 窗口。
#[cfg(target_os = "macos")]
const FILE_LAUNCH_WINDOW_SECS: u64 = 3;
#[cfg(target_os = "macos")]
static LAUNCH_TIME_SECS: AtomicU64 = AtomicU64::new(0);

/// 是否在进程启动期收到过 `RunEvent::Opened` 文件请求。
/// macOS 的启动 odoc 事件可能在 Tauri 创建静态 main 窗口（Ready/setup）之前
/// 送达，此时 `Opened` 内无法隐藏尚不存在的 main，需要延迟到 setup 中处理。
static OPENED_AT_LAUNCH: AtomicBool = AtomicBool::new(false);

pub fn run() {
    #[cfg(target_os = "macos")]
    {
        let launch_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        LAUNCH_TIME_SECS.store(launch_time, Ordering::Relaxed);
    }

    let config = AppConfig::load();
    let cache_size = Some(config.image_cache_size_mb * 1024 * 1024);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config: Mutex::new(config),
            image_cache: Mutex::new(ImageCache::new(cache_size)),
            folder_watchers: Mutex::new(HashMap::new()),
            picgo_server_process: Mutex::new(None),
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
            commands::import_pasted_image,
            commands::format_image_link,
            commands::test_picgo_upload,
            commands::get_picgo_cli_config_source,
            commands::install_picgo_cli,
            commands::start_picgo_server,
            commands::open_picgo_install_guide,
            commands::check_for_updates,
            commands::install_update,
            commands::get_app_version,
            commands::open_release_page,
        ])
        .setup(|app| {
            // 文件启动时，macOS 的 odoc 事件先于静态 main 窗口创建送达（早于
            // setup），`Opened` 内的 hide 无从生效；main 在此创建后立即隐藏，
            // 避免与文件 doc 窗口形成「空白 main + 内容窗口」双窗口。
            if OPENED_AT_LAUNCH.load(Ordering::Relaxed) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

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
        .run(|_app, _event| match _event {
            // 点击程序坞图标：若已有可见窗口（如用户正在编辑的 doc 窗口），
            // macOS 会自动将其带到前台，此时再强制显示隐藏的 main 会造成
            // 「空白 main + 内容窗口」双窗口；仅在无任何可见窗口时才恢复
            // main（如用户关闭全部窗口后从程序坞/托盘重新唤起应用）。
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                tray::restore_main_window(_app);
            }
            // Fired when the user opens a file via Finder double-click or
            // "Open With > MDBridge". Without this, the OS-provided paths
            // were dropped and the app only showed the blank default doc.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                // 启动后短时间内的 Opened 视为「文件启动」：Tauri 此时已按
                // tauri.conf.json 静态创建了可见的 main 窗口，若不隐藏会出现
                // 空白 main 与 doc 窗口并存的「双窗口」问题。
                // 启动 FILE_LAUNCH_WINDOW_SECS 秒后的 Opened 视为「已运行应用
                // 收到新文件请求」，此时应保留用户正在使用的 main 窗口。
                let is_file_launch = {
                    let launch = LAUNCH_TIME_SECS.load(Ordering::Relaxed);
                    launch > 0 && now_secs().saturating_sub(launch) <= FILE_LAUNCH_WINDOW_SECS
                };
                if !urls.is_empty() {
                    // Opened 可能早于静态 main 窗口创建（早于 setup）送达，
                    // 此时 main 尚不存在、hide 无从生效；先记录，由 setup
                    // 在创建 main 后统一隐藏。
                    OPENED_AT_LAUNCH.store(true, Ordering::Relaxed);
                    if is_file_launch {
                        if let Some(window) = _app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Err(err) = commands::open_path_in_new_window(_app.clone(), &path) {
                            eprintln!("打开文件失败 {}: {}", path.display(), err);
                        }
                    }
                }
            }
            tauri::RunEvent::Exit => commands::stop_managed_picgo_server(_app),
            _ => {}
        })
}

/// 当前 Unix 秒数。用于在 `RunEvent::Opened` 中判断是否处于文件启动窗口期。
#[cfg(target_os = "macos")]
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
