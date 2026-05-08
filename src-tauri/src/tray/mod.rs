pub mod menu;

use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ICON_PNG: &[u8] = include_bytes!("../../icons/tray-icon.png");

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
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
                show_main_window(app);
            }
        })
        .build(app)?;

    Ok(())
}
