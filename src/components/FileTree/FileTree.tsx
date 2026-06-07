import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useState, useEffect, useRef, useCallback } from 'react';

interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileInfo[];
}

interface FileTreeProps {
  folderPath: string;
  onFileSelect: (path: string) => void;
  currentFile: string;
  newFileTrigger: number;
}

interface FileSystemChange {
  root_path: string;
}

function sortFiles(files: FileInfo[]): FileInfo[] {
  return [...files].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }).map(f => f.is_dir && f.children ? { ...f, children: sortFiles(f.children) } : f);
}

function collectDirPaths(files: FileInfo[]): string[] {
  const paths: string[] = [];
  for (const f of files) {
    if (f.is_dir) {
      paths.push(f.path);
      if (f.children) paths.push(...collectDirPaths(f.children));
    }
  }
  return paths;
}

function findAncestorDirs(files: FileInfo[], targetPath: string): string[] {
  const dirs: string[] = [];
  function walk(items: FileInfo[]): boolean {
    for (const f of items) {
      if (f.path === targetPath) return true;
      if (f.is_dir && f.children) {
        if (walk(f.children)) {
          dirs.push(f.path);
          return true;
        }
      }
    }
    return false;
  }
  walk(files);
  return dirs;
}

export function FileTree({ folderPath, onFileSelect, currentFile, newFileTrigger }: FileTreeProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(240);
  const [collapsed, setCollapsed] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const newFileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const loadFiles = useCallback(() => {
    if (folderPath) {
      invoke<FileInfo[]>('read_folder', { path: folderPath }).then(data => {
        setFiles(sortFiles(data));
      });
    }
  }, [folderPath]);

  useEffect(() => {
    if (folderPath) {
      invoke<FileInfo[]>('read_folder', { path: folderPath }).then(data => {
        setFiles(sortFiles(data));
        setExpandedDirs(new Set());
      });
    }
  }, [folderPath]);

  useEffect(() => {
    if (!folderPath) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshInterval = setInterval(loadFiles, 1500);
    const unlisten = listen<FileSystemChange>('file-system-changed', (event) => {
      if (event.payload.root_path !== folderPath) return;

      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        loadFiles();
      }, 150);
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(refreshInterval);
      unlisten.then((fn) => fn());
    };
  }, [folderPath, loadFiles]);

  useEffect(() => {
    if (newFileTrigger > 0) {
      handleNewFile();
    }
  }, [newFileTrigger]);

  const handleNewFile = () => {
    setShowNewFileInput(true);
    setNewFileName('');
    setTimeout(() => newFileInputRef.current?.focus(), 50);
  };

  const confirmNewFile = async () => {
    const name = newFileName.trim();
    if (!name) {
      setShowNewFileInput(false);
      return;
    }
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const filePath = `${folderPath}/${fileName}`;
    await invoke('write_file', { path: filePath, content: '' });
    setShowNewFileInput(false);
    setNewFileName('');
    loadFiles();
    onFileSelect(filePath);
  };

  const expandAll = () => setExpandedDirs(new Set(collectDirPaths(files)));
  const collapseAll = () => setExpandedDirs(new Set());

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const locateFile = () => {
    if (!currentFile) return;
    const ancestorDirs = findAncestorDirs(files, currentFile);
    setExpandedDirs(prev => {
      const next = new Set(prev);
      ancestorDirs.forEach(d => next.add(d));
      return next;
    });
    setTimeout(() => {
      activeItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const startX = e.clientX;
    const startWidth = width;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.max(160, Math.min(600, startWidth + ev.clientX - startX));
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  if (collapsed) {
    return (
      <div className="file-tree-wrapper collapsed">
        <button
          className="tree-toolbar-btn"
          onClick={() => setCollapsed(false)}
          title="展开文件树"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="file-tree-wrapper" style={{ width }}>
      <div className="file-tree-toolbar">
        <div className="tree-toolbar-left">
          <button className="tree-toolbar-btn" onClick={() => setCollapsed(true)} title="折叠文件树">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
          </button>
          <button className="tree-toolbar-btn" onClick={expandAll} title="展开全部">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <button className="tree-toolbar-btn" onClick={collapseAll} title="折叠全部">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 15l-6-6-6 6"/>
          </svg>
        </button>
        <button className="tree-toolbar-btn" onClick={locateFile} title="定位当前文件">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
            </svg>
          </button>
        </div>
        <button className="tree-toolbar-btn" onClick={handleNewFile} title="新建文档">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>
      </div>
      <div className="file-tree" ref={containerRef}>
        {showNewFileInput && (
          <div className="tree-item new-file-input" style={{ paddingLeft: 8 }}>
            <span className="tree-file-icon">📄</span>
            <input
              ref={newFileInputRef}
              className="new-file-name"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNewFile();
                if (e.key === 'Escape') setShowNewFileInput(false);
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (showNewFileInput) confirmNewFile();
                }, 100);
              }}
              placeholder="输入文件名..."
            />
          </div>
        )}
        {files.map((file) => (
          <FileNode
            key={file.path}
            file={file}
            onFileSelect={onFileSelect}
            currentFile={currentFile}
            depth={0}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
            activeItemRef={activeItemRef}
            onRefresh={loadFiles}
          />
        ))}
      </div>
      <div className="file-tree-resizer" onMouseDown={onMouseDown} />
    </div>
  );
}

function FileNode({
  file,
  onFileSelect,
  currentFile,
  depth,
  expandedDirs,
  toggleDir,
  activeItemRef,
  onRefresh,
}: {
  file: FileInfo;
  onFileSelect: (path: string) => void;
  currentFile: string;
  depth: number;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  activeItemRef: React.MutableRefObject<HTMLDivElement | null>;
  onRefresh: () => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const isActive = file.path === currentFile;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  const handleDelete = async () => {
    setContextMenu(null);
    if (!confirm(`确定删除 "${file.name}" 吗？`)) return;
    try {
      await invoke('delete_file', { path: file.path });
      onRefresh();
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  const handleCopyPath = async () => {
    setContextMenu(null);
    try {
      await navigator.clipboard.writeText(file.path);
    } catch {
      // fallback: Tauri clipboard not available
    }
  };

  if (file.is_dir) {
    const expanded = expandedDirs.has(file.path);
    return (
      <div>
        <div
          className="tree-item dir"
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => toggleDir(file.path)}
          title={file.name}
        >
          <span className="tree-arrow">{expanded ? '▼' : '▶'}</span>
          <span className="tree-folder-icon">📁</span>
          <span className="tree-name">{file.name}</span>
        </div>
        {expanded &&
          file.children?.map((child) => (
            <FileNode
              key={child.path}
              file={child}
              onFileSelect={onFileSelect}
              currentFile={currentFile}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              activeItemRef={activeItemRef}
              onRefresh={onRefresh}
            />
          ))}
      </div>
    );
  }

  return (
    <>
      <div
        ref={(node) => {
          if (isActive) activeItemRef.current = node;
        }}
        className={`tree-item file ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onFileSelect(file.path)}
        onContextMenu={handleContextMenu}
        title={file.name}
      >
        <span className="tree-file-icon">📄</span>
        <span className="tree-name">{file.name}</span>
      </div>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="context-menu-item" onClick={handleCopyPath}>
            复制文件路径
          </button>
          <button className="context-menu-item danger" onClick={handleDelete}>
            删除文件
          </button>
        </div>
      )}
    </>
  );
}
