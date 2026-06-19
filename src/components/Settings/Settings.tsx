import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  normalizeTextStylePreference,
  normalizeThemePreference,
  type TextStylePreference,
  type ThemePreference,
} from '../../preferences';

interface Config {
  image_cache_size_mb: number;
  default_platform: string;
  check_updates_on_startup: boolean;
  theme_preference: ThemePreference;
  text_style: TextStylePreference;
}

interface SettingsProps {
  onClose: () => void;
  onSaved: (config: Config) => void;
}

export function Settings({ onClose, onSaved }: SettingsProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [version, setVersion] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');

  useEffect(() => {
    invoke<Config>('get_config').then((nextConfig) => {
      setConfig({
        ...nextConfig,
        theme_preference: normalizeThemePreference(nextConfig.theme_preference),
        text_style: normalizeTextStylePreference(nextConfig.text_style),
      });
    });
    invoke<string>('get_app_version').then(setVersion);
  }, []);

  const handleSave = async () => {
    if (config) {
      await invoke('update_config', { updates: config });
      onSaved(config);
    }
  };

  const handleClearCache = async () => {
    setCacheClearing(true);
    await invoke('clear_image_cache');
    setCacheClearing(false);
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateStatus('正在检查更新...');
    try {
      const hasUpdate = await invoke<boolean>('check_for_updates');
      setUpdateStatus(hasUpdate ? '发现新版本，已弹出更新提示' : '当前已是最新版本');
    } catch (err) {
      console.error('Check updates failed:', err);
      setUpdateStatus('检查更新失败，请稍后重试');
    }
    setCheckingUpdates(false);
  };

  if (!config) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-dialog">
        <h3>设置</h3>

        <div className="settings-section">
          <h4>外观</h4>
          <div className="setting-item">
            <label>主题</label>
            <select
              value={config.theme_preference}
              onChange={(e) =>
                setConfig({
                  ...config,
                  theme_preference: normalizeThemePreference(e.target.value),
                })
              }
            >
              <option value="system">跟随系统</option>
              <option value="light">亮色</option>
              <option value="dark">深色黑色</option>
              <option value="sepia">护眼暖色</option>
              <option value="solarized">Solarized</option>
              <option value="mint">薄荷绿</option>
              <option value="rose">玫瑰粉</option>
            </select>
          </div>

          <div className="setting-item">
            <label>文字样式</label>
            <select
              value={config.text_style}
              onChange={(e) =>
                setConfig({
                  ...config,
                  text_style: normalizeTextStylePreference(e.target.value),
                })
              }
            >
              <option value="compact">紧凑</option>
              <option value="standard">标准</option>
              <option value="comfortable">舒适</option>
              <option value="large">大字</option>
            </select>
          </div>
        </div>

        <div className="setting-item">
          <label>图片缓存大小 (MB)</label>
          <input
            type="number"
            value={config.image_cache_size_mb}
            onChange={(e) =>
              setConfig({ ...config, image_cache_size_mb: Number(e.target.value) })
            }
          />
        </div>

        <div className="setting-item">
          <label>默认发布平台</label>
          <select
            value={config.default_platform}
            onChange={(e) =>
              setConfig({ ...config, default_platform: e.target.value })
            }
          >
            <option value="wechat">微信公众号</option>
            <option value="bilibili">B站专栏</option>
            <option value="csdn">CSDN</option>
            <option value="twitter">推特</option>
            <option value="zhihu">知乎</option>
            <option value="juejin">掘金</option>
          </select>
        </div>

        <div className="setting-item">
          <div className="setting-row">
            <div>
              <label>版本更新</label>
              <p className="setting-description">当前版本 v{version || '-'}</p>
            </div>
            <button onClick={handleCheckUpdates} disabled={checkingUpdates}>
              {checkingUpdates ? '检查中...' : '检查更新'}
            </button>
          </div>
          {updateStatus && <p className="setting-status">{updateStatus}</p>}
        </div>

        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={config.check_updates_on_startup}
              onChange={(e) =>
                setConfig({ ...config, check_updates_on_startup: e.target.checked })
              }
            />
            启动时检查更新
          </label>
        </div>

        <div className="setting-item">
          <button onClick={handleClearCache} disabled={cacheClearing}>
            {cacheClearing ? '清理中...' : '清除图片缓存'}
          </button>
        </div>

        <div className="settings-actions">
          <button onClick={onClose}>取消</button>
          <button onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
