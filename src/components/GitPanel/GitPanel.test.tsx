import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { GitPanel } from './GitPanel';

const status = {
  repo_root: '/repo/docs',
  branch: 'main',
  changed_files: 2,
  ahead: 1,
  behind: 0,
  has_remote: true,
};

const history = [
  {
    hash: '0123456789abcdef',
    short_hash: '0123456',
    author_name: 'Grace Hopper',
    author_email: 'grace@example.com',
    authored_at: '2026-06-27T09:12:30+08:00',
    summary: 'docs: update guide',
  },
];

function mockGitInvoke(command: string) {
  if (command === 'get_git_status') return Promise.resolve(status);
  if (command === 'get_git_branches') {
    return Promise.resolve([
      { name: 'draft', current: false, kind: 'local' },
      { name: 'main', current: true, kind: 'local' },
      { name: 'origin/main', current: false, kind: 'remote' },
      { name: 'release/v2', current: false, kind: 'recent' },
    ]);
  }
  if (command === 'get_git_commit_graph') {
    return Promise.resolve([
      {
        graph: '*',
        short_hash: '0123456',
        refs: 'HEAD -> main, origin/main',
        summary: 'docs: update guide',
      },
    ]);
  }
  if (command === 'get_git_file_history') return Promise.resolve(history);
  if (command === 'get_git_file_diff') {
    return Promise.resolve('diff --git a/guide.md b/guide.md\n+new line');
  }
  if (command === 'restore_git_file_revision') return Promise.resolve('# Restored\n');
  if (command === 'commit_git_file') return Promise.resolve({ message: '[main abc123] docs: update guide' });
  if (command === 'pull_git_repository') return Promise.resolve({ message: 'Already up to date.' });
  if (command === 'push_git_repository') return Promise.resolve({ message: 'Everything up-to-date' });
  return Promise.resolve(null);
}

function renderPanel(overrides = {}) {
  return render(
    <GitPanel
      workspacePath="/repo/docs"
      currentFile="/repo/docs/guide.md"
      hasLocalEdits={false}
      onBeforeGitAction={vi.fn(() => Promise.resolve())}
      onClose={vi.fn()}
      onRepositoryStatusChange={vi.fn()}
      onRestoreVersion={vi.fn()}
      onStatusChange={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GitPanel', () => {
  it('loads repository status, branches, file history and selected commit diff', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);

    renderPanel();

    const repoStatus = await screen.findByLabelText('仓库状态');
    expect(within(repoStatus).getByText('main')).toBeInTheDocument();
    expect(within(repoStatus).getByText('2 个修改')).toBeInTheDocument();
    const historySection = await screen.findByLabelText('当前文档历史');
    expect(within(historySection).getByText('docs: update guide')).toBeInTheDocument();
    expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0);
    expect(screen.getByText('本地分支')).toBeInTheDocument();
    expect(screen.getByText('远程分支')).toBeInTheDocument();
    expect(screen.getByText('最近分支')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('origin/main')).toBeInTheDocument();
    expect(screen.getByText('release/v2')).toBeInTheDocument();
    expect(screen.getByLabelText('提交路线')).toHaveTextContent('HEAD -> main, origin/main');
    expect(await screen.findByText(/\+new line/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('get_git_file_diff', {
      path: '/repo/docs/guide.md',
      commit: '0123456789abcdef',
    });
  });

  it('restores a selected historical revision into the active document', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onBeforeGitAction = vi.fn(() => Promise.resolve());
    const onRestoreVersion = vi.fn();

    renderPanel({ onBeforeGitAction, onRestoreVersion });

    fireEvent.click(await screen.findByRole('button', { name: '恢复此版本' }));

    await waitFor(() => {
      expect(onBeforeGitAction).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith('restore_git_file_revision', {
        path: '/repo/docs/guide.md',
        commit: '0123456789abcdef',
      });
      expect(onRestoreVersion).toHaveBeenCalledWith('# Restored\n');
    });
  });

  it('commits the current document with the user supplied message', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);
    const onBeforeGitAction = vi.fn(() => Promise.resolve());
    const onStatusChange = vi.fn();

    renderPanel({ onBeforeGitAction, onStatusChange });

    fireEvent.change(await screen.findByLabelText('提交信息'), {
      target: { value: 'docs: update guide' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交当前文档' }));

    await waitFor(() => {
      expect(onBeforeGitAction).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith('commit_git_file', {
        path: '/repo/docs/guide.md',
        message: 'docs: update guide',
      });
      expect(onStatusChange).toHaveBeenCalledWith('已提交当前文档');
    });
  });

  it('explains why an unsaved document cannot be committed', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);

    renderPanel({ currentFile: '' });

    expect(await screen.findByText('当前文档未保存，无法提交到 Git。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交当前文档' })).toBeDisabled();
  });

  it('shows push results inside the panel', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '推送' }));

    expect(await screen.findByText('Everything up-to-date')).toBeInTheDocument();
  });

  it('shows side-by-side conflict content after pull detects conflicts', async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'pull_git_repository') return Promise.reject('CONFLICT (content): Merge conflict in guide.md');
      if (command === 'get_git_conflicts') {
        return Promise.resolve([
          {
            path: 'guide.md',
            base: '# Base\n',
            ours: '# Current\n',
            theirs: '# Incoming\n',
          },
        ]);
      }
      return mockGitInvoke(command);
    }) as never);

    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '拉取' }));

    expect(await screen.findByText('冲突文件')).toBeInTheDocument();
    expect(screen.getByText('guide.md')).toBeInTheDocument();
    expect(screen.getByText('当前修改')).toBeInTheDocument();
    expect(screen.getByText('传入修改')).toBeInTheDocument();
    expect(screen.getByText('# Current')).toBeInTheDocument();
    expect(screen.getByText('# Incoming')).toBeInTheDocument();
  });
});
