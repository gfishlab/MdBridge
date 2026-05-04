use crate::clipboard;
use crate::config::AppConfig;
use crate::converter::ast::{extract_image_urls, parse_markdown};
use crate::converter::platforms;
use crate::image_cache::ImageCache;
use comrak::Arena;
use serde::Serialize;
use std::fs;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub image_cache: Mutex<ImageCache>,
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
        PlatformInfo { name: "wechat".into(), display_name: "微信公众号".into(), supports_external_images: true },
        PlatformInfo { name: "bilibili".into(), display_name: "B站专栏".into(), supports_external_images: false },
        PlatformInfo { name: "csdn".into(), display_name: "CSDN".into(), supports_external_images: true },
        PlatformInfo { name: "douyin".into(), display_name: "抖音/小红书".into(), supports_external_images: false },
        PlatformInfo { name: "twitter".into(), display_name: "推特".into(), supports_external_images: false },
        PlatformInfo { name: "zhihu".into(), display_name: "知乎".into(), supports_external_images: true },
        PlatformInfo { name: "juejin".into(), display_name: "掘金".into(), supports_external_images: true },
    ]
}

#[tauri::command]
pub async fn convert_and_copy(
    markdown: String,
    platform: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Do all AST processing first, then drop arena before async
    let (html, needs_embed, image_urls) = {
        let arena = Arena::new();
        let doc = parse_markdown(&arena, &markdown);

        let converter = platforms::get_converter_by_name(&platform)
            .ok_or_else(|| format!("Unknown platform: {}", platform))?;

        let html = converter.convert(doc);
        let needs_embed = !converter.supports_external_images();
        let image_urls = if needs_embed { extract_image_urls(doc) } else { vec![] };

        (html, needs_embed, image_urls)
    };

    if needs_embed {
        let mut final_html = html;

        for url in &image_urls {
            let cached = {
                let cache = state.image_cache.lock().unwrap();
                cache.get(url)
            };

            let image_data = if let Some(data) = cached {
                data
            } else {
                match reqwest::get(url).await {
                    Ok(resp) => {
                        if let Ok(bytes) = resp.bytes().await {
                            let data = bytes.to_vec();
                            let mut cache = state.image_cache.lock().unwrap();
                            let _ = cache.put(url, &data);
                            data
                        } else {
                            continue;
                        }
                    }
                    Err(_) => continue,
                }
            };

            let base64 = base64_encode(&image_data);
            let mime = detect_mime(url);
            let data_url = format!("data:{};base64,{}", mime, base64);
            final_html = final_html.replace(url, &data_url);
        }

        clipboard::copy_html(&final_html)?;
    } else {
        clipboard::copy_html(&html)?;
    }

    let mut config = state.config.lock().unwrap();
    config.default_platform = platform;
    config.save();

    Ok("已复制到剪贴板".into())
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
pub fn read_folder(path: String) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    read_folder_recursive(&path, &mut files)?;
    Ok(files)
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
        config.default_platform = platform.to_string();
    }
    if let Some(check) = updates.get("check_updates_on_startup").and_then(|v| v.as_bool()) {
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

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn detect_mime(url: &str) -> &str {
    if url.ends_with(".png") { "image/png" }
    else if url.ends_with(".gif") { "image/gif" }
    else if url.ends_with(".webp") { "image/webp" }
    else { "image/jpeg" }
}
