use crate::clipboard;
use crate::config::{
    is_supported_image_alt_text_mode, is_supported_image_import_mode, is_supported_text_style,
    is_supported_theme, AppConfig,
};
use crate::converter::ast::{extract_image_urls, parse_markdown};
use crate::converter::platforms;
use crate::image_cache::ImageCache;
use crate::image_import::{self, ImageImportResult};
use crate::tray;
use crate::updater;
use comrak::Arena;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::{Child, Command};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static DOCUMENT_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub image_cache: Mutex<ImageCache>,
    pub folder_watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    pub picgo_server_process: Mutex<Option<Child>>,
}

#[derive(Serialize)]
pub struct PlatformInfo {
    pub name: String,
    pub display_name: String,
    pub supports_external_images: bool,
}

#[tauri::command]
pub fn get_platforms() -> Vec<PlatformInfo> {
    vec![
        PlatformInfo {
            name: "wechat".into(),
            display_name: "微信公众号".into(),
            supports_external_images: true,
        },
        PlatformInfo {
            name: "bilibili".into(),
            display_name: "B站专栏".into(),
            supports_external_images: false,
        },
        PlatformInfo {
            name: "csdn".into(),
            display_name: "CSDN".into(),
            supports_external_images: false,
        },
        PlatformInfo {
            name: "twitter".into(),
            display_name: "推特".into(),
            supports_external_images: false,
        },
        PlatformInfo {
            name: "zhihu".into(),
            display_name: "知乎".into(),
            supports_external_images: true,
        },
        PlatformInfo {
            name: "juejin".into(),
            display_name: "掘金".into(),
            supports_external_images: true,
        },
    ]
}

#[tauri::command]
pub async fn convert_and_copy(
    markdown: String,
    platform: String,
    document_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let md_text = markdown.clone();
    let (html, needs_embed, image_urls) = {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, &markdown);

        let converter = platforms::get_converter_by_name(&platform)
            .ok_or_else(|| format!("Unknown platform: {}", platform))?;

        let html = converter.convert(doc);
        let needs_embed = !converter.supports_external_images();
        let image_urls = if needs_embed {
            extract_image_urls(doc)
        } else {
            vec![]
        };

        (html, needs_embed, image_urls)
    };

    if needs_embed {
        let mut final_html = html;
        let mut embed_errors: Vec<String> = Vec::new();

        for url in &image_urls {
            let image_data =
                match load_cached_or_read_image(url, document_path.as_deref(), &state).await {
                    Ok(data) => data,
                    Err(e) => {
                        embed_errors.push(format!("{}: {}", url, e));
                        continue;
                    }
                };

            let base64 = base64_encode(&image_data);
            let mime = detect_mime(url, &image_data);
            let data_url = format!("data:{};base64,{}", mime, base64);
            final_html = final_html.replace(url, &data_url);
        }

        clipboard::copy_rich_text(&final_html, &md_text)?;

        let mut config = state.config.lock().unwrap();
        config.default_platform = platform;
        config.save();

        if embed_errors.is_empty() {
            Ok("已复制到剪贴板".into())
        } else {
            Ok(format!(
                "已复制到剪贴板（{}张图片内嵌失败: {}）",
                embed_errors.len(),
                embed_errors.join("; ")
            ))
        }
    } else {
        clipboard::copy_rich_text(&html, &markdown)?;

        let mut config = state.config.lock().unwrap();
        config.default_platform = platform;
        config.save();

        Ok("已复制到剪贴板".into())
    }
}

#[tauri::command]
pub fn read_file(path: String, app: AppHandle) -> Result<String, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    allow_document_asset_directory(&app, Path::new(&path))?;
    Ok(content)
}

#[tauri::command]
pub async fn open_new_window(app: AppHandle) -> Result<(), String> {
    open_document_window(app, None, None)
}

#[tauri::command]
pub async fn open_file_in_new_window(path: String, app: AppHandle) -> Result<(), String> {
    open_file_window(app, Path::new(&path))
}

#[tauri::command]
pub async fn open_folder_in_new_window(path: String, app: AppHandle) -> Result<(), String> {
    open_folder_window(app, Path::new(&path))
}

/// Opens an OS "Open With" / double-click target. Markdown files load into a
/// new document window, folders open as a workspace. Used by the macOS file
/// association flow (see `RunEvent::Opened` in `lib.rs`).
#[cfg(target_os = "macos")]
pub fn open_path_in_new_window(app: AppHandle, path: &Path) -> Result<(), String> {
    if path.is_dir() {
        open_folder_window(app, path)
    } else {
        open_file_window(app, path)
    }
}

