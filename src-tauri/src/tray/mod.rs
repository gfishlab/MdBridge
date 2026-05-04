pub mod menu;

use tauri::{
    AppHandle, Manager,
    image::Image as TauriImage,
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let tray_menu = menu::build_tray_menu(app)?;

    // 使用默认窗口图标
    let icon = app.default_window_icon().unwrap().clone();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)  // macOS Template 模式
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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
