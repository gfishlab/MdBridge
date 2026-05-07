import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Editor } from './components/Editor';
import { PlatformBar } from './components/PlatformBar';
import { FileTree } from './components/FileTree';
import { UpdateDialog } from './components/UpdateDialog';
import { Settings } from './components/Settings';
import { Help } from './components/Help/Help';
import './App.css';

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setShowFileMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      setShowFileMenu(false);
    }
  };

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      setFolderPath(selected as string);
      setShowFileTree(true);
      setShowFileMenu(false);
    }
  };

  const handleFileSelect = async (path: string) => {
    const content = await invoke<string>('read_file', { path });
    setMarkdown(content);
    setCurrentFile(path);
  };

  const handleSave = async () => {
    if (currentFile) {
      await invoke('write_file', { path: currentFile, content: markdown });
      setStatusMessage('已保存');
    } else {
      const selected = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (selected) {
        await invoke('write_file', { path: selected, content: markdown });
        setCurrentFile(selected as string);
        setStatusMessage('已保存');
      }
    }
    setShowFileMenu(false);
  };

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
          <Editor value={markdown} onChange={setMarkdown} />
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