fn open_file_window(app: AppHandle, file_path: &Path) -> Result<(), String> {
    if !file_path.is_file() {
        return Err("只能在新窗口打开已存在的文件".into());
    }
    if !file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
    {
        return Err("只能在新窗口打开 .md 文件".into());
    }

    let canonical_path = file_path.canonicalize().map_err(|e| e.to_string())?;
    let title = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("{} - MDBridge", name))
        .unwrap_or_else(|| "MDBridge".into());

    open_document_window(
        app,
        Some(("file", canonical_path.to_string_lossy().as_ref())),
        Some(title),
    )
}

fn open_folder_window(app: AppHandle, folder_path: &Path) -> Result<(), String> {
    if !folder_path.is_dir() {
        return Err("只能在新窗口打开已存在的文件夹".into());
    }

    let canonical_path = folder_path.canonicalize().map_err(|e| e.to_string())?;
    let title = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("{} - MDBridge", name))
        .unwrap_or_else(|| "MDBridge".into());

    open_document_window(
        app,
        Some(("folder", canonical_path.to_string_lossy().as_ref())),
        Some(title),
    )
}

fn open_document_window(
    app: AppHandle,
    launch_param: Option<(&str, &str)>,
    title: Option<String>,
) -> Result<(), String> {
    // Each MDBridge window owns independent React state. Optional launch
    // parameters only seed the initial file or folder and do not couple window
    // state, so future platform integrations can add their own launch flows.
    let url = if let Some((key, value)) = launch_param {
        let encoded_path = utf8_percent_encode(value, NON_ALPHANUMERIC).to_string();
        WebviewUrl::App(format!("index.html?{}={}", key, encoded_path).into())
    } else {
        WebviewUrl::App("index.html".into())
    };

    let window = WebviewWindowBuilder::new(&app, new_document_window_label(), url)
        .title(title.unwrap_or_else(|| "MDBridge".into()))
        .inner_size(1200.0, 800.0)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

    tray::restore_window(&window);
    Ok(())
}

fn new_document_window_label() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let sequence = DOCUMENT_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("doc-{}-{}-{}", std::process::id(), millis, sequence)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    if !path.ends_with(".md") {
        return Err("只能删除 .md 文件".into());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_folder(path: String) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    read_folder_recursive(&path, &mut files)?;
    Ok(files)
}

#[derive(Clone, Serialize)]
pub struct FileSystemChange {
    pub root_path: String,
    pub paths: Vec<String>,
    pub kind: String,
}

