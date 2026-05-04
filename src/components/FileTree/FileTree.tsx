import { invoke } from '@tauri-apps/api/core';
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
}

function sortFiles(files: FileInfo[]): FileInfo[] {
  return [...files].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }).map(f => f.is_dir && f.children ? { ...f, children: sortFiles(f.children) } : f);
}

export function FileTree({ folderPath, onFileSelect, currentFile }: FileTreeProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [width, setWidth] = useState(240);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (folderPath) {
      invoke<FileInfo[]>('read_folder', { path: folderPath }).then(data => {
        setFiles(sortFiles(data));
      });
    }
  }, [folderPath]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = width;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.max(160, Math.min(600, startWidth + ev.clientX - startX));
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width]);

  return (
    <div className="file-tree-wrapper" style={{ width }}>
      <div className="file-tree" ref={containerRef}>
        {files.map((file) => (
          <FileNode
            key={file.path}
            file={file}
            onFileSelect={onFileSelect}
            currentFile={currentFile}
            depth={0}
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
}: {
  file: FileInfo;
  onFileSelect: (path: string) => void;
  currentFile: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (file.is_dir) {
    return (
      <div>
        <div
          className="tree-item dir"
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => setExpanded(!expanded)}
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
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`tree-item file ${file.path === currentFile ? 'active' : ''}`}
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={() => onFileSelect(file.path)}
      title={file.name}
    >
      <span className="tree-file-icon">📄</span>
      <span className="tree-name">{file.name}</span>
    </div>
  );
}
