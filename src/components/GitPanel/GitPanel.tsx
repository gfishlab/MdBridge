import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './GitPanel.css';

export interface GitStatus {
  repo_root: string;
  branch: string;
  changed_files: number;
  ahead: number;
  behind: number;
  has_remote: boolean;
}

export interface GitChangedFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitCommit {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  summary: string;
}

interface GitOperationResult {
  message: string;
}

interface GitConflictFile {
  path: string;
  base: string;
  ours: string;
  theirs: string;
}

interface GitPanelProps {
  workspacePath: string;
  currentFile: string;
  hasLocalEdits: boolean;
  selectedChangedFilePath: string;
  onBeforeGitAction: () => Promise<void>;
  onChangedFileSelect: (file: GitChangedFile) => void;
  onClose: () => void;
  onRepositoryStatusChange: (status: GitStatus | null) => void;
  onRestoreVersion: (content: string) => void;
  onStatusChange: (message: string) => void;
  refreshSignal?: number;
}

export function GitPanel({
  workspacePath,
  currentFile,
  hasLocalEdits,
  selectedChangedFilePath,
  onBeforeGitAction,
  onChangedFileSelect,
  onClose,
  onRepositoryStatusChange,
  onRestoreVersion,
  onStatusChange,
  refreshSignal = 0,
}: GitPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [changedFiles, setChangedFiles] = useState<GitChangedFile[]>([]);
  const [selectedChangedPaths, setSelectedChangedPaths] = useState<string[]>([]);
  const [history, setHistory] = useState<GitCommit[]>([]);
  const [conflicts, setConflicts] = useState<GitConflictFile[]>([]);
  const [selectedConflictPath, setSelectedConflictPath] = useState('');
  const [selectedHash, setSelectedHash] = useState('');
  const [diff, setDiff] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [operationMessage, setOperationMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [panelWidth, setPanelWidth] = useState(420);
  const [resizing, setResizing] = useState(false);

  const selectedCommit = useMemo(
    () => history.find((commit) => commit.hash === selectedHash) ?? null,
    [history, selectedHash],
  );

  const loadRepository = useCallback(async () => {
    if (!workspacePath) {
      setStatus(null);
      setChangedFiles([]);
      setSelectedChangedPaths([]);
      setHistory([]);
      setSelectedHash('');
      onRepositoryStatusChange(null);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextChangedFiles, nextHistory] = await Promise.all([
        invoke<GitStatus>('get_git_status', { path: workspacePath }),
        invoke<GitChangedFile[]>('get_git_changed_files', { path: workspacePath }),
        currentFile
          ? invoke<GitCommit[]>('get_git_file_history', { path: currentFile, limit: 80 })
          : Promise.resolve([]),
      ]);

      const normalizedChangedFiles = Array.isArray(nextChangedFiles) ? nextChangedFiles : [];
      const changedPaths = normalizedChangedFiles.map((file) => file.path);
      setStatus(nextStatus);
      setChangedFiles(normalizedChangedFiles);
      setSelectedChangedPaths((current) => {
        const retained = current.filter((path) => changedPaths.includes(path));
        return retained.length > 0 ? retained : changedPaths;
      });
      setHistory(Array.isArray(nextHistory) ? nextHistory : []);
      setSelectedHash((current) => (
        Array.isArray(nextHistory) && nextHistory.some((commit) => commit.hash === current)
          ? current
          : Array.isArray(nextHistory) ? nextHistory[0]?.hash ?? '' : ''
      ));
      onRepositoryStatusChange(nextStatus);
    } catch (err) {
      setStatus(null);
      setChangedFiles([]);
      setSelectedChangedPaths([]);
      setHistory([]);
      setSelectedHash('');
      setError(String(err));
      onRepositoryStatusChange(null);
    } finally {
      setLoading(false);
    }
  }, [currentFile, onRepositoryStatusChange, workspacePath]);

  useEffect(() => {
    loadRepository();
  }, [loadRepository, refreshSignal]);

  useEffect(() => {
    if (!resizing) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const panelLeft = panelRef.current?.getBoundingClientRect().left ?? 0;
      const maxWidth = Math.min(Math.max(window.innerWidth * 0.68, 420), 760);
      const nextWidth = Math.min(Math.max(event.clientX - panelLeft, 320), maxWidth);
      setPanelWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setResizing(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  useEffect(() => {
    let cancelled = false;
    if (!currentFile || !selectedHash) {
      setDiff('');
      return;
    }

    setDiffLoading(true);
    invoke<string>('get_git_file_diff', { path: currentFile, commit: selectedHash })
      .then((nextDiff) => {
        if (!cancelled) setDiff(nextDiff.trim() || '该版本没有当前文档的可显示差异。');
      })
      .catch((err) => {
        if (!cancelled) setDiff(`读取差异失败: ${err}`);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentFile, selectedHash]);

  const runAction = async (
    label: string,
    action: () => Promise<void>,
  ) => {
    setActionLoading(label);
    setError('');
    setOperationMessage('');
    try {
      await onBeforeGitAction();
      await action();
      await loadRepository();
    } catch (err) {
      setError(`${label}失败: ${err}`);
      if (label === 'Pull 拉取') {
        try {
          const nextConflicts = await invoke<GitConflictFile[]>('get_git_conflicts', { path: workspacePath });
          setConflicts(nextConflicts);
          setSelectedConflictPath(nextConflicts[0]?.path ?? '');
        } catch {
          setConflicts([]);
          setSelectedConflictPath('');
        }
      }
    } finally {
      setActionLoading('');
    }
  };

  const handleRestore = () => {
    if (!currentFile || !selectedCommit) return;
    const confirmed = window.confirm(`将当前文档恢复到 ${selectedCommit.short_hash} 的版本？当前内容会被覆盖。`);
    if (!confirmed) return;

    runAction('恢复版本', async () => {
      const content = await invoke<string>('restore_git_file_revision', {
        path: currentFile,
        commit: selectedCommit.hash,
      });
      onRestoreVersion(content);
      onStatusChange('已恢复到选中的历史版本');
    });
  };

  const handleCommit = () => {
    const filePaths = getSelectedChangedPaths(changedFiles, selectedChangedPaths);
    if (!workspacePath || filePaths.length === 0 || !commitMessage.trim()) return;

    runAction('保存版本', async () => {
      const result = await invoke<GitOperationResult>('commit_git_files', {
        path: workspacePath,
        filePaths,
        message: commitMessage.trim(),
      });
      setCommitMessage('');
      setOperationMessage(result.message || '已保存一个版本');
      onStatusChange('已保存一个版本');
    });
  };

  const handleToggleChangedFile = (filePath: string) => {
    setSelectedChangedPaths((current) => (
      current.includes(filePath)
        ? current.filter((path) => path !== filePath)
        : [...current, filePath]
    ));
  };

  const handleSelectAllChangedFiles = () => {
    setSelectedChangedPaths(changedFiles.map((file) => file.path));
  };

  const handleClearChangedFiles = () => {
    setSelectedChangedPaths([]);
  };

  const handleResolveConflict = (resolution: 'ours' | 'theirs') => {
    const selectedConflict = conflicts.find((conflict) => conflict.path === selectedConflictPath);
    if (!selectedConflict) return;

    runAction(resolution === 'ours' ? '采用当前修改' : '采用传入修改', async () => {
      const result = await invoke<GitOperationResult>('resolve_git_conflict', {
        path: workspacePath,
        filePath: selectedConflict.path,
        resolution,
      });
      setOperationMessage(result.message);
      const nextConflicts = await invoke<GitConflictFile[]>('get_git_conflicts', { path: workspacePath });
      setConflicts(nextConflicts);
      setSelectedConflictPath(nextConflicts[0]?.path ?? '');
    });
  };

  const selectedFilePaths = getSelectedChangedPaths(changedFiles, selectedChangedPaths);
  const commitDisabledReason = selectedFilePaths.length === 0
    ? '至少勾选一个改动文件后可保存版本。'
    : !commitMessage.trim()
      ? '填写版本说明后可保存版本。'
      : '';
  const selectedConflict = conflicts.find((conflict) => conflict.path === selectedConflictPath) ?? conflicts[0] ?? null;
  const workspaceRoot = status?.repo_root || workspacePath;
  const currentRelativePath = currentFile && status ? getRelativePath(currentFile, status.repo_root) : '';
  const currentFileName = currentFile ? getFileName(currentFile) : '未保存文档';

  return (
    <aside
      ref={panelRef}
      className={`git-panel ${resizing ? 'resizing' : ''}`}
      style={{ width: panelWidth }}
      aria-label="版本中心"
    >
      <div className="git-panel-header">
        <div className="git-panel-title">
          <BranchIcon />
          <div>
            <span>文档</span>
            <strong>版本中心</strong>
          </div>
        </div>
        <button type="button" className="git-icon-btn" onClick={onClose} aria-label="关闭版本面板">
          ×
        </button>
      </div>

      <div className="git-panel-body">
        {loading && <div className="git-panel-state">正在读取版本信息...</div>}
        {error && (
          isVersionComponentMissing(error) ? (
            <VersionComponentNotice />
          ) : (
            <div className="git-panel-error">无法读取版本信息：{error}</div>
          )
        )}
        {operationMessage && <div className="git-panel-result">{operationMessage}</div>}

        {status && (
          <section className="git-section git-repo-summary" aria-label="版本状态">
            <div>
              <span className="git-label">当前状态</span>
              <strong>{status.changed_files > 0 ? `${status.changed_files} 个改动待保存` : '没有待保存改动'}</strong>
            </div>
            <span className={`git-change-pill ${status.changed_files > 0 ? 'dirty' : ''}`}>
              {status.changed_files} 个改动
            </span>
            {(status.ahead > 0 || status.behind > 0) && (
              <div className="git-sync-meta">
                {status.ahead > 0 && <span>待分享 {status.ahead} 个版本</span>}
                {status.behind > 0 && <span>待同步 {status.behind} 个版本</span>}
              </div>
            )}
          </section>
        )}

        <section className="git-section git-commit-section" aria-label="保存当前版本">
          <div className="git-section-title-row">
            <div className="git-section-heading">当前改动</div>
            <div className="git-change-selection-actions">
              <button type="button" onClick={handleSelectAllChangedFiles} disabled={changedFiles.length === 0 || !!actionLoading}>
                全选
              </button>
              <button type="button" onClick={handleClearChangedFiles} disabled={changedFiles.length === 0 || !!actionLoading}>
                取消勾选
              </button>
            </div>
          </div>
          <div className="git-working-tree-layout">
            <div className="git-change-list" aria-label="当前改动文件">
              {changedFiles.length === 0 && (
                <div className="git-empty">当前没有可显示的改动。</div>
              )}
              {changedFiles.map((file) => {
                const isCurrentFile = currentRelativePath === file.path;
                const isSelected = selectedChangedPaths.includes(file.path);
                const isActive = selectedChangedFilePath === file.path;
                const displayName = getFileName(file.path);
                const displayPath = getWorkspaceDisplayPath(workspaceRoot, file.path);
                return (
                  <div
                    key={`${file.status}-${file.path}`}
                    className={`git-change-row ${isCurrentFile ? 'current' : ''} ${isActive ? 'selected' : ''}`}
                    title={displayPath}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleChangedFile(file.path)}
                      disabled={!!actionLoading}
                      aria-label={`选择 ${file.path}`}
                    />
                    <span className={`git-file-status ${getGitFileStatusKind(file.status)}`}>
                      {getGitFileStatusLabel(file.status)}
                    </span>
                    <button
                      type="button"
                      className="git-change-path-btn"
                      onClick={() => onChangedFileSelect(file)}
                      aria-label={`查看 ${file.path} 的改动`}
                    >
                      <span className="git-change-file-name">{displayName}</span>
                      <span className="git-change-file-path">{displayPath}</span>
                    </button>
                    {file.staged && <span className="git-change-stage">已暂存</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="git-hint">
            保存版本会保存已勾选的 {selectedFilePaths.length} 个文件。
            {currentRelativePath && ` 当前文档：${currentRelativePath || currentFileName}`}
          </p>
          <label className="git-input-block">
            <span>版本说明</span>
            <textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="例如：更新发布说明"
              disabled={selectedFilePaths.length === 0 || !!actionLoading}
              aria-describedby="git-commit-hint"
              rows={5}
            />
          </label>
          <button
            type="button"
            className="git-primary-btn"
            onClick={handleCommit}
            disabled={selectedFilePaths.length === 0 || !commitMessage.trim() || !!actionLoading}
          >
            {actionLoading === '保存版本' ? '保存中...' : '保存一个版本'}
          </button>
          {commitDisabledReason && <p id="git-commit-hint" className="git-hint">{commitDisabledReason}</p>}
          {hasLocalEdits && <p className="git-hint">保存版本前会先保存当前编辑内容。</p>}
        </section>

        {conflicts.length > 0 && selectedConflict && (
          <section className="git-section git-conflict-section" aria-label="冲突解决">
            <div className="git-section-heading">冲突文件</div>
            <div className="git-conflict-tabs">
              {conflicts.map((conflict) => (
                <button
                  key={conflict.path}
                  type="button"
                  className={conflict.path === selectedConflict.path ? 'active' : ''}
                  onClick={() => setSelectedConflictPath(conflict.path)}
                >
                  {conflict.path}
                </button>
              ))}
            </div>
            <div className="git-conflict-compare">
              <div>
                <div className="git-conflict-title">当前修改</div>
                <pre>{selectedConflict.ours || '(空)'}</pre>
                <button
                  type="button"
                  className="git-secondary-btn"
                  onClick={() => handleResolveConflict('ours')}
                  disabled={!!actionLoading}
                >
                  采用当前修改
                </button>
              </div>
              <div>
                <div className="git-conflict-title">传入修改</div>
                <pre>{selectedConflict.theirs || '(空)'}</pre>
                <button
                  type="button"
                  className="git-secondary-btn"
                  onClick={() => handleResolveConflict('theirs')}
                  disabled={!!actionLoading}
                >
                  采用传入修改
                </button>
              </div>
            </div>
            {selectedConflict.base && (
              <details className="git-conflict-base">
                <summary>共同祖先</summary>
                <pre>{selectedConflict.base}</pre>
              </details>
            )}
          </section>
        )}

        <section className="git-section git-history-section" aria-label="版本记录">
          <div className="git-section-heading">版本记录</div>
          {!currentFile && <div className="git-empty">保存或打开一个 Markdown 文件后可查看历史。</div>}
          {currentFile && history.length === 0 && !loading && (
            <div className="git-empty">当前文档还没有可显示的版本记录。</div>
          )}
          <div className="git-history-list">
            {history.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                className={`git-commit-item ${commit.hash === selectedHash ? 'selected' : ''}`}
                onClick={() => setSelectedHash(commit.hash)}
              >
                <span className="git-commit-summary">{commit.summary || '(无版本说明)'}</span>
                <span className="git-commit-meta">
                  <code>{commit.short_hash}</code>
                  <span>{commit.author_name}</span>
                  <span>{formatDate(commit.authored_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {selectedCommit && (
          <section className="git-section git-diff-section" aria-label="版本差异">
            <div className="git-diff-heading">
              <div>
                <span className="git-label">版本详情</span>
                <strong>{selectedCommit.summary || selectedCommit.short_hash}</strong>
              </div>
              <button
                type="button"
                className="git-secondary-btn"
                onClick={handleRestore}
                disabled={!!actionLoading}
              >
                恢复到这个版本
              </button>
            </div>
            <div className="git-author-line">
              {selectedCommit.author_name}
              {selectedCommit.author_email && <span>{selectedCommit.author_email}</span>}
            </div>
            <DiffBlock diff={diff} loading={diffLoading} />
          </section>
        )}
      </div>
      <div
        className="git-panel-resizer"
        role="separator"
        aria-label="调整版本中心宽度"
        aria-orientation="vertical"
        onMouseDown={(event) => {
          event.preventDefault();
          setResizing(true);
        }}
      />
    </aside>
  );
}

function DiffBlock({ diff, loading }: { diff: string; loading: boolean }) {
  const content = loading ? '正在读取差异...' : diff;
  return (
    <pre className="git-diff">
      {content.split('\n').map((line, index) => (
        <span key={`${index}-${line}`} className={getDiffLineClass(line)}>
          {line || ' '}
          {index < content.split('\n').length - 1 ? '\n' : ''}
        </span>
      ))}
    </pre>
  );
}

function getSelectedChangedPaths(changedFiles: GitChangedFile[], selectedChangedPaths: string[]) {
  const existingPaths = new Set(changedFiles.map((file) => file.path));
  return selectedChangedPaths.filter((path) => existingPaths.has(path));
}

function getDiffLineClass(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff-meta';
  if (line.startsWith('+')) return 'diff-added';
  if (line.startsWith('-')) return 'diff-deleted';
  if (line.startsWith('@@')) return 'diff-hunk';
  if (line.startsWith('diff --git')) return 'diff-meta';
  return '';
}

function isVersionComponentMissing(message: string) {
  const normalized = message.toLowerCase();
  return message.includes('未找到 git 命令')
    || normalized.includes('git command not found')
    || normalized.includes('program not found')
    || normalized.includes('no such file or directory')
    || normalized.includes('os error 2');
}

function VersionComponentNotice() {
  return (
    <section className="git-section git-version-component-notice" aria-label="版本组件不可用">
      <div className="git-section-heading">需要启用团队版本能力</div>
      <p>
        MDBridge 需要一个版本组件来保存、同步和恢复团队文档。当前电脑还没有可用的版本组件。
      </p>
      <div className="git-version-component-actions">
        <button type="button" disabled>一键安装</button>
        <button type="button" disabled>查看安装说明</button>
      </div>
      <p className="git-hint">安装向导还在准备中；当前可以先继续编辑和发布文档。</p>
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getWorkspaceDisplayPath(workspaceRoot: string, relativePath: string): string {
  const rootName = getFileName(workspaceRoot.replace(/[/\\]$/, ''));
  const normalizedRelativePath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return rootName ? `${rootName}/${normalizedRelativePath}` : normalizedRelativePath;
}

function getRelativePath(path: string, repoRoot: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedRoot = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalizedPath === normalizedRoot) return getFileName(path);
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return getFileName(path);
}

function getGitFileStatusLabel(status: string): string {
  if (status.includes('U')) return '冲突';
  if (status.includes('R')) return '重命名';
  if (status.includes('D')) return '删除';
  if (status.includes('A') || status === '??') return '新增';
  if (status.includes('M')) return '修改';
  return status;
}

function getGitFileStatusKind(status: string): string {
  if (status.includes('U')) return 'conflict';
  if (status.includes('D')) return 'deleted';
  if (status.includes('A') || status === '??') return 'added';
  return 'modified';
}

function BranchIcon() {
  return (
    <svg className="git-panel-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3v12" />
      <path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M18 9c0 4-3 6-7 6H6" />
    </svg>
  );
}
