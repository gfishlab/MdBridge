import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import MDEditor from '@uiw/react-md-editor';

interface UpdateInfo {
  version: string;
  body: string;
  current_version: string;
  release_url?: string | null;
  can_install: boolean;
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

  return (
    <div className="update-overlay">
      <div className="update-dialog">
        <h3>发现新版本 v{update.version}</h3>
        <p className="update-version">当前版本 v{update.current_version}</p>
        {update.body ? (
          <div className="update-body" data-color-mode="light">
            <MDEditor.Markdown source={update.body} />
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
