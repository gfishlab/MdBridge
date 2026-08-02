use crate::config::AppConfig;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static IMAGE_COUNTER: AtomicU64 = AtomicU64::new(0);
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ImageImportResult {
    pub markdown: String,
    pub reference: String,
}

#[derive(Debug, Serialize)]
pub struct PicgoCliConfigSource {
    pub source: String,
    pub path: Option<String>,
}

pub async fn import_pasted_image(
    data_base64: &str,
    mime_type: &str,
    file_name: Option<&str>,
    document_path: Option<&str>,
    config: &AppConfig,
) -> Result<ImageImportResult, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|_| "无法读取剪贴板图片数据".to_string())?;

    if data.is_empty() {
        return Err("剪贴板图片为空".into());
    }
    validate_image_size(data.len())?;

    let display_name = file_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("image");

    let reference = match config.image_import_mode.as_str() {
        "absolute" => save_local_image(&data, mime_type, None, config)?,
        "relative" => {
            let document_path = document_path
                .filter(|path| !path.trim().is_empty())
                .ok_or_else(|| "相对路径需要先保存当前 Markdown 文档".to_string())?;
            save_local_image(&data, mime_type, Some(document_path), config)?
        }
        "custom" => {
            if config.image_custom_directory.trim().is_empty() {
                return Err("请先在设置中选择自定义图片目录".into());
            }
            save_to_directory(
                &data,
                mime_type,
                Path::new(&config.image_custom_directory),
                None,
            )?
        }
        "picgo-server" | "picgo" => upload_to_picgo(&data, mime_type, display_name, config).await?,
        "picgo-cli" => upload_to_picgo_cli(&data, mime_type, config).await?,
        _ => return Err("图片导入方式无效，请在设置中重新选择".into()),
    };

    Ok(ImageImportResult {
        markdown: markdown_image(&reference, display_name, config),
        reference,
    })
}

pub fn format_image_link(url: &str, config: &AppConfig) -> Result<ImageImportResult, String> {
    let url = url.trim();
    if !is_http_url(url) {
        return Err("仅支持 HTTP(S) 图片链接".into());
    }

    Ok(ImageImportResult {
        markdown: markdown_image(url, &name_from_url(url), config),
        reference: url.to_string(),
    })
}

fn save_local_image(
    data: &[u8],
    mime_type: &str,
    document_path: Option<&str>,
    _config: &AppConfig,
) -> Result<String, String> {
    match document_path {
        Some(document_path) => {
            let document = Path::new(document_path);
            let parent = document
                .parent()
                .ok_or_else(|| "无法确定当前文档所在目录".to_string())?;
            save_to_directory(data, mime_type, &parent.join("assets"), Some("assets"))
        }
        None => save_to_directory(data, mime_type, &default_image_directory(), None),
    }
}

fn save_to_directory(
    data: &[u8],
    mime_type: &str,
    directory: &Path,
    relative_directory: Option<&str>,
) -> Result<String, String> {
    fs::create_dir_all(directory).map_err(|err| format!("无法创建图片目录: {err}"))?;
    let file_name = generated_file_name(mime_type);
    let target = directory.join(&file_name);
    fs::write(&target, data).map_err(|err| format!("无法保存图片: {err}"))?;

    if let Some(relative_directory) = relative_directory {
        Ok(format!("{relative_directory}/{file_name}"))
    } else {
        Ok(target.to_string_lossy().replace('\\', "/"))
    }
}

