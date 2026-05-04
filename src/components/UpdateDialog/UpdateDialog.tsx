import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface UpdateInfo {
  version: string;
  body: string;
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
      await invoke('install_update');
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
        <p>{update.body}</p>
        <div className="update-actions">
          <button onClick={() => setUpdate(null)}>稍后</button>
          <button onClick={handleUpdate} disabled={downloading}>
            {downloading ? '下载中...' : '立即更新'}
          </button>
        </div>
      </div>
    </div>
  );
}
