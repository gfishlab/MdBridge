pub mod menu;

use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const TRAY_ICON_PNG: &[u8] = include_bytes!("../../icons/tray-icon.png");

pub fn restore_window(window: &WebviewWindow) {
    // Tauri's v2 examples use this order. It matters on macOS after updater
    // restarts because a hidden/minimized NSWindow can ignore focus until it is
    // first unminimized and shown again.
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        restore_window(&window);
        return;
    }

    // Defensive fallback for updater relaunch edge cases where the process is
    // alive but the configured main window was not recreated yet.
    if let Ok(window) = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("MDBridge")
        .inner_size(1200.0, 800.0)
        .resizable(true)
        .focused(true)
        .build()
    {
        restore_window(&window);
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let tray_menu = menu::build_tray_menu(app)?;

    // 手动解析 PNG 为 RGBA 数据
    let decoder = png::Decoder::new(std::io::Cursor::new(TRAY_ICON_PNG));
    let mut reader = decoder.read_info()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf)?;
    let icon = Image::new_owned(buf, info.width, info.height);

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&tray_menu)
        .on_menu_event(move |app, event| {
            menu::handle_tray_menu_event(app, event);
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                restore_main_window(app);
            }
        })
        .build(app)?;

    Ok(())
}
