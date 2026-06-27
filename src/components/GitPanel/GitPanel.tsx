import { useCallback, useEffect, useMemo, useState } from 'react';
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

interface GitBranch {
  name: string;
  current: boolean;
  kind: 'local' | 'remote' | 'recent' | string;
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

interface GitCommitGraphEntry {
  graph: string;
  short_hash: string;
  refs: string;
  summary: string;
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
  onBeforeGitAction: () => Promise<void>;
  onClose: () => void;
  onRepositoryStatusChange: (status: GitStatus | null) => void;
  onRestoreVersion: (content: string) => void;
  onStatusChange: (message: string) => void;
}

export function GitPanel({
  workspacePath,
  currentFile,
  hasLocalEdits,
  onBeforeGitAction,
  onClose,
  onRepositoryStatusChange,
  onRestoreVersion,
  onStatusChange,
}: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [history, setHistory] = useState<GitCommit[]>([]);
  const [commitGraph, setCommitGraph] = useState<GitCommitGraphEntry[]>([]);
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

  const selectedCommit = useMemo(
    () => history.find((commit) => commit.hash === selectedHash) ?? null,
    [history, selectedHash],
  );

  const loadRepository = useCallback(async () => {
    if (!workspacePath) {
      setStatus(null);
      setBranches([]);
      setHistory([]);
      setCommitGraph([]);
      setSelectedHash('');
      onRepositoryStatusChange(null);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextBranches, nextGraph, nextHistory] = await Promise.all([
        invoke<GitStatus>('get_git_status', { path: workspacePath }),
        invoke<GitBranch[]>('get_git_branches', { path: workspacePath }),
        invoke<GitCommitGraphEntry[]>('get_git_commit_graph', { path: workspacePath, limit: 80 }),
        currentFile
          ? invoke<GitCommit[]>('get_git_file_history', { path: currentFile, limit: 80 })
          : Promise.resolve([]),
      ]);

      setStatus(nextStatus);
      setBranches(Array.isArray(nextBranches) ? nextBranches : []);
      setCommitGraph(Array.isArray(nextGraph) ? nextGraph : []);
      setHistory(Array.isArray(nextHistory) ? nextHistory : []);
      setSelectedHash((current) => (
        Array.isArray(nextHistory) && nextHistory.some((commit) => commit.hash === current)
          ? current
          : Array.isArray(nextHistory) ? nextHistory[0]?.hash ?? '' : ''
      ));
      onRepositoryStatusChange(nextStatus);
    } catch (err) {
      setStatus(null);
      setBranches([]);
      setHistory([]);
      setCommitGraph([]);
      setSelectedHash('');
      setError(`无法读取 Git 信息: ${err}`);
      onRepositoryStatusChange(null);
    } finally {
      setLoading(false);
    }
  }, [currentFile, onRepositoryStatusChange, workspacePath]);

  useEffect(() => {
    loadRepository();
  }, [loadRepository]);

