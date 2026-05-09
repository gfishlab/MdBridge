use crate::clipboard;
use crate::config::AppConfig;
use crate::converter::ast::{extract_image_urls, parse_markdown};
use crate::converter::platforms;
use crate::image_cache::ImageCache;
use crate::updater;
use comrak::Arena;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub image_cache: Mutex<ImageCache>,
    pub folder_watcher: Mutex<Option<RecommendedWatcher>>,
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
            let image_data = match load_cached_or_download_image(url, &state).await {
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
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
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

    let mut current_watcher = state.folder_watcher.lock().unwrap();
    *current_watcher = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_folder(state: State<'_, AppState>) {
    let mut current_watcher = state.folder_watcher.lock().unwrap();
    *current_watcher = None;
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
pub fn update_config(updates: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
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
    config.save();
    Ok(())
}

#[tauri::command]
pub fn clear_image_cache(state: State<'_, AppState>) -> Result<(), String> {
    let cache = state.image_cache.lock().unwrap();
    cache.clear()
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

async fn load_cached_or_download_image(
    url: &str,
    state: &State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let cached = {
        let cache = state.image_cache.lock().unwrap();
        cache.get(url)
    };

    if let Some(data) = cached {
        return Ok(data);
    }

    let resp = reqwest::get(url)
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
    let _ = cache.put(url, &data);
    Ok(data)
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
