import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';

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

export function FileTree({ folderPath, onFileSelect, currentFile }: FileTreeProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);

  useEffect(() => {
    if (folderPath) {
      invoke<FileInfo[]>('read_folder', { path: folderPath }).then(setFiles);
    }
  }, [folderPath]);

  return (
    <div className="file-tree">
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
        >
          {expanded ? '▼' : '▶'} {file.name}
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
    >
      📄 {file.name}
    </div>
  );
}
