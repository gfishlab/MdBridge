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
  if (command === 'get_git_changed_files') {
    return Promise.resolve([
      { path: 'guide.md', status: 'M', staged: false },
      { path: 'notes/draft.md', status: '??', staged: false },
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
  if (command === 'get_git_worktree_file_diff') {
    return Promise.resolve('diff --git a/guide.md b/guide.md\n-old line\n+new line');
  }
  if (command === 'restore_git_file_revision') return Promise.resolve('# Restored\n');
  if (command === 'commit_git_file') return Promise.resolve({ message: '[main abc123] docs: update guide' });
  if (command === 'commit_git_files') return Promise.resolve({ message: '[main abc123] docs: update selected files' });
  if (command === 'fetch_git_repository') return Promise.resolve({ message: 'Fetched origin' });
  if (command === 'pull_git_repository') return Promise.resolve({ message: 'Already up to date.' });
  if (command === 'push_git_repository') return Promise.resolve({ message: 'Everything up-to-date' });
  if (command === 'rollback_git_changed_file') return Promise.resolve({ message: '已回滚 guide.md 的改动' });
  return Promise.resolve(null);
}

function renderPanel(overrides = {}) {
  return render(
    <GitPanel
      workspacePath="/repo/docs"
      currentFile="/repo/docs/guide.md"
      hasLocalEdits={false}
      selectedChangedFilePath=""
      onBeforeGitAction={vi.fn(() => Promise.resolve())}
      onChangedFileSelect={vi.fn()}
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
  it('loads version status, changed file diff and selected version diff', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);

    renderPanel();

    const repoStatus = await screen.findByLabelText('版本状态');
    expect(within(repoStatus).getByText('2 个改动待保存')).toBeInTheDocument();
    expect(within(repoStatus).getByText('2 个改动')).toBeInTheDocument();
    expect(within(repoStatus).queryByRole('button', { name: 'Fetch 更新' })).not.toBeInTheDocument();
    expect(within(repoStatus).queryByRole('button', { name: 'Pull 拉取' })).not.toBeInTheDocument();
    expect(within(repoStatus).queryByRole('button', { name: 'Push 推送' })).not.toBeInTheDocument();

    expect(screen.queryByLabelText('分支列表')).not.toBeInTheDocument();

    const historySection = await screen.findByLabelText('版本记录');
    expect(within(historySection).getByText('docs: update guide')).toBeInTheDocument();
    expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0);
    expect(screen.getAllByText('guide.md').length).toBeGreaterThan(0);
    expect(screen.getByText('draft.md')).toBeInTheDocument();
    expect(screen.getByText('docs/notes/draft.md')).toBeInTheDocument();
    expect(screen.getByLabelText('选择 guide.md')).toBeChecked();
    expect(screen.getByLabelText('选择 notes/draft.md')).toBeChecked();
    expect(screen.queryByText('高级：工作区信息')).not.toBeInTheDocument();
    expect(screen.queryByText('高级：版本路线')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('改动内容')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('get_git_worktree_file_diff', expect.anything());
    expect(invoke).toHaveBeenCalledWith('get_git_file_diff', {
      path: '/repo/docs/guide.md',
      commit: '0123456789abcdef',
    });
  });

  it('shows a productized setup notice when the version component is unavailable', async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'get_git_status') return Promise.reject('未找到 git 命令，请先安装 Git');
      return Promise.resolve([]);
    }) as never);

    renderPanel();

    const notice = await screen.findByLabelText('版本组件不可用');
    expect(within(notice).getByText('需要启用团队版本能力')).toBeInTheDocument();
    expect(within(notice).getByText(/当前电脑还没有可用的版本组件/)).toBeInTheDocument();
    expect(within(notice).getByRole('button', { name: '一键安装' })).toBeDisabled();
    expect(within(notice).getByRole('button', { name: '查看安装说明' })).toBeDisabled();
    expect(screen.queryByText(/未找到 git 命令/)).not.toBeInTheDocument();
  });

  it('restores a selected historical revision into the active document', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onBeforeGitAction = vi.fn(() => Promise.resolve());
    const onRestoreVersion = vi.fn();

    renderPanel({ onBeforeGitAction, onRestoreVersion });

    fireEvent.click(await screen.findByRole('button', { name: '恢复到这个版本' }));

    await waitFor(() => {
      expect(onBeforeGitAction).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith('restore_git_file_revision', {
        path: '/repo/docs/guide.md',
        commit: '0123456789abcdef',
      });
      expect(onRestoreVersion).toHaveBeenCalledWith('# Restored\n');
    });
  });

  it('saves a version for selected changed files with the user supplied message', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);
    const onBeforeGitAction = vi.fn(() => Promise.resolve());
    const onStatusChange = vi.fn();

    renderPanel({ onBeforeGitAction, onStatusChange });

    fireEvent.change(await screen.findByLabelText('版本说明'), {
      target: { value: 'docs: update guide' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存一个版本' }));

    await waitFor(() => {
      expect(onBeforeGitAction).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith('commit_git_files', {
        path: '/repo/docs',
        filePaths: ['guide.md', 'notes/draft.md'],
        message: 'docs: update guide',
      });
      expect(onStatusChange).toHaveBeenCalledWith('已保存一个版本');
    });
  });

  it('supports selecting and clearing all changed files before saving a version', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);

    renderPanel();

    expect(await screen.findByLabelText('选择 guide.md')).toBeChecked();
    expect(screen.getByLabelText('选择 notes/draft.md')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '取消勾选' }));

    expect(screen.getByLabelText('选择 guide.md')).not.toBeChecked();
    expect(screen.getByLabelText('选择 notes/draft.md')).not.toBeChecked();
    expect(screen.getByRole('button', { name: '保存一个版本' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '全选' }));

    expect(screen.getByLabelText('选择 guide.md')).toBeChecked();
    expect(screen.getByLabelText('选择 notes/draft.md')).toBeChecked();
  });

  it('supports resizing the version center from its right edge', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);

    renderPanel();

    const panel = await screen.findByLabelText('版本中心');
    const resizer = screen.getByRole('separator', { name: '调整版本中心宽度' });

    fireEvent.mouseDown(resizer, { clientX: 420 });
    fireEvent.mouseMove(window, { clientX: 620 });
    fireEvent.mouseUp(window);

    expect(panel).toHaveStyle({ width: '620px' });
  });

  it('notifies the parent when a changed file is selected', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);
    const onChangedFileSelect = vi.fn();

    renderPanel({ onChangedFileSelect });

    fireEvent.click(await screen.findByRole('button', { name: '查看 notes/draft.md 的改动' }));

    await waitFor(() => {
      expect(onChangedFileSelect).toHaveBeenCalledWith({
        path: 'notes/draft.md',
        status: '??',
        staged: false,
      });
    });
  });

  it('keeps repository changes selectable when the active document is unsaved', async () => {
    vi.mocked(invoke).mockImplementation(mockGitInvoke as never);

    renderPanel({ currentFile: '' });

    expect(await screen.findByLabelText('选择 guide.md')).toBeChecked();
    expect(screen.getByText('保存或打开一个 Markdown 文件后可查看历史。')).toBeInTheDocument();
    expect(screen.getByText('填写版本说明后可保存版本。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存一个版本' })).toBeDisabled();
  });

});