#[tauri::command]
pub fn watch_folder(
    path: String,
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let folder_path = Path::new(&path);
    if !folder_path.is_dir() {
        return Err("监听路径必须是文件夹".into());
    }

    let root_path = path.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                let paths = event
                    .paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect::<Vec<_>>();

                let _ = app.emit(
                    "file-system-changed",
                    FileSystemChange {
                        root_path: root_path.clone(),
                        paths,
                        kind: format!("{:?}", event.kind),
                    },
                );
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(folder_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut current_watchers = state.folder_watchers.lock().unwrap();
    current_watchers.insert(window.label().to_string(), watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_folder(window: WebviewWindow, state: State<'_, AppState>) {
    let mut current_watchers = state.folder_watchers.lock().unwrap();
    current_watchers.remove(window.label());
}

#[derive(Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileInfo>>,
}

fn read_folder_recursive(path: &str, files: &mut Vec<FileInfo>) -> Result<(), String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path().to_string_lossy().to_string();

        if metadata.is_dir() {
            let mut children = Vec::new();
            read_folder_recursive(&entry_path, &mut children)?;
            files.push(FileInfo {
                name,
                path: entry_path,
                is_dir: true,
                children: Some(children),
            });
        } else if name.ends_with(".md") {
            files.push(FileInfo {
                name,
                path: entry_path,
                is_dir: false,
                children: None,
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn update_config(
    updates: serde_json::Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    if let Some(cache_size) = updates.get("image_cache_size_mb").and_then(|v| v.as_u64()) {
        config.image_cache_size_mb = cache_size;
    }
    if let Some(platform) = updates.get("default_platform").and_then(|v| v.as_str()) {
        config.default_platform = if platform == "douyin" {
            "wechat".into()
        } else {
            platform.to_string()
        };
    }
    if let Some(check) = updates
        .get("check_updates_on_startup")
        .and_then(|v| v.as_bool())
    {
        config.check_updates_on_startup = check;
    }
    if let Some(theme) = updates.get("theme_preference").and_then(|v| v.as_str()) {
        if is_supported_theme(theme) {
            config.theme_preference = theme.to_string();
        }
    }
    if let Some(text_style) = updates.get("text_style").and_then(|v| v.as_str()) {
        if is_supported_text_style(text_style) {
            config.text_style = text_style.to_string();
        }
    }
    if let Some(mode) = updates.get("image_import_mode").and_then(|v| v.as_str()) {
        if is_supported_image_import_mode(mode) {
            config.image_import_mode = mode.to_string();
        }
    }
    if let Some(directory) = updates
        .get("image_custom_directory")
        .and_then(|v| v.as_str())
    {
        config.image_custom_directory = directory.trim().to_string();
    }
    if let Some(url) = updates.get("picgo_server_url").and_then(|v| v.as_str()) {
        if !url.trim().is_empty() {
            config.picgo_server_url = url.trim().to_string();
        }
    }
    if let Some(command) = updates.get("picgo_cli_command").and_then(|v| v.as_str()) {
        if !command.trim().is_empty() {
            config.picgo_cli_command = command.trim().to_string();
        }
    }
    if let Some(path) = updates
        .get("picgo_cli_config_path")
        .and_then(|v| v.as_str())
    {
        config.picgo_cli_config_path = path.trim().to_string();
    }
    if let Some(mode) = updates.get("image_alt_text_mode").and_then(|v| v.as_str()) {
        if is_supported_image_alt_text_mode(mode) {
            config.image_alt_text_mode = mode.to_string();
        }
    }
    if let Some(text) = updates
        .get("image_alt_text_custom")
        .and_then(|v| v.as_str())
    {
        config.image_alt_text_custom = text.to_string();
    }
    if let Some(recent_files) = updates.get("recent_files").and_then(|v| v.as_array()) {
        config.recent_files = recent_files
            .iter()
            .filter_map(|value| value.as_str().map(ToString::to_string))
            .collect();
    }
    if let Some(recent_folders) = updates.get("recent_folders").and_then(|v| v.as_array()) {
        config.recent_folders = recent_folders
            .iter()
            .filter_map(|value| value.as_str().map(ToString::to_string))
            .collect();
    }
    config.save();
    let updated_config = config.clone();
    drop(config);
    let _ = app.emit("config-updated", updated_config);
    Ok(())
}

#[tauri::command]
pub fn clear_image_cache(state: State<'_, AppState>) -> Result<(), String> {
    let cache = state.image_cache.lock().unwrap();
    cache.clear()
}

#[tauri::command]
pub async fn import_pasted_image(
    data_base64: String,
    mime_type: String,
    file_name: Option<String>,
    document_path: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ImageImportResult, String> {
    let config = state.config.lock().unwrap().clone();
    let result = image_import::import_pasted_image(
        &data_base64,
        &mime_type,
        file_name.as_deref(),
        document_path.as_deref(),
        &config,
    )
    .await?;

    if !is_http_url(&result.reference) {
        let path = resolve_local_image_path(&result.reference, document_path.as_deref())?;
        allow_image_asset_file(&app, &path)?;
    }

    Ok(result)
}

#[tauri::command]
pub fn format_image_link(
    url: String,
    state: State<'_, AppState>,
) -> Result<ImageImportResult, String> {
    let config = state.config.lock().unwrap().clone();
    image_import::format_image_link(&url, &config)
}

#[tauri::command]
pub async fn test_picgo_upload(
    mode: String,
    server_url: Option<String>,
    cli_command: Option<String>,
    cli_config_path: Option<String>,
) -> Result<String, String> {
    image_import::test_picgo_upload(
        &mode,
        server_url.as_deref(),
        cli_command.as_deref(),
        cli_config_path.as_deref(),
    )
    .await
}

#[tauri::command]
pub fn get_picgo_cli_config_source(
    cli_config_path: Option<String>,
) -> Result<image_import::PicgoCliConfigSource, String> {
    image_import::picgo_cli_config_source(cli_config_path.as_deref())
}

#[tauri::command]
pub async fn install_picgo_cli() -> Result<String, String> {
    let output = tokio::task::spawn_blocking(|| {
        Command::new("npm")
            .args(["install", "-g", "picgo"])
            .output()
    })
    .await
    .map_err(|err| format!("无法启动 npm: {err}"))?
    .map_err(|err| format!("无法启动 npm: {err}"))?;
    if output.status.success() {
        Ok("PicGo CLI 安装完成".into())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr);
        Err(format!("PicGo CLI 安装失败: {}", detail.trim()))
    }
}

#[tauri::command]
pub fn start_picgo_server(
    server_url: String,
    cli_command: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&server_url).map_err(|_| "PicGo Server 地址无效")?;
    let host = url.host_str().ok_or("PicGo Server 地址缺少主机")?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err("只能启动本机 PicGo Server".into());
    }
    let port = url
        .port_or_known_default()
        .ok_or("PicGo Server 地址缺少端口")?;
    let command = cli_command.trim();
    if command.is_empty() {
        return Err("PicGo CLI 命令为空".into());
    }

    let child = Command::new(command)
        .args(["server", "-p", &port.to_string(), "-h", host])
        .spawn()
        .map_err(|err| format!("无法启动 PicGo Server: {err}"))?;
    let mut managed = state.picgo_server_process.lock().unwrap();
    if let Some(mut existing) = managed.replace(child) {
        let _ = existing.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn open_picgo_install_guide() -> Result<(), String> {
    const GUIDE_URL: &str = "https://picgo.github.io/PicGo-Core-Doc/zh/guide/";
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("start").arg("");
        cmd
    };
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");

    command
        .arg(GUIDE_URL)
        .spawn()
        .map_err(|err| format!("无法打开 PicGo 安装教程: {err}"))?;
    Ok(())
}

pub fn stop_managed_picgo_server(app: &AppHandle) {
    let state = app.state::<AppState>();
    let child = state.picgo_server_process.lock().unwrap().take();
    if let Some(mut child) = child {
        let _ = child.kill();
    }
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<bool, String> {
    updater::check_for_updates(app).await
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    updater::install_update(app).await
}

#[tauri::command]
pub fn get_app_version() -> String {
    updater::current_version()
}

#[tauri::command]
pub fn open_release_page(url: String) -> Result<(), String> {
    updater::open_release_page(url)
}

async fn load_cached_or_read_image(
    reference: &str,
    document_path: Option<&str>,
    state: &State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    if !is_http_url(reference) {
        let path = resolve_local_image_path(reference, document_path)?;
        let data =
            fs::read(&path).map_err(|e| format!("无法读取本地图片 {}: {}", path.display(), e))?;
        if data.is_empty() {
            return Err(format!("本地图片为空: {}", path.display()));
        }
        return Ok(data);
    }

    let cached = {
        let cache = state.image_cache.lock().unwrap();
        cache.get(reference)
    };

    if let Some(data) = cached {
        return Ok(data);
    }

    let resp = reqwest::get(reference)
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }

    let data = resp
        .bytes()
        .await
        .map_err(|e| format!("读取失败: {}", e))?
        .to_vec();
    if data.len() < 100 {
        return Err(format!("文件过小({}字节)", data.len()));
    }

    let mut cache = state.image_cache.lock().unwrap();
    let _ = cache.put(reference, &data);
    Ok(data)
}

fn resolve_local_image_path(
    reference: &str,
    document_path: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let path = Path::new(reference);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }

    let document_path = document_path
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| format!("相对图片路径需要先保存当前 Markdown 文档: {reference}"))?;
    let document = Path::new(document_path);
    let directory = document
        .parent()
        .ok_or_else(|| "无法确定当前 Markdown 文档所在目录".to_string())?;
    Ok(directory.join(path))
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn allow_document_asset_directory(app: &AppHandle, document: &Path) -> Result<(), String> {
    let directory = document
        .parent()
        .ok_or_else(|| "无法确定当前 Markdown 文档所在目录".to_string())?;
    app.asset_protocol_scope()
        .allow_directory(directory, true)
        .map_err(|e| format!("无法授权文档图片预览: {e}"))
}

fn allow_image_asset_file(app: &AppHandle, image: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(image)
        .map_err(|e| format!("无法授权图片预览: {e}"))
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn detect_mime(url: &str, data: &[u8]) -> &'static str {
    if data.len() >= 8 {
        if data[0..4] == [0x89, 0x50, 0x4E, 0x47] {
            return "image/png";
        }
        if data[0..3] == [0xFF, 0xD8, 0xFF] {
            return "image/jpeg";
        }
        if data[0..4] == [0x47, 0x49, 0x46, 0x38] {
            return "image/gif";
        }
        if data[0..4] == [0x52, 0x49, 0x46, 0x46] && data.len() >= 12 && &data[8..12] == b"WEBP" {
            return "image/webp";
        }
    }
    if url.ends_with(".png") {
        "image/png"
    } else if url.ends_with(".gif") {
        "image/gif"
    } else if url.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_local_image_path;
    use std::path::PathBuf;

    #[test]
    fn resolves_relative_image_against_document_directory() {
        assert_eq!(
            resolve_local_image_path("assets/cover image.png", Some("/tmp/posts/article.md"))
                .unwrap(),
            PathBuf::from("/tmp/posts/assets/cover image.png")
        );
    }

    #[test]
    fn rejects_relative_image_without_saved_document() {
        let error = resolve_local_image_path("assets/cover.png", None).unwrap_err();
        assert!(error.contains("需要先保存当前 Markdown 文档"));
    }
}