async fn upload_to_picgo(
    data: &[u8],
    mime_type: &str,
    file_name: &str,
    config: &AppConfig,
) -> Result<String, String> {
    let url = config.picgo_server_url.trim();
    if !is_http_url(url) {
        return Err("PicGo Server 地址必须是 HTTP(S) 地址".into());
    }

    let upload_name = if Path::new(file_name).extension().is_some() {
        file_name.to_string()
    } else {
        format!("{file_name}.{}", extension_for_mime(mime_type))
    };
    let part = reqwest::multipart::Part::bytes(data.to_vec())
        .file_name(upload_name)
        .mime_str(mime_type)
        .map_err(|err| format!("图片 MIME 类型无效: {err}"))?;
    let form = reqwest::multipart::Form::new().part("files", part);
    let response = reqwest::Client::new()
        .post(url)
        .multipart(form)
        .send()
        .await
        .map_err(|err| format!("无法连接 PicGo Server: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("无法读取 PicGo Server 响应: {err}"))?;

    if !status.is_success() {
        return Err(format!("PicGo Server 返回 HTTP {status}: {body}"));
    }

    let response: Value =
        serde_json::from_str(&body).map_err(|_| "PicGo Server 返回了无法识别的数据".to_string())?;
    extract_picgo_url(&response)
}

async fn upload_to_picgo_cli(
    data: &[u8],
    mime_type: &str,
    config: &AppConfig,
) -> Result<String, String> {
    let command_name = config.picgo_cli_command.trim();
    if command_name.is_empty() {
        return Err("无法启动 PicGo CLI：命令为空".into());
    }

    let temporary_path = std::env::temp_dir().join(generated_file_name(mime_type));
    fs::write(&temporary_path, data).map_err(|err| format!("无法创建 PicGo 临时图片: {err}"))?;
    let cli_config_path = picgo_cli_config_source(Some(&config.picgo_cli_config_path))?.path;
    let command_name = command_name.to_string();
    let command_path = temporary_path.clone();

    let output = tokio::task::spawn_blocking(move || {
        let mut command = Command::new(&command_name);
        if let Some(cli_config_path) = cli_config_path.as_deref() {
            command.args(["--config", cli_config_path]);
        }
        command.args(["upload", command_path.to_string_lossy().as_ref()]);
        command.output()
    })
    .await
    .map_err(|err| format!("无法启动 PicGo CLI: {err}"))?
    .map_err(|err| format!("无法启动 PicGo CLI: {err}"));

    let _ = fs::remove_file(&temporary_path);
    let output = output?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!("PicGo CLI 上传失败: {detail}"));
    }

    extract_picgo_cli_url(&format!("{stdout}\n{stderr}"))
}

pub fn picgo_cli_config_source(
    configured_path: Option<&str>,
) -> Result<PicgoCliConfigSource, String> {
    let configured_path = configured_path.unwrap_or("").trim();
    if !configured_path.is_empty() {
        let path = PathBuf::from(configured_path);
        if !path.is_file() {
            return Err(format!("自定义 PicGo 配置文件不存在: {}", path.display()));
        }
        return Ok(PicgoCliConfigSource {
            source: "custom".into(),
            path: Some(path.to_string_lossy().into_owned()),
        });
    }

    if let Some(path) = picgo_desktop_config_path().filter(|path| path.is_file()) {
        return Ok(PicgoCliConfigSource {
            source: "desktop".into(),
            path: Some(path.to_string_lossy().into_owned()),
        });
    }

    Ok(PicgoCliConfigSource {
        source: "default".into(),
        path: None,
    })
}

fn picgo_desktop_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("picgo")
                .join("data.json")
        })
    }
    #[cfg(target_os = "windows")]
    {
        dirs::config_dir().map(|directory| directory.join("picgo").join("data.json"))
    }
    #[cfg(target_os = "linux")]
    {
        dirs::config_dir().map(|directory| directory.join("picgo").join("data.json"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

#[allow(dead_code)] // Tauri command registration is generated by a macro and is opaque to this lint.
pub async fn test_picgo_upload(
    mode: &str,
    server_url: Option<&str>,
    cli_command: Option<&str>,
    cli_config_path: Option<&str>,
) -> Result<String, String> {
    let mut config = AppConfig::default();
    config.image_import_mode = mode.to_string();
    if let Some(url) = server_url {
        config.picgo_server_url = url.to_string();
    }
    if let Some(command) = cli_command {
        config.picgo_cli_command = command.to_string();
    }
    if let Some(path) = cli_config_path {
        config.picgo_cli_config_path = path.to_string();
    }

    let data = base64::engine::general_purpose::STANDARD
        .decode(ONE_PIXEL_PNG_BASE64)
        .map_err(|_| "无法生成 PicGo 测试图片".to_string())?;
    match mode {
        "picgo-server" | "picgo" => {
            upload_to_picgo(&data, "image/png", "mdbridge-test.png", &config).await
        }
        "picgo-cli" => upload_to_picgo_cli(&data, "image/png", &config).await,
        _ => Err("当前导入方式不是 PicGo 模式".into()),
    }
}

#[allow(dead_code)]
const ONE_PIXEL_PNG_BASE64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAF/gL+RN7z/gAAAABJRU5ErkJggg==";

fn extract_picgo_cli_url(output: &str) -> Result<String, String> {
    if let Some(message) = output.lines().find_map(|line| {
        line.split_once("[PicGo ERROR]:")
            .map(|(_, detail)| detail.trim().trim_start_matches("Error: ").trim())
            .filter(|detail| !detail.is_empty())
    }) {
        return Err(format!("PicGo CLI 上传失败: {message}"));
    }

    let start = [output.find("https://"), output.find("http://")]
        .into_iter()
        .flatten()
        .min();
    if let Some(start) = start {
        let remainder = &output[start..];
        let end = remainder
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, ')' | ']' | '}' | '"' | '\'' | ',' | ';')
            })
            .unwrap_or(remainder.len());
        let candidate = &remainder[..end];
        if is_http_url(candidate) {
            return Ok(candidate.to_string());
        }
    }
    Err("PicGo CLI 未输出 HTTP(S) 图片链接".into())
}