  useEffect(() => {
    let cancelled = false;
    if (!currentFile || !selectedHash) {
      setDiff('');
      return;
    }

    setDiffLoading(true);
    invoke<string>('get_git_file_diff', { path: currentFile, commit: selectedHash })
      .then((nextDiff) => {
        if (!cancelled) setDiff(nextDiff.trim() || '该提交没有当前文档的可显示差异。');
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
      if (label === '拉取') {
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
    const confirmed = window.confirm(`恢复到 ${selectedCommit.short_hash} 的版本？当前工作区文件会被覆盖。`);
    if (!confirmed) return;

    runAction('恢复版本', async () => {
      const content = await invoke<string>('restore_git_file_revision', {
        path: currentFile,
        commit: selectedCommit.hash,
      });
      onRestoreVersion(content);
      onStatusChange('已恢复历史版本到工作区');
    });
  };

  const handleCommit = () => {
    if (!currentFile || !commitMessage.trim()) return;

    runAction('提交', async () => {
      const result = await invoke<GitOperationResult>('commit_git_file', {
        path: currentFile,
        message: commitMessage.trim(),
      });
      setCommitMessage('');
      setOperationMessage(result.message || '已提交当前文档');
      onStatusChange('已提交当前文档');
    });
  };

  const handlePull = () => {
    if (!workspacePath) return;
    runAction('拉取', async () => {
      const result = await invoke<GitOperationResult>('pull_git_repository', { path: workspacePath });
      setConflicts([]);
      setSelectedConflictPath('');
      setOperationMessage(result.message || '已拉取远程更新');
      onStatusChange('已拉取远程更新');
    });
  };

  const handlePush = () => {
    if (!workspacePath) return;
    runAction('推送', async () => {
      const result = await invoke<GitOperationResult>('push_git_repository', { path: workspacePath });
      setOperationMessage(result.message || '已推送到远程仓库');
      onStatusChange('已推送到远程仓库');
    });
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

  const commitDisabledReason = !currentFile
    ? '当前文档未保存，无法提交到 Git。'
    : !commitMessage.trim()
      ? '填写提交信息后可提交当前文档。'
      : '';
  const selectedConflict = conflicts.find((conflict) => conflict.path === selectedConflictPath) ?? conflicts[0] ?? null;

  return (
    <aside className="git-panel" aria-label="版本历史">
      <div className="git-panel-header">
        <div className="git-panel-title">
          <BranchIcon />
          <div>
            <span>版本</span>
            <strong>Git 历史</strong>
          </div>
        </div>
        <button type="button" className="git-icon-btn" onClick={onClose} aria-label="关闭版本面板">
          ×
        </button>
      </div>

      {loading && <div className="git-panel-state">正在读取 Git 信息...</div>}
      {error && <div className="git-panel-error">{error}</div>}
      {operationMessage && <div className="git-panel-result">{operationMessage}</div>}

      {status && (
        <section className="git-section git-repo-summary" aria-label="仓库状态">
          <div>
            <span className="git-label">当前分支</span>
            <strong>{status.branch}</strong>
          </div>
          <span className={`git-change-pill ${status.changed_files > 0 ? 'dirty' : ''}`}>
            {status.changed_files} 个修改
          </span>
          {(status.ahead > 0 || status.behind > 0) && (
            <div className="git-sync-meta">
              {status.ahead > 0 && <span>领先 {status.ahead}</span>}
              {status.behind > 0 && <span>落后 {status.behind}</span>}
            </div>
          )}
          <div className="git-sync-actions">
            <button type="button" onClick={handlePull} disabled={!!actionLoading}>
              {actionLoading === '拉取' ? '拉取中...' : '拉取'}
            </button>
            <button type="button" onClick={handlePush} disabled={!!actionLoading}>
              {actionLoading === '推送' ? '推送中...' : '推送'}
            </button>
          </div>
        </section>
      )}

      <section className="git-section" aria-label="提交当前文档">
        <label className="git-input-block">
          <span>提交信息</span>
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="例如: docs: update publish guide"
            disabled={!currentFile || !!actionLoading}
            aria-describedby="git-commit-hint"
          />
        </label>
        <button
          type="button"
          className="git-primary-btn"
          onClick={handleCommit}
          disabled={!currentFile || !commitMessage.trim() || !!actionLoading}
        >
          {actionLoading === '提交' ? '提交中...' : '提交当前文档'}
        </button>
        {commitDisabledReason && <p id="git-commit-hint" className="git-hint">{commitDisabledReason}</p>}
        {hasLocalEdits && <p className="git-hint">提交前会先保存当前编辑内容。</p>}
      </section>

      <section className="git-section" aria-label="分支列表">
        <div className="git-section-heading">分支</div>
        <BranchGroup title="本地分支" branches={branches.filter((branch) => branch.kind === 'local')} />
        <BranchGroup title="远程分支" branches={branches.filter((branch) => branch.kind === 'remote')} />
        <BranchGroup title="最近分支" branches={branches.filter((branch) => branch.kind === 'recent')} />
      </section>

      <section className="git-section git-graph-section" aria-label="提交路线">
        <div className="git-section-heading">提交路线</div>
        {commitGraph.length === 0 && <span className="git-empty">没有可显示的提交路线。</span>}
        <div className="git-graph-list">
          {commitGraph.map((entry) => (
            <div key={`${entry.short_hash}-${entry.summary}`} className="git-graph-row">
              <code className="git-graph-ascii">{entry.graph || '*'}</code>
              <code>{entry.short_hash}</code>
              {entry.refs && <span className="git-graph-refs">{entry.refs}</span>}
              <span>{entry.summary || '(无提交说明)'}</span>
            </div>
          ))}
        </div>
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

      <section className="git-section git-history-section" aria-label="当前文档历史">
        <div className="git-section-heading">当前文档历史</div>
        {!currentFile && <div className="git-empty">保存或打开一个 Markdown 文件后可查看历史。</div>}
        {currentFile && history.length === 0 && !loading && (
          <div className="git-empty">当前文档还没有 Git 历史。</div>
        )}
        <div className="git-history-list">
          {history.map((commit) => (
            <button
              key={commit.hash}
              type="button"
              className={`git-commit-item ${commit.hash === selectedHash ? 'selected' : ''}`}
              onClick={() => setSelectedHash(commit.hash)}
            >
              <span className="git-commit-summary">{commit.summary || '(无提交说明)'}</span>
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
        <section className="git-section git-diff-section" aria-label="提交差异">
          <div className="git-diff-heading">
            <div>
              <span className="git-label">提交详情</span>
              <strong>{selectedCommit.summary || selectedCommit.short_hash}</strong>
            </div>
            <button
              type="button"
              className="git-secondary-btn"
              onClick={handleRestore}
              disabled={!!actionLoading}
            >
              恢复此版本
            </button>
          </div>
          <div className="git-author-line">
            {selectedCommit.author_name}
            {selectedCommit.author_email && <span>{selectedCommit.author_email}</span>}
          </div>
          <pre className="git-diff">{diffLoading ? '正在读取差异...' : diff}</pre>
        </section>
      )}
    </aside>
  );
}

function BranchGroup({ title, branches }: { title: string; branches: GitBranch[] }) {
  return (
    <div className="git-branch-group">
      <div className="git-branch-group-title">{title}</div>
      <div className="git-branch-list">
        {branches.length === 0 && <span className="git-empty">没有可显示的{title}</span>}
        {branches.map((branch) => (
          <span key={`${branch.kind}-${branch.name}`} className={`git-branch ${branch.current ? 'current' : ''}`}>
            {branch.name}
          </span>
        ))}
      </div>
    </div>
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
