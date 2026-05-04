import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Editor } from './components/Editor';
import { PlatformBar } from './components/PlatformBar';
import { FileTree } from './components/FileTree';
import './App.css';

function App() {
  const [markdown, setMarkdown] = useState('# Hello MDBridge\n\nStart writing...');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [statusMessage, setStatusMessage] = useState('');
  const [currentFile, setCurrentFile] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [showFileTree, setShowFileTree] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
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
      const selected = await open({
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
        <span className="app-name">MDBridge</span>
        <div className="toolbar-center">
          <div className="file-menu-container" ref={fileMenuRef}>
            <button
              className="file-btn"
              onClick={() => setShowFileMenu(!showFileMenu)}
            >
              文件 ▾
            </button>
            {showFileMenu && (
              <div className="file-menu">
                <button onClick={handleOpenFile}>打开文件</button>
                <button onClick={handleOpenFolder}>打开文件夹</button>
                <button onClick={handleSave}>保存</button>
              </div>
            )}
          </div>
          <PlatformBar markdown={markdown} onStatusChange={setStatusMessage} />
        </div>
        <div className="view-toggle">
          <button
            className={viewMode === 'edit' ? 'active' : ''}
            onClick={() => setViewMode('edit')}
            title="编辑模式"
          >✏️</button>
          <button
            className={viewMode === 'split' ? 'active' : ''}
            onClick={() => setViewMode('split')}
            title="并排模式"
          >↔️</button>
          <button
            className={viewMode === 'preview' ? 'active' : ''}
            onClick={() => setViewMode('preview')}
            title="预览模式"
          >👁</button>
        </div>
      </header>
      <div className="main-content">
        {showFileTree && folderPath && (
          <FileTree
            folderPath={folderPath}
            onFileSelect={handleFileSelect}
            currentFile={currentFile}
          />
        )}
        <main className="content">
          <Editor value={markdown} onChange={setMarkdown} viewMode={viewMode} />
        </main>
      </div>
      <footer className="status-bar">
        <span className="status-message">{statusMessage}</span>
        {currentFile && <span className="file-path">{currentFile}</span>}
      </footer>
    </div>
  );
}

export default App;
