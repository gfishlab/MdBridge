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
  onFileOpenInNewWindow?: (path: string) => void;
  currentFile: string;
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

export function FileTree({
  folderPath,
  onFileSelect,
  onFileOpenInNewWindow,
  currentFile,
}: FileTreeProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(240);
  const [collapsed, setCollapsed] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [showTreeMenu, setShowTreeMenu] = useState(false);
  const [hideSystemItems, setHideSystemItems] = useState(false);
  const newFileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const treeMenuRef = useRef<HTMLDivElement>(null);
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
    function handleClickOutside(e: MouseEvent) {
      if (treeMenuRef.current && !treeMenuRef.current.contains(e.target as Node)) {
        setShowTreeMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const visibleFiles = hideSystemItems ? filterSystemItems(files) : files;
  const expandAll = () => setExpandedDirs(new Set(collectDirPaths(visibleFiles)));
  const collapseAll = () => setExpandedDirs(new Set());
  const folderName = getFileName(folderPath);

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
          <PanelOpenIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="file-tree-wrapper" style={{ width }}>
      <div className="file-tree-toolbar">
        <div className="tree-toolbar-title" title={folderPath}>
          <FolderIcon open />
          <div className="tree-toolbar-title-text">
            <span>文件</span>
            <strong>{folderName}</strong>
          </div>
        </div>
        <div className="tree-toolbar-actions" ref={treeMenuRef}>
          <button className="tree-toolbar-btn" onClick={handleNewFile} title="新建文档" aria-label="新建文档">
            <NewFileIcon />
          </button>
          <button className="tree-toolbar-btn" onClick={locateFile} title="定位当前文件" aria-label="定位当前文件">
            <TargetIcon />
          </button>
          <button
            className="tree-toolbar-btn"
            onClick={() => setShowTreeMenu((open) => !open)}
            title="更多文件树操作"
            aria-label="更多文件树操作"
          >
            <MoreIcon />
          </button>
          <button className="tree-toolbar-btn" onClick={() => setCollapsed(true)} title="折叠文件树" aria-label="折叠文件树">
            <PanelCloseIcon />
          </button>
          {showTreeMenu && (
            <div className="tree-action-menu" role="menu">
              <button type="button" role="menuitem" onClick={expandAll}>
                展开全部
              </button>
              <button type="button" role="menuitem" onClick={collapseAll}>
                折叠全部
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={hideSystemItems}
                onClick={() => setHideSystemItems((value) => !value)}
              >
                {hideSystemItems ? '显示系统目录' : '隐藏系统目录'}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="file-tree" ref={containerRef}>
        {showNewFileInput && (
          <div className="tree-item new-file-input" style={{ paddingLeft: 8 }}>
            <span className="tree-file-icon"><MarkdownFileIcon /></span>
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
        {visibleFiles.map((file) => (
          <FileNode
            key={file.path}
            file={file}
            onFileSelect={onFileSelect}
            onFileOpenInNewWindow={onFileOpenInNewWindow}
            currentFile={currentFile}
            depth={0}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
            activeItemRef={activeItemRef}
            onRefresh={loadFiles}
            hideSystemItems={hideSystemItems}
          />
        ))}
      </div>
      <div className="file-tree-resizer" onMouseDown={onMouseDown} />
    </div>
  );
}

function filterSystemItems(files: FileInfo[]): FileInfo[] {
  return files
    .filter((file) => !isSystemItem(file.name))
    .map((file) => (
      file.is_dir && file.children
        ? { ...file, children: filterSystemItems(file.children) }
        : file
    ));
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function isSystemItem(name: string): boolean {
  return name.startsWith('.') || ['node_modules', 'dist', 'target'].includes(name);
}

function FileNode({
  file,
  onFileSelect,
  onFileOpenInNewWindow,
  currentFile,
  depth,
  expandedDirs,
  toggleDir,
  activeItemRef,
  onRefresh,
  hideSystemItems,
}: {
  file: FileInfo;
  onFileSelect: (path: string) => void;
  onFileOpenInNewWindow?: (path: string) => void;
  currentFile: string;
  depth: number;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  activeItemRef: React.MutableRefObject<HTMLDivElement | null>;
  onRefresh: () => void;
  hideSystemItems: boolean;
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

  const handleOpenInNewWindow = () => {
    setContextMenu(null);
    onFileOpenInNewWindow?.(file.path);
  };

  if (file.is_dir) {
    const expanded = expandedDirs.has(file.path);
    const childFiles = hideSystemItems ? filterSystemItems(file.children ?? []) : file.children;
    return (
      <div>
        <div
          className={`tree-item dir ${isSystemItem(file.name) ? 'system-item' : ''}`}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => toggleDir(file.path)}
          title={file.name}
        >
          <span className="tree-arrow"><ChevronIcon expanded={expanded} /></span>
          <span className="tree-folder-icon"><FolderIcon open={expanded} /></span>
          <span className="tree-name">{file.name}</span>
        </div>
        {expanded &&
          childFiles?.map((child) => (
            <FileNode
              key={child.path}
              file={child}
              onFileSelect={onFileSelect}
              onFileOpenInNewWindow={onFileOpenInNewWindow}
              currentFile={currentFile}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              activeItemRef={activeItemRef}
              onRefresh={onRefresh}
              hideSystemItems={hideSystemItems}
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
        <span className="tree-file-icon"><MarkdownFileIcon /></span>
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
          {onFileOpenInNewWindow && (
            <button className="context-menu-item" onClick={handleOpenInNewWindow}>
              在新窗口打开
            </button>
          )}
          <button className="context-menu-item danger" onClick={handleDelete}>
            删除文件
          </button>
        </div>
      )}
    </>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="tree-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={expanded ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
    </svg>
  );
}

function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg className="tree-icon folder" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 5.5A2.5 2.5 0 0 1 5 3h3.2l1.6 1.8H15A2.5 2.5 0 0 1 17.5 7v7A2.5 2.5 0 0 1 15 16.5H5A2.5 2.5 0 0 1 2.5 14V5.5Z" />
      {open && <path d="M3.2 8h13.6l-1.4 6.1A1.8 1.8 0 0 1 13.6 15.5H4.8a1.8 1.8 0 0 1-1.8-2.1L3.2 8Z" />}
    </svg>
  );
}

function MarkdownFileIcon() {
  return (
    <span className="markdown-file-icon" aria-hidden="true">
      <svg className="tree-icon document" viewBox="0 0 20 20">
        <path d="M5 2.5h6.2L15 6.3V15a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 15V5A2.5 2.5 0 0 1 5 2.5Z" />
        <path d="M11 2.8V6a1 1 0 0 0 1 1h3" />
      </svg>
      <span>MD</span>
    </span>
  );
}

function NewFileIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.5h6.2L15 6.3V15a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 15V5A2.5 2.5 0 0 1 5 2.5Z" />
      <path d="M11 2.8V6a1 1 0 0 0 1 1h3M8.5 10.5v4M6.5 12.5h4" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="5.5" />
      <circle cx="10" cy="10" r="1.8" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="15" cy="10" r="1.4" />
    </svg>
  );
}

function PanelCloseIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 3.5h12A1.5 1.5 0 0 1 17.5 5v10A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15V5A1.5 1.5 0 0 1 4 3.5Z" />
      <path d="M7 4v12M13 7l-3 3 3 3" />
    </svg>
  );
}

function PanelOpenIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 3.5h12A1.5 1.5 0 0 1 17.5 5v10A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15V5A1.5 1.5 0 0 1 4 3.5Z" />
      <path d="M7 4v12M10 7l3 3-3 3" />
    </svg>
  );
}
