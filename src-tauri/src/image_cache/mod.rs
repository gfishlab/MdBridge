use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

pub struct ImageCache {
    cache_dir: PathBuf,
    max_size: u64,
    index: HashMap<String, CacheEntry>,
}

struct CacheEntry {
    path: PathBuf,
    size: u64,
    last_accessed: SystemTime,
}

impl ImageCache {
    pub fn new(max_size: Option<u64>) -> Self {
        let cache_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("mdbridge")
            .join("images");
        fs::create_dir_all(&cache_dir).unwrap();

        let mut cache = ImageCache {
            cache_dir,
            max_size: max_size.unwrap_or(500 * 1024 * 1024), // 500MB default
            index: HashMap::new(),
        };
        cache.load_index();
        cache
    }

    #[cfg(test)]
    pub fn cache_dir(&self) -> &PathBuf {
        &self.cache_dir
    }

    #[cfg(test)]
    pub fn with_cache_dir(cache_dir: PathBuf, max_size: Option<u64>) -> Self {
        fs::create_dir_all(&cache_dir).unwrap();

        let mut cache = ImageCache {
            cache_dir,
            max_size: max_size.unwrap_or(500 * 1024 * 1024),
            index: HashMap::new(),
        };
        cache.load_index();
        cache
    }

    pub fn get(&self, url: &str) -> Option<Vec<u8>> {
        let key = hash_url(url);
        if let Some(entry) = self.index.get(&key) {
            if let Ok(data) = fs::read(&entry.path) {
                return Some(data);
            }
        }
        None
    }

    pub fn put(&mut self, url: &str, data: &[u8]) -> Result<(), String> {
        let key = hash_url(url);
        let path = self.cache_dir.join(&key);

        self.evict_if_needed(data.len() as u64);

        fs::write(&path, data).map_err(|e| e.to_string())?;

        self.index.insert(
            key,
            CacheEntry {
                path,
                size: data.len() as u64,
                last_accessed: SystemTime::now(),
            },
        );
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        fs::remove_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn evict_if_needed(&mut self, new_size: u64) {
        let current_size: u64 = self.index.values().map(|e| e.size).sum();
        if current_size + new_size <= self.max_size {
            return;
        }

        let mut entries: Vec<_> = self.index.iter().collect();
        entries.sort_by_key(|(_, e)| e.last_accessed);

        let mut freed = 0u64;
        let needed = (current_size + new_size).saturating_sub(self.max_size);
        let mut to_remove = Vec::new();

        for (key, entry) in entries {
            if freed >= needed {
                break;
            }
            freed += entry.size;
            to_remove.push(key.clone());
        }

        for key in to_remove {
            if let Some(entry) = self.index.remove(&key) {
                let _ = fs::remove_file(entry.path);
            }
        }
    }

    fn load_index(&mut self) {
        if let Ok(entries) = fs::read_dir(&self.cache_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let key = path.file_name().unwrap().to_string_lossy().to_string();
                    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    let last_accessed = fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .unwrap_or(SystemTime::now());
                    self.index.insert(
                        key,
                        CacheEntry {
                            path,
                            size,
                            last_accessed,
                        },
                    );
                }
            }
        }
    }
}

pub fn hash_url(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_CACHE_ID: AtomicUsize = AtomicUsize::new(0);

    fn test_cache(max_size: Option<u64>) -> ImageCache {
        let id = NEXT_CACHE_ID.fetch_add(1, Ordering::SeqCst);
        let cache_dir =
            std::env::temp_dir().join(format!("mdbridge-test-cache-{}-{id}", std::process::id()));
        let _ = fs::remove_dir_all(&cache_dir);
        ImageCache::with_cache_dir(cache_dir, max_size)
    }

    #[test]
    fn test_cache_directory_creation() {
        let cache = test_cache(Some(1024 * 1024));
        assert!(cache.cache_dir().exists());
        cache.clear().unwrap();
    }

    #[test]
    fn test_hash_url() {
        let hash = hash_url("https://example.com/img.png");
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_cache_hit() {
        let mut cache = test_cache(Some(1024 * 1024));
        let url = "https://example.com/test.png";
        let data = b"fake image data";

        assert!(cache.get(url).is_none());

        cache.put(url, data).unwrap();

        let cached = cache.get(url);
        assert!(cached.is_some());
        assert_eq!(cached.unwrap(), data);

        cache.clear().unwrap();
    }

    #[test]
    fn test_clear_cache() {
        let mut cache = test_cache(Some(1024 * 1024));
        cache.put("x", b"data").unwrap();
        cache.clear().unwrap();
        assert!(cache.get("x").is_none());
    }
}
