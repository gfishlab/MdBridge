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

pub fn is_supported_theme(value: &str) -> bool {
    matches!(
        value,
        "system" | "light" | "dark" | "sepia" | "solarized" | "mint" | "rose"
    )
}

pub fn is_supported_text_style(value: &str) -> bool {
    matches!(value, "compact" | "standard" | "comfortable" | "large")
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mdbridge")
        .join("config.json")
}
