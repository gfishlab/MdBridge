import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface UpdateInfo {
  version: string;
  body: string;
  current_version: string;
  release_url?: string | null;
  can_install: boolean;
}

// 从 release / changelog 正文中提取变更条目。
// 第一条水平分割线（---）之后是 GitHub Release 专用的「Assets 下载说明」，
// 应用内更新弹窗不展示这部分，只保留变更日志本身。
export function extractChangelogItems(body: string): string[] {
  const lines = body.split('\n');
  const hrIndex = lines.findIndex((line) => /^-{3,}\s*$/.test(line.trim()));
  const relevant = hrIndex >= 0 ? lines.slice(0, hrIndex) : lines;
  return relevant
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*]|\d+\.)\s+/, '').trim())
    .filter((line) => line.length > 0);
}

export function UpdateDialog() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const unlisten = listen<UpdateInfo>('update-available', (event) => {
      setUpdate(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleUpdate = async () => {
    setDownloading(true);
    try {
      if (update?.can_install) {
        await invoke('install_update');
      } else if (update?.release_url) {
        await invoke('open_release_page', { url: update.release_url });
      }
      setUpdate(null);
    } catch (err) {
      console.error('Update failed:', err);
    }
    setDownloading(false);
  };

  if (!update) return null;

  const changelog = extractChangelogItems(update.body);

  return (
    <div className="update-overlay">
      <div className="update-dialog">
        <h3>发现新版本 v{update.version}</h3>
        <p className="update-version">当前版本 v{update.current_version}</p>
        {changelog.length > 0 ? (
          <div className="update-body">
            <p className="update-body-title">更新内容</p>
            <ol className="update-changelog">
              {changelog.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="update-actions">
          <button onClick={() => setUpdate(null)}>稍后</button>
          <button onClick={handleUpdate} disabled={downloading}>
            {downloading
              ? update.can_install
                ? '下载中...'
                : '打开中...'
              : update.can_install
                ? '立即更新'
                : '前往下载'}
          </button>
        </div>
      </div>
    </div>
  );
}
