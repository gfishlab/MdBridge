import { useState, useEffect, useRef, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
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
  image_import_mode: ImageImportMode;
  image_custom_directory: string;
  picgo_server_url: string;
  picgo_cli_command: string;
  picgo_cli_config_path: string;
  image_alt_text_mode: ImageAltTextMode;
  image_alt_text_custom: string;
}

interface PicgoCliConfigSource {
  source: 'desktop' | 'default' | 'custom';
  path: string | null;
}

type ImageImportMode = 'absolute' | 'relative' | 'custom' | 'picgo-server' | 'picgo-cli';
type ImageAltTextMode = 'none' | 'filename' | 'custom';
type ResizeDirection = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const SETTINGS_SIZE_STORAGE_KEY = 'mdbridge.settings-dialog-size';
const MIN_SETTINGS_WIDTH = 520;
const MIN_SETTINGS_HEIGHT = 560;

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
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [testingPicgo, setTestingPicgo] = useState(false);
  const [picgoStatus, setPicgoStatus] = useState('');
  const [installingPicgo, setInstallingPicgo] = useState(false);
  const [picgoCliConfigSource, setPicgoCliConfigSource] = useState<PicgoCliConfigSource | null>(null);
  const [showCustomPicgoConfig, setShowCustomPicgoConfig] = useState(false);
  const [dialogSize, setDialogSize] = useState(() => readDialogSize());
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<Config>('get_config').then((nextConfig) => {
      setConfig({
        ...nextConfig,
        theme_preference: normalizeThemePreference(nextConfig.theme_preference),
        text_style: normalizeTextStylePreference(nextConfig.text_style),
        image_import_mode: normalizeImageImportMode(nextConfig.image_import_mode),
        image_custom_directory: nextConfig.image_custom_directory ?? '',
        picgo_server_url: nextConfig.picgo_server_url || 'http://127.0.0.1:36677/upload',
        picgo_cli_command: nextConfig.picgo_cli_command || 'picgo',
        picgo_cli_config_path: nextConfig.picgo_cli_config_path ?? '',
        image_alt_text_mode: normalizeImageAltTextMode(nextConfig.image_alt_text_mode),
        image_alt_text_custom: nextConfig.image_alt_text_custom ?? '',
      });
      setShowCustomPicgoConfig(Boolean(nextConfig.picgo_cli_config_path));
    });
    invoke<string>('get_app_version').then(setVersion);
  }, []);

  useEffect(() => {
    if (!config) return;
    invoke<PicgoCliConfigSource>('get_picgo_cli_config_source', {
      cliConfigPath: config.picgo_cli_config_path || null,
    })
      .then(setPicgoCliConfigSource)
      .catch(() => setPicgoCliConfigSource(null));
  }, [config?.picgo_cli_config_path]);

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

  const handleChooseImageDirectory = async () => {
    setSelectingDirectory(true);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string' && config) {
        setConfig({ ...config, image_custom_directory: selected });
      }
    } finally {
      setSelectingDirectory(false);
    }
  };

  const handleTestPicgo = async () => {
    if (!config) return;
    setTestingPicgo(true);
    setPicgoStatus('正在上传测试图片...');
    try {
      const url = await invoke<string>('test_picgo_upload', {
        mode: config.image_import_mode,
        serverUrl: config.image_import_mode === 'picgo-server' ? config.picgo_server_url : null,
        cliCommand: config.image_import_mode === 'picgo-cli' ? config.picgo_cli_command : null,
        cliConfigPath: config.image_import_mode === 'picgo-cli'
          ? config.picgo_cli_config_path || null
          : null,
      });
      setPicgoStatus(`测试成功：${url}`);
    } catch (error) {
      setPicgoStatus(`测试失败：${String(error)}`);
    } finally {
      setTestingPicgo(false);
    }
  };

  const handleInstallPicgo = async (startServer: boolean) => {
    if (!config) return;
    setInstallingPicgo(true);
    setPicgoStatus('正在安装 PicGo CLI...');
    try {
      await invoke('install_picgo_cli');
      if (startServer) {
        setPicgoStatus('正在启动 PicGo Server...');
        await invoke('start_picgo_server', {
          serverUrl: config.picgo_server_url,
          cliCommand: config.picgo_cli_command,
        });
        setPicgoStatus('PicGo Server 已启动，请再次测试上传');
      } else {
        setPicgoStatus('PicGo CLI 安装完成，请再次测试上传');
      }
    } catch (error) {
      setPicgoStatus(`安装失败：${String(error)}`);
    } finally {
      setInstallingPicgo(false);
    }
  };

  const handleOpenPicgoGuide = () => {
    invoke('open_picgo_install_guide').catch((error) => {
      setPicgoStatus(`无法打开安装教程：${String(error)}`);
    });
  };

  const handleImageImportModeChange = (value: string) => {
    if (!config) return;
    setPicgoStatus('');
    setConfig({
      ...config,
      image_import_mode: normalizeImageImportMode(value),
    });
  };

  const handleResizeStart = (direction: ResizeDirection, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const maxWidth = Math.max(MIN_SETTINGS_WIDTH, window.innerWidth - 48);
    const maxHeight = Math.max(MIN_SETTINGS_HEIGHT, window.innerHeight - 48);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const horizontal = direction.includes('left') ? -1 : direction.includes('right') ? 1 : 0;
      const vertical = direction.includes('top') ? -1 : direction.includes('bottom') ? 1 : 0;
      setDialogSize({
        width: clamp(startWidth + horizontal * (moveEvent.clientX - startX), MIN_SETTINGS_WIDTH, maxWidth),
        height: clamp(startHeight + vertical * (moveEvent.clientY - startY), MIN_SETTINGS_HEIGHT, maxHeight),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  useEffect(() => {
    localStorage.setItem(SETTINGS_SIZE_STORAGE_KEY, JSON.stringify(dialogSize));
  }, [dialogSize]);

  if (!config) return null;

  return (
    <div className="settings-overlay">
      <div
        className="settings-dialog"
        ref={dialogRef}
        style={{ width: dialogSize.width, height: dialogSize.height }}
      >
        {(['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            aria-label={`调整窗口${direction}`}
            className={`settings-resize-handle settings-resize-${direction}`}
            data-resize-direction={direction}
            onPointerDown={(event) => handleResizeStart(direction, event)}
          />
        ))}
        <div className="settings-dialog-content">
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

        <div className="settings-section">
          <h4>图片导入</h4>
          <div className="setting-item">
            <label htmlFor="image-import-mode">导入方式</label>
            <select
              id="image-import-mode"
              value={config.image_import_mode}
              onChange={(event) => handleImageImportModeChange(event.target.value)}
            >
              <option value="absolute">本地绝对路径</option>
              <option value="relative">相对当前文档</option>
              <option value="custom">指定本地目录</option>
              <option value="picgo-server">PicGo Server 图床</option>
              <option value="picgo-cli">PicGo CLI 图床</option>
            </select>
          </div>

          {config.image_import_mode === 'custom' && (
            <div className="setting-item">
              <label htmlFor="image-custom-directory">图片目录</label>
              <div className="setting-row">
                <input id="image-custom-directory" type="text" value={config.image_custom_directory} readOnly />
                <button onClick={handleChooseImageDirectory} disabled={selectingDirectory}>
                  {selectingDirectory ? '选择中...' : '选择目录'}
                </button>
              </div>
            </div>
          )}

          {config.image_import_mode === 'picgo-server' && (
            <PicgoServerSettings
              config={config}
              setConfig={setConfig}
              onTest={handleTestPicgo}
              onInstall={() => handleInstallPicgo(true)}
              onGuide={handleOpenPicgoGuide}
              testing={testingPicgo}
              installing={installingPicgo}
              status={picgoStatus}
            />
          )}

          {config.image_import_mode === 'picgo-cli' && (
            <PicgoCliSettings
              config={config}
              setConfig={setConfig}
              onTest={handleTestPicgo}
              onInstall={() => handleInstallPicgo(false)}
              onGuide={handleOpenPicgoGuide}
              testing={testingPicgo}
              installing={installingPicgo}
              status={picgoStatus}
              configSource={picgoCliConfigSource}
              showCustomConfig={showCustomPicgoConfig}
              onShowCustomConfig={() => setShowCustomPicgoConfig(true)}
              onUseAutomaticConfig={() => {
                setConfig({ ...config, picgo_cli_config_path: '' });
                setShowCustomPicgoConfig(false);
              }}
            />
          )}

          <div className="setting-item">
            <label htmlFor="image-alt-text-mode">图片描述</label>
            <select
              id="image-alt-text-mode"
              value={config.image_alt_text_mode}
              onChange={(e) => setConfig({
                ...config,
                image_alt_text_mode: normalizeImageAltTextMode(e.target.value),
              })}
            >
              <option value="filename">使用文件名</option>
              <option value="none">无描述</option>
              <option value="custom">固定描述</option>
            </select>
          </div>

          {config.image_alt_text_mode === 'custom' && (
            <div className="setting-item">
              <label htmlFor="image-alt-text-custom">固定描述</label>
              <input
                id="image-alt-text-custom"
                type="text"
                value={config.image_alt_text_custom}
                onChange={(e) => setConfig({ ...config, image_alt_text_custom: e.target.value })}
              />
            </div>
          )}
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
    </div>
  );
}

function normalizeImageImportMode(value: string | undefined): ImageImportMode {
  if (value === 'picgo') return 'picgo-server';
  return value === 'relative' || value === 'custom' || value === 'picgo-server' || value === 'picgo-cli'
    ? value
    : 'absolute';
}

function normalizeImageAltTextMode(value: string | undefined): ImageAltTextMode {
  return value === 'none' || value === 'custom' ? value : 'filename';
}

interface PicgoSettingsProps {
  config: Config;
  setConfig: (config: Config) => void;
  onTest: () => void;
  onInstall: () => void;
  onGuide: () => void;
  testing: boolean;
  installing: boolean;
  status: string;
}

interface PicgoTestActionsProps {
  onTest: () => void;
  onInstall?: () => void;
  onGuide: () => void;
  testing: boolean;
  installing: boolean;
  status: string;
  installLabel: string;
}

function PicgoServerSettings({ config, setConfig, onTest, onInstall, onGuide, testing, installing, status }: PicgoSettingsProps) {
  const showLocalInstall = status.startsWith('测试失败') && isLocalServerUrl(config.picgo_server_url);
  return (
    <div className="setting-item">
      <label htmlFor="picgo-server-url">PicGo Server 地址</label>
      <input
        id="picgo-server-url"
        type="url"
        value={config.picgo_server_url}
        onChange={(event) => setConfig({ ...config, picgo_server_url: event.target.value })}
      />
      <PicgoTestActions
        onTest={onTest}
        onInstall={showLocalInstall ? onInstall : undefined}
        onGuide={onGuide}
        testing={testing}
        installing={installing}
        status={status}
        installLabel="安装并启动 PicGo Server"
      />
    </div>
  );
}

interface PicgoCliSettingsProps extends PicgoSettingsProps {
  configSource: PicgoCliConfigSource | null;
  showCustomConfig: boolean;
  onShowCustomConfig: () => void;
  onUseAutomaticConfig: () => void;
}

function PicgoCliSettings({
  config,
  setConfig,
  onTest,
  onInstall,
  onGuide,
  testing,
  installing,
  status,
  configSource,
  showCustomConfig,
  onShowCustomConfig,
  onUseAutomaticConfig,
}: PicgoCliSettingsProps) {
  return (
    <div className="setting-item">
      <label htmlFor="picgo-cli-command">PicGo CLI 命令</label>
      <input
        id="picgo-cli-command"
        type="text"
        value={config.picgo_cli_command}
        onChange={(event) => setConfig({ ...config, picgo_cli_command: event.target.value })}
      />
      <p className="setting-description">{describePicgoCliConfigSource(configSource)}</p>
      {showCustomConfig ? (
        <>
          <label htmlFor="picgo-cli-config-path">PicGo 配置文件（可选）</label>
          <input
            id="picgo-cli-config-path"
            type="text"
            value={config.picgo_cli_config_path}
            placeholder="输入另一套 config.json 的绝对路径"
            onChange={(event) => setConfig({ ...config, picgo_cli_config_path: event.target.value })}
          />
          <button type="button" onClick={onUseAutomaticConfig}>恢复自动配置</button>
        </>
      ) : (
        <button type="button" onClick={onShowCustomConfig}>使用自定义配置文件</button>
      )}
      <PicgoTestActions
        onTest={onTest}
        onInstall={status.startsWith('测试失败') ? onInstall : undefined}
        onGuide={onGuide}
        testing={testing}
        installing={installing}
        status={status}
        installLabel="安装 PicGo CLI"
      />
    </div>
  );
}

function describePicgoCliConfigSource(source: PicgoCliConfigSource | null): string {
  if (source?.source === 'desktop') return '自动使用 PicGo Desktop 配置';
  if (source?.source === 'custom') return '正在使用自定义 PicGo 配置';
  if (source?.source === 'default') return '未发现 PicGo Desktop，自动使用 PicGo CLI 默认配置';
  return '正在检测 PicGo 配置...';
}

function PicgoTestActions({ onTest, onInstall, onGuide, testing, installing, status, installLabel }: PicgoTestActionsProps) {
  return (
    <>
      <div className="setting-row picgo-actions">
        <button onClick={onTest} disabled={testing || installing}>{testing ? '测试中...' : '测试上传'}</button>
        <button onClick={onGuide}>查看安装教程</button>
        {onInstall && <button onClick={onInstall} disabled={installing}>{installing ? '安装中...' : installLabel}</button>}
      </div>
      <p className="setting-description">测试会在当前图床上传一张 1x1 PNG。</p>
      {status && <p className="setting-status">{status}</p>}
    </>
  );
}

function isLocalServerUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

function readDialogSize(): { width: number; height: number } {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_SIZE_STORAGE_KEY) || '');
    if (typeof value?.width === 'number' && typeof value?.height === 'number') return value;
  } catch {
    // 使用默认尺寸。
  }
  return { width: 720, height: 680 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
