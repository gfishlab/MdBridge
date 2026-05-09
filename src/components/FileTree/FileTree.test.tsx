import { render, screen, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';

describe('FileTree live refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(invoke).mockReset();
  });

  it('refreshes the folder tree while a folder is open', async () => {
    let readCount = 0;
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command !== 'read_folder') return Promise.resolve(null);

      readCount += 1;
      if (readCount === 1) return Promise.resolve([]);

      return Promise.resolve([
        {
          name: 'codex-live-refresh.md',
          path: '/tmp/docs/codex-live-refresh.md',
          is_dir: false,
          children: null,
        },
      ]);
    });

    render(
      <FileTree
        folderPath="/tmp/docs"
        onFileSelect={vi.fn()}
        currentFile=""
        newFileTrigger={0}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledWith('read_folder', { path: '/tmp/docs' });
    expect(screen.queryByText('codex-live-refresh.md')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(screen.getByText('codex-live-refresh.md')).toBeInTheDocument();
  });
});
