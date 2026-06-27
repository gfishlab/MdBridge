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
      { name: 'draft', current: false },
      { name: 'main', current: true },
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
    expect(screen.getByText('draft')).toBeInTheDocument();
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
});
