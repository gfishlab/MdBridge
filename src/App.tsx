import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Editor } from './components/Editor';
import { PlatformBar } from './components/PlatformBar';
import { FileTree } from './components/FileTree';
import { UpdateDialog } from './components/UpdateDialog';
import { Settings } from './components/Settings';
import { Help } from './components/Help/Help';
import './App.css';

interface Config {
  image_cache_size_mb: number;
  default_platform: string;
  check_updates_on_startup: boolean;
}

interface FileSystemChange {
  paths: string[];
}

function App() {
  const [markdown, setMarkdown] = useState('# Hello MDBridge\n\nStart writing...');
  const [statusMessage, setStatusMessage] = useState('');
  const [currentFile, setCurrentFile] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [showFileTree, setShowFileTree] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [newFileTrigger, setNewFileTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const currentFileRef = useRef('');
  const markdownRef = useRef(markdown);
  const hasLocalEditsRef = useRef(false);
  const externalReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

  useEffect(() => {
    markdownRef.current = markdown;
  }, [markdown]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setShowFileMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    async function checkStartupUpdates() {
      try {
        const config = await invoke<Config>('get_config');
        if (config.check_updates_on_startup) {
          await invoke('check_for_updates');
        }
      } catch (err) {
        console.error('Startup update check failed:', err);
      }
    }

    checkStartupUpdates();
  }, []);

  const handleNewFile = () => {
    setShowFileMenu(false);
    if (folderPath) {
      setNewFileTrigger(prev => prev + 1);
    } else {
      setMarkdown('');
      setCurrentFile('');
      setStatusMessage('新建文档');
    }
  };

  const handleOpenFile = async () => {
    const selected = await open({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (selected) {
      const content = await invoke<string>('read_file', { path: selected });
      setMarkdown(content);
      setCurrentFile(selected as string);
      hasLocalEditsRef.current = false;
      setShowFileMenu(false);
    }
  };

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      const path = selected as string;
      await invoke('watch_folder', { path });
      setFolderPath(path);
      setShowFileTree(true);
      setShowFileMenu(false);
    }
  };

  const handleFileSelect = async (path: string) => {
    const content = await invoke<string>('read_file', { path });
    setMarkdown(content);
    setCurrentFile(path);
    hasLocalEditsRef.current = false;
  };

  const handleSave = async () => {
    if (currentFile) {
      await invoke('write_file', { path: currentFile, content: markdown });
      hasLocalEditsRef.current = false;
      setStatusMessage('已保存');
    } else {
      const selected = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (selected) {
        await invoke('write_file', { path: selected, content: markdown });
        setCurrentFile(selected as string);
        hasLocalEditsRef.current = false;
        setStatusMessage('已保存');
      }
    }
    setShowFileMenu(false);
  };

  const handleEditorChange = (value: string) => {
    hasLocalEditsRef.current = true;
    setMarkdown(value);
  };

  useEffect(() => {
    if (!folderPath) return;

    invoke('watch_folder', { path: folderPath }).catch((err) => {
      setStatusMessage(`监听文件夹失败: ${err}`);
    });

    return () => {
      invoke('unwatch_folder').catch(() => {});
    };
  }, [folderPath]);

  useEffect(() => {
    if (!currentFile) return;

    const interval = setInterval(async () => {
      const activeFile = currentFileRef.current;
      if (!activeFile || hasLocalEditsRef.current) return;

      try {
        const content = await invoke<string>('read_file', { path: activeFile });
        // Re-check after the async read: a keystroke or file switch during the
        // read window must not be clobbered by stale external content.
        if (hasLocalEditsRef.current || currentFileRef.current !== activeFile) return;
        if (content !== markdownRef.current) {
          setMarkdown(content);
          setStatusMessage('已刷新外部修改');
        }
      } catch {
        // Ignore transient read errors; direct event handling reports immediate failures.
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [currentFile]);

  useEffect(() => {
    const unlisten = listen<FileSystemChange>('file-system-changed', (event) => {
      const activeFile = currentFileRef.current;
      if (!activeFile || !event.payload.paths.includes(activeFile)) return;

      if (hasLocalEditsRef.current) {
        setStatusMessage('当前文件已在外部修改，请先保存或重新打开以避免覆盖本地编辑');
        return;
      }

      if (externalReloadTimerRef.current) clearTimeout(externalReloadTimerRef.current);
      externalReloadTimerRef.current = setTimeout(async () => {
        if (hasLocalEditsRef.current) {
          setStatusMessage('当前文件已在外部修改，请先保存或重新打开以避免覆盖本地编辑');
          return;
        }

        try {
          const content = await invoke<string>('read_file', { path: activeFile });
          // Re-check after the async read: a keystroke or file switch during the
          // read window must not be clobbered by stale external content.
          if (hasLocalEditsRef.current || currentFileRef.current !== activeFile) return;
          setMarkdown(content);
          setStatusMessage('已刷新外部修改');
        } catch (err) {
          setStatusMessage(`刷新文件失败: ${err}`);
        }
      }, 150);
    });

    return () => {
      if (externalReloadTimerRef.current) clearTimeout(externalReloadTimerRef.current);
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFile, markdown]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-left">
          <div className="file-menu-container" ref={fileMenuRef}>
            <button
              className="menu-btn"
              onClick={() => setShowFileMenu(!showFileMenu)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              文件
            </button>
            {showFileMenu && (
              <div className="file-menu">
                <button onClick={handleNewFile}>新建文档</button>
                <button onClick={handleOpenFile}>打开文件</button>
                <button onClick={handleOpenFolder}>打开文件夹</button>
                <button onClick={handleSave}>保存</button>
              </div>
            )}
          </div>
          <PlatformBar markdown={markdown} onStatusChange={setStatusMessage} />
          <button
            className="menu-btn"
            onClick={() => setShowSettings(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            设置
          </button>
          <button
            className="menu-btn"
            onClick={() => setShowHelp(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            帮助
          </button>
        </div>
      </header>
      <div className="main-content">
        {showFileTree && folderPath && (
          <FileTree
            folderPath={folderPath}
            onFileSelect={handleFileSelect}
            currentFile={currentFile}
            newFileTrigger={newFileTrigger}
          />
        )}
        <main className="content">
          <Editor value={markdown} onChange={handleEditorChange} />
        </main>
      </div>
      <footer className="status-bar">
        <span className="status-message">{statusMessage}</span>
        {currentFile && <span className="file-path">{currentFile}</span>}
      </footer>
      <UpdateDialog />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showHelp && <Help onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
