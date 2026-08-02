use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub image_cache_size_mb: u64,
    pub default_platform: String,
    pub check_updates_on_startup: bool,
    #[serde(default = "default_theme_preference")]
    pub theme_preference: String,
    #[serde(default = "default_text_style")]
    pub text_style: String,
    #[serde(default = "default_image_import_mode")]
    pub image_import_mode: String,
    #[serde(default)]
    pub image_custom_directory: String,
    #[serde(default = "default_picgo_server_url")]
    pub picgo_server_url: String,
    #[serde(default = "default_picgo_cli_command")]
    pub picgo_cli_command: String,
    #[serde(default)]
    pub picgo_cli_config_path: String,
    #[serde(default = "default_image_alt_text_mode")]
    pub image_alt_text_mode: String,
    #[serde(default)]
    pub image_alt_text_custom: String,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            image_cache_size_mb: 500,
            default_platform: "wechat".into(),
            check_updates_on_startup: true,
            theme_preference: default_theme_preference(),
            text_style: default_text_style(),
            image_import_mode: default_image_import_mode(),
            image_custom_directory: String::new(),
            picgo_server_url: default_picgo_server_url(),
            picgo_cli_command: default_picgo_cli_command(),
            picgo_cli_config_path: String::new(),
            image_alt_text_mode: default_image_alt_text_mode(),
            image_alt_text_custom: String::new(),
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
        }
    }
}

impl AppConfig {
    pub fn load() -> Self {
        let path = config_path();
        let mut config = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            let config = AppConfig::default();
            config.save();
            config
        };

        if config.default_platform == "douyin" {
            config.default_platform = "wechat".into();
            config.save();
        }

        if !is_supported_theme(&config.theme_preference) {
            config.theme_preference = default_theme_preference();
            config.save();
        }

        if !is_supported_text_style(&config.text_style) {
            config.text_style = default_text_style();
            config.save();
        }

        if config.image_import_mode == "picgo" {
            config.image_import_mode = "picgo-server".into();
            config.save();
        } else if !is_supported_image_import_mode(&config.image_import_mode) {
            config.image_import_mode = default_image_import_mode();
            config.save();
        }

        if config.picgo_server_url.trim().is_empty() {
            config.picgo_server_url = default_picgo_server_url();
            config.save();
        }

        if config.picgo_cli_command.trim().is_empty() {
            config.picgo_cli_command = default_picgo_cli_command();
            config.save();
        }

        if !is_supported_image_alt_text_mode(&config.image_alt_text_mode) {
            config.image_alt_text_mode = default_image_alt_text_mode();
            config.save();
        }

        config
    }

    pub fn save(&self) {
        let path = config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&path, serde_json::to_string_pretty(self).unwrap()).ok();
    }
}

fn default_theme_preference() -> String {
    "system".into()
}

fn default_text_style() -> String {
    "standard".into()
}

pub fn default_image_import_mode() -> String {
    "absolute".into()
}

pub fn default_picgo_server_url() -> String {
    "http://127.0.0.1:36677/upload".into()
}

pub fn default_picgo_cli_command() -> String {
    "picgo".into()
}

pub fn default_image_alt_text_mode() -> String {
    "filename".into()
}

pub fn is_supported_theme(value: &str) -> bool {
    matches!(
        value,
        "system" | "light" | "dark" | "sepia" | "solarized" | "mint" | "rose"
    )
}

pub fn is_supported_text_style(value: &str) -> bool {
    matches!(value, "compact" | "standard" | "comfortable" | "large")
}

pub fn is_supported_image_import_mode(value: &str) -> bool {
    matches!(
        value,
        "absolute" | "relative" | "custom" | "picgo-server" | "picgo-cli"
    )
}

pub fn is_supported_image_alt_text_mode(value: &str) -> bool {
    matches!(value, "none" | "filename" | "custom")
}

#[cfg(test)]
mod tests {
    use super::is_supported_image_import_mode;

    #[test]
    fn accepts_both_picgo_transport_modes() {
        assert!(is_supported_image_import_mode("picgo-server"));
        assert!(is_supported_image_import_mode("picgo-cli"));
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mdbridge")
        .join("config.json")
}