fn extract_picgo_url(response: &Value) -> Result<String, String> {
    if response.get("success").and_then(Value::as_bool) == Some(false) {
        let message = response
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("上传失败");
        return Err(format!("PicGo Server 上传失败: {message}"));
    }

    let result = response
        .get("result")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .ok_or_else(|| "PicGo Server 未返回图片链接".to_string())?;

    if !is_http_url(result) {
        return Err("PicGo Server 返回的不是 HTTP(S) 图片链接".into());
    }
    Ok(result.to_string())
}

fn markdown_image(reference: &str, source_name: &str, config: &AppConfig) -> String {
    let alt = match config.image_alt_text_mode.as_str() {
        "none" => String::new(),
        "custom" => config.image_alt_text_custom.trim().to_string(),
        _ => name_without_extension(source_name),
    };
    format!("![{}]({})", escape_alt_text(&alt), reference)
}

fn default_image_directory() -> PathBuf {
    dirs::picture_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("MDBridge")
}

fn generated_file_name(mime_type: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let counter = IMAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "image-{timestamp}-{counter}.{}",
        extension_for_mime(mime_type)
    )
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        _ => "png",
    }
}

fn name_from_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .unwrap_or("image")
        .split('?')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("image")
        .to_string()
}

fn name_without_extension(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("image")
        .to_string()
}

