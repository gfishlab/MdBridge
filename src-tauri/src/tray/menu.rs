use tauri::{
    menu::{Menu, MenuItem},
    AppHandle,
};

pub fn build_tray_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &quit])?;
    Ok(menu)
}

pub fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "show" => {
            super::show_main_window(app);
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}
