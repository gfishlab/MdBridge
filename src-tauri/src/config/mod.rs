use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub image_cache_size_mb: u64,
    pub default_platform: String,
    pub check_updates_on_startup: bool,
    pub recent_files: Vec<String>,
    pub recent_folders: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            image_cache_size_mb: 500,
            default_platform: "wechat".into(),
            check_updates_on_startup: true,
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
        }
    }
}

impl AppConfig {
    pub fn load() -> Self {
        let path = config_path();
        if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            let config = AppConfig::default();
            config.save();
            config
        }
    }

    pub fn save(&self) {
        let path = config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&path, serde_json::to_string_pretty(self).unwrap()).ok();
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mdbridge")
        .join("config.json")
}