fn escape_alt_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn validate_image_size(size: usize) -> Result<(), String> {
    if size > MAX_IMAGE_BYTES {
        return Err("图片过大，最大支持 20 MiB".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        default_image_alt_text_mode, default_image_import_mode, default_picgo_server_url,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn config(mode: &str) -> AppConfig {
        AppConfig {
            image_cache_size_mb: 500,
            default_platform: "wechat".into(),
            check_updates_on_startup: true,
            theme_preference: "system".into(),
            text_style: "standard".into(),
            image_import_mode: mode.into(),
            image_custom_directory: String::new(),
            picgo_server_url: default_picgo_server_url(),
            picgo_cli_command: "picgo".into(),
            picgo_cli_config_path: String::new(),
            image_alt_text_mode: default_image_alt_text_mode(),
            image_alt_text_custom: String::new(),
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
        }
    }

    #[test]
    fn defaults_to_absolute_image_import() {
        assert_eq!(default_image_import_mode(), "absolute");
    }

    #[test]
    fn rejects_images_larger_than_the_limit() {
        assert_eq!(
            validate_image_size(MAX_IMAGE_BYTES + 1).unwrap_err(),
            "图片过大，最大支持 20 MiB"
        );
    }

    #[test]
    fn formats_markdown_for_all_alt_text_modes() {
        let mut settings = config("absolute");
        assert_eq!(
            markdown_image("/tmp/image.png", "image.png", &settings),
            "![image](/tmp/image.png)"
        );

        settings.image_alt_text_mode = "none".into();
        assert_eq!(
            markdown_image("/tmp/image.png", "image.png", &settings),
            "![](/tmp/image.png)"
        );

        settings.image_alt_text_mode = "custom".into();
        settings.image_alt_text_custom = "封面图".into();
        assert_eq!(
            markdown_image("/tmp/image.png", "image.png", &settings),
            "![封面图](/tmp/image.png)"
        );
    }

    #[test]
    fn reports_picgo_cli_error_output() {
        let error = extract_picgo_cli_url(
            "[PicGo ERROR]: Error: Can not find smms config!\nstack trace omitted",
        )
        .unwrap_err();

        assert_eq!(error, "PicGo CLI 上传失败: Can not find smms config!");
    }

    #[test]
    fn extracts_picgo_cli_url_from_json_output() {
        let url = extract_picgo_cli_url(
            "[PicGo SUCCESS]:\n[{\"imgUrl\":\"https://cdn.example.com/images/test.png\",\"type\":\"github\"}]",
        )
        .unwrap();

        assert_eq!(url, "https://cdn.example.com/images/test.png");
    }

    #[tokio::test]
    async fn cli_import_reports_an_unavailable_command() {
        let mut settings = config("picgo-cli");
        settings.picgo_cli_command = "/definitely/not/a/picgo-command".into();

        let error = import_pasted_image(
            &base64::engine::general_purpose::STANDARD.encode(b"png"),
            "image/png",
            Some("clipboard.png"),
            None,
            &settings,
        )
        .await
        .unwrap_err();

        assert!(error.contains("无法启动 PicGo CLI"), "{error}");
    }

    #[tokio::test]
    async fn rejects_relative_import_for_unsaved_document() {
        let error = import_pasted_image(
            &base64::engine::general_purpose::STANDARD.encode(b"png"),
            "image/png",
            Some("clipboard.png"),
            None,
            &config("relative"),
        )
        .await
        .unwrap_err();
        assert_eq!(error, "相对路径需要先保存当前 Markdown 文档");
    }

    #[test]
    fn creates_custom_directory_and_writes_image() {
        let directory = std::env::temp_dir().join(format!(
            "mdbridge-image-import-{}",
            IMAGE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let reference = save_to_directory(b"png", "image/png", &directory, None).unwrap();
        assert!(Path::new(&reference).is_file());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn validates_picgo_responses() {
        let successful =
            serde_json::json!({ "success": true, "result": ["https://img.example.com/a.png"] });
        assert_eq!(
            extract_picgo_url(&successful).unwrap(),
            "https://img.example.com/a.png"
        );

        let invalid = serde_json::json!({ "success": true, "result": ["file:///tmp/a.png"] });
        assert!(extract_picgo_url(&invalid).is_err());
    }

    #[tokio::test]
    async fn uploads_multipart_data_to_picgo_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let mut expected_length = None;

            loop {
                let read = socket.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);

                if expected_length.is_none() {
                    if let Some(header_end) =
                        request.windows(4).position(|bytes| bytes == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                (name.eq_ignore_ascii_case("content-length"))
                                    .then_some(value.trim())
                            })
                            .and_then(|value| value.parse::<usize>().ok())
                            .unwrap_or(0);
                        expected_length = Some(header_end + 4 + content_length);
                    }
                }

                if expected_length.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }

            assert!(
                String::from_utf8_lossy(&request).contains("name=\"files\""),
                "multipart body was not fully read: {}",
                String::from_utf8_lossy(&request)
            );
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 59\r\nConnection: close\r\n\r\n{\"success\":true,\"result\":[\"https://img.example.com/a.png\"]}",
                )
                .await
                .unwrap();
        });

        let mut settings = config("picgo");
        settings.picgo_server_url = format!("http://{address}/upload");
        let result = upload_to_picgo(b"png", "image/png", "clipboard.png", &settings)
            .await
            .unwrap();
        assert_eq!(result, "https://img.example.com/a.png");
        server.await.unwrap();
    }

    #[test]
    fn formats_pasted_http_image_link() {
        let result =
            format_image_link("https://img.example.com/cover.png", &config("absolute")).unwrap();
        assert_eq!(
            result.markdown,
            "![cover](https://img.example.com/cover.png)"
        );
    }
}
