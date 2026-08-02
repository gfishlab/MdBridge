import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import App, { getStartupFileFromSearch, getStartupFolderFromSearch } from './App';

// Render the editor as a plain controlled textarea so tests can drive
// keystrokes deterministically instead of fighting the real MDEditor.
vi.mock('./components/Editor', () => ({
  Editor: ({
    value,
    onChange,
    colorMode,
  }: {
    value: string;
    onChange: (v: string) => void;
    colorMode: string;
  }) => (
    <textarea
      data-testid="editor"
      data-color-mode={colorMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Mirrors the default invoke handler from src/test/setup.ts so tests that
// override the implementation can restore it afterwards.
function defaultInvoke(command: string) {
  if (command === 'get_platforms') return Promise.resolve([]);
  if (command === 'get_config') {
      return Promise.resolve({
        image_cache_size_mb: 500,
        default_platform: 'wechat',
        check_updates_on_startup: false,
        theme_preference: 'system',
        text_style: 'standard',
        recent_files: [],
        recent_folders: [],
      });
  }
  if (command === 'get_app_version') return Promise.resolve('0.1.4');
  if (command === 'check_for_updates') return Promise.resolve(false);
  return Promise.resolve(null);
}

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(defaultInvoke as never);
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockImplementation(() => Promise.resolve(() => {}));
  vi.mocked(open).mockReset();
  vi.mocked(open).mockResolvedValue(null);
  vi.mocked(save).mockReset();
  vi.mocked(save).mockResolvedValue(null);
  window.history.pushState({}, '', '/');
});

async function openSelectedMarkdownFile() {
  fireEvent.click(screen.getByRole('button', { name: '文件' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开文件' }));
}

describe('App', () => {
  it('renders the toolbar actions', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /文件/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发布/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /帮助/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '视图' })).not.toBeInTheDocument();
  });

  it('keeps the file tree toggle in the file menu', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    expect(screen.getByRole('button', { name: '显示文件树' })).toBeDisabled();
  });

  it('applies configured theme and text style on startup', async () => {
    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'get_config') {
        return Promise.resolve({
          image_cache_size_mb: 500,
          default_platform: 'wechat',
          check_updates_on_startup: false,
          theme_preference: 'dark',
          text_style: 'large',
          recent_files: [],
          recent_folders: [],
        });
      }
      return defaultInvoke(command);
    }) as never);

    const { container } = render(<App />);
    const app = container.querySelector('.app');

    await waitFor(() => {
      expect(app).toHaveAttribute('data-theme', 'dark');
      expect(app).toHaveAttribute('data-theme-appearance', 'dark');
      expect(app).toHaveAttribute('data-text-style', 'large');
      expect(screen.getByTestId('editor')).toHaveAttribute('data-color-mode', 'dark');
    });
  });

  it('saves theme and text style from settings', async () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /设置/ }));
    await screen.findByRole('heading', { name: '设置' });

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'solarized' } });
    fireEvent.change(selects[1], { target: { value: 'comfortable' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_config', {
        updates: expect.objectContaining({
          theme_preference: 'solarized',
          text_style: 'comfortable',
        }),
      });
      expect(container.querySelector('.app')).toHaveAttribute('data-theme', 'solarized');
      expect(container.querySelector('.app')).toHaveAttribute('data-text-style', 'comfortable');
    });
  });

  it('syncs appearance when another window updates config', async () => {
    let configUpdatedHandler:
      | ((event: { payload: {
        theme_preference: string;
        text_style: string;
        recent_files: string[];
        recent_folders: string[];
      } }) => void)
      | null = null;

    vi.mocked(listen).mockImplementation((event: string, handler: unknown) => {
      if (event === 'config-updated') {
        configUpdatedHandler = handler as typeof configUpdatedHandler;
      }
      return Promise.resolve(() => {});
    });

    const { container } = render(<App />);
    await waitFor(() => expect(configUpdatedHandler).not.toBeNull());

    act(() => {
      configUpdatedHandler?.({
        payload: {
          theme_preference: 'dark',
          text_style: 'compact',
          recent_files: [],
          recent_folders: [],
        },
      });
    });

    expect(container.querySelector('.app')).toHaveAttribute('data-theme', 'dark');
    expect(container.querySelector('.app')).toHaveAttribute('data-text-style', 'compact');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-color-mode', 'dark');
  });

  it('parses startup file paths from the window query string', () => {
    const path = '/test/中文 file.md';
    expect(getStartupFileFromSearch(`?file=${encodeURIComponent(path)}`)).toBe(path);
  });

  it('parses startup folder paths from the window query string', () => {
    const path = '/test/中文 folder';
    expect(getStartupFolderFromSearch(`?folder=${encodeURIComponent(path)}`)).toBe(path);
  });

  it('loads the startup file passed to a document window', async () => {
    const FILE = '/test/startup.md';
    window.history.pushState({}, '', `/?file=${encodeURIComponent(FILE)}`);

    vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
      if (command === 'read_file') {
        expect(args).toEqual({ path: FILE });
        return Promise.resolve('startup content');
      }
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    await screen.findByText(FILE);
    expect(screen.getByTestId('editor')).toHaveValue('startup content');
  });

  it('opens the startup folder passed to a document window', async () => {
    const FOLDER = '/test/startup-folder';
    window.history.pushState({}, '', `/?folder=${encodeURIComponent(FOLDER)}`);

    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'read_folder') return Promise.resolve([]);
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('watch_folder', { path: FOLDER });
      expect(invoke).toHaveBeenCalledWith('update_config', {
        updates: {
          recent_files: [],
          recent_folders: [FOLDER],
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '隐藏文件树' }));
    expect(document.querySelector('.file-tree-wrapper')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    expect(screen.getByRole('button', { name: '显示文件树' })).not.toBeDisabled();
  });

  it('opens a blank MDBridge window from the file menu', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '新建窗口' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_new_window');
    });
    expect(screen.getByText('已打开新窗口')).toBeInTheDocument();
  });

  it('opens a selected markdown file in a separate window', async () => {
    const FILE = '/test/new-window.md';
    vi.mocked(open).mockResolvedValue(FILE);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '在新窗口打开文件' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_file_in_new_window', { path: FILE });
    });
    expect(screen.getByText('已在新窗口打开')).toBeInTheDocument();
  });

  it('opens a selected folder in a separate window', async () => {
    const FOLDER = '/test/new-window-folder';
    vi.mocked(open).mockResolvedValue(FOLDER);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '在新窗口打开文件夹' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_folder_in_new_window', { path: FOLDER });
      expect(invoke).toHaveBeenCalledWith('update_config', {
        updates: {
          recent_files: [],
          recent_folders: [FOLDER],
        },
      });
    });
    expect(screen.getByText('已在新窗口打开文件夹')).toBeInTheDocument();
  });

  it('opens multiple markdown files as tabs in the same window', async () => {
    const FILE_A = '/test/a.md';
    const FILE_B = '/test/b.md';
    vi.mocked(open).mockResolvedValueOnce(FILE_A).mockResolvedValueOnce(FILE_B);

    vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
      if (command === 'read_file') {
        const a = (args ?? {}) as { path: string };
        return Promise.resolve(`${a.path} content`);
      }
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    await screen.findByText(FILE_A);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    await screen.findByText(FILE_B);

    expect(screen.getByRole('tab', { name: /a\.md/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /b\.md/ })).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toHaveValue(`${FILE_B} content`);

    fireEvent.click(screen.getByRole('tab', { name: /a\.md/ }));

    await waitFor(() => {
      expect(screen.getByTestId('editor')).toHaveValue(`${FILE_A} content`);
    });
  });


  it('adds opened markdown files to the recent file menu', async () => {
    const FILE = '/test/recent-file.md';
    vi.mocked(open).mockResolvedValue(FILE);

    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'read_file') return Promise.resolve('recent file content');
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_config', {
        updates: {
          recent_files: [FILE],
          recent_folders: [],
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    expect(screen.getByText('最近打开的文件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'recent-file.md' }));

    await waitFor(() => {
      expect(screen.getByTestId('editor')).toHaveValue('recent file content');
    });
  });

  it('opens recent folders from the file menu', async () => {
    const FOLDER = '/test/recent-folder';

    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'get_config') {
        return Promise.resolve({
          image_cache_size_mb: 500,
          default_platform: 'wechat',
          check_updates_on_startup: false,
          theme_preference: 'system',
          text_style: 'standard',
          recent_files: [],
          recent_folders: [FOLDER],
        });
      }
      if (command === 'read_folder') return Promise.resolve([]);
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    await screen.findByText('最近打开的文件夹');
    fireEvent.click(screen.getByRole('button', { name: 'recent-folder' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('watch_folder', { path: FOLDER });
      expect(invoke).toHaveBeenCalledWith('update_config', {
        updates: {
          recent_files: [],
          recent_folders: [FOLDER],
        },
      });
    });
  });

  it('activates an existing tab when the same markdown file is opened again', async () => {
    const FILE = '/test/same.md';
    vi.mocked(open).mockResolvedValueOnce(FILE).mockResolvedValueOnce(FILE);

    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'read_file') return Promise.resolve('same file content');
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE);

    await openSelectedMarkdownFile();

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: /same\.md/ })).toHaveLength(1);
    });
  });

  it('restores a default untitled tab after closing the final tab', async () => {
    const FILE = '/test/final.md';
    vi.mocked(open).mockResolvedValue(FILE);

    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'read_file') return Promise.resolve('final content');
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE);

    fireEvent.click(screen.getByRole('button', { name: '关闭 final.md' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /未命名/ })).toBeInTheDocument();
    });
    expect(screen.getByTestId('editor')).toHaveValue('# Hello MDBridge\n\nStart writing...');
  });

  it('supports tab context menu batch close actions', async () => {
    const FILE_A = '/test/a.md';
    const FILE_B = '/test/b.md';
    const FILE_C = '/test/c.md';
    vi.mocked(open)
      .mockResolvedValueOnce(FILE_A)
      .mockResolvedValueOnce(FILE_B)
      .mockResolvedValueOnce(FILE_C)
      .mockResolvedValueOnce(FILE_C)
      .mockResolvedValueOnce(FILE_A);

    vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
      if (command === 'read_file') {
        const a = (args ?? {}) as { path: string };
        return Promise.resolve(`${a.path} content`);
      }
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE_A);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE_B);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE_C);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /b\.md/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭右侧标签页' }));

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /c\.md/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /a\.md/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /b\.md/ })).toBeInTheDocument();

    await openSelectedMarkdownFile();
    await screen.findByText(FILE_C);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /b\.md/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭左侧标签页' }));

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /a\.md/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /b\.md/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /c\.md/ })).toBeInTheDocument();

    await openSelectedMarkdownFile();
    await screen.findByText(FILE_A);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /c\.md/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭其他标签页' }));

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /a\.md/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /b\.md/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /c\.md/ })).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toHaveValue(`${FILE_C} content`);
  });

  it('closes all tabs from the tab context menu', async () => {
    const FILE_A = '/test/a.md';
    const FILE_B = '/test/b.md';
    vi.mocked(open).mockResolvedValueOnce(FILE_A).mockResolvedValueOnce(FILE_B);

    vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
      if (command === 'read_file') {
        const a = (args ?? {}) as { path: string };
        return Promise.resolve(`${a.path} content`);
      }
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE_A);

    await openSelectedMarkdownFile();
    await screen.findByText(FILE_B);

    fireEvent.contextMenu(screen.getByRole('tab', { name: /a\.md/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭全部标签页' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /未命名/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: /a\.md/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /b\.md/ })).not.toBeInTheDocument();
  });
});

describe('App debounced auto-save', () => {
  it('auto-saves to disk after the user stops typing', async () => {
    const FILE = '/test/auto.md';
    vi.mocked(open).mockResolvedValue(FILE);

    const writeCalls: Array<{ path: string; content: string }> = [];
    vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
      if (command === 'read_file') return Promise.resolve('initial');
      if (command === 'write_file') {
        const a = (args ?? {}) as { path: string; content: string };
        writeCalls.push({ path: a.path, content: a.content });
        return Promise.resolve(null);
      }
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    await screen.findByText(FILE);
    expect(screen.getByTestId('editor')).toHaveValue('initial');

    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'local edit' },
    });

    // Before the debounce window elapses, nothing has been written.
    expect(writeCalls).toHaveLength(0);

    // After the debounce window (800ms), the edit is persisted to disk.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toEqual({ path: FILE, content: 'local edit' });
    expect(screen.getByText('已自动保存')).toBeInTheDocument();
  }, 10000);

  it('flushes pending edits before switching to another file', async () => {
    const FILE_A = '/test/a.md';
    const FILE_B = '/test/b.md';

    // Single global log to assert call ORDER between write and read.
    const callLog: string[] = [];
    vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
      if (command === 'read_file') {
        const a = (args ?? {}) as { path: string };
        callLog.push(`read:${a.path}`);
        if (a.path === FILE_A) return Promise.resolve('a-initial');
        return Promise.resolve('b-initial');
      }
      if (command === 'write_file') {
        const a = (args ?? {}) as { path: string; content: string };
        callLog.push(`write:${a.path}:${a.content}`);
        return Promise.resolve(null);
      }
      return defaultInvoke(command);
    }) as never);

    vi.mocked(open).mockResolvedValueOnce(FILE_A).mockResolvedValueOnce(FILE_B);

    render(<App />);

    // Open file A.
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    await screen.findByText(FILE_A);

    // Edit without waiting for the debounce timer.
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'a-edited' },
    });

    // Open file B before 800ms elapses.
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    await screen.findByText(FILE_B);

    // A must have been flushed (written) BEFORE B was read.
    const aWriteIdx = callLog.indexOf(`write:${FILE_A}:a-edited`);
    const bReadIdx = callLog.indexOf(`read:${FILE_B}`);
    expect(aWriteIdx).toBeGreaterThanOrEqual(0);
    expect(bReadIdx).toBeGreaterThanOrEqual(0);
    expect(aWriteIdx).toBeLessThan(bReadIdx);
  }, 10000);

  it('does not double-save when manual save overlaps the debounce window', async () => {
    const FILE = '/test/single.md';
    vi.mocked(open).mockResolvedValue(FILE);

    const writeCalls: string[] = [];
    vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
      if (command === 'read_file') return Promise.resolve('initial');
      if (command === 'write_file') {
        const a = (args ?? {}) as { path: string; content: string };
        writeCalls.push(`${a.path}:${a.content}`);
        return Promise.resolve(null);
      }
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    await screen.findByText(FILE);

    // Type, which schedules a debounced save.
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'edited' },
    });

    // Manually save immediately (Cmd+S).
    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
      await Promise.resolve();
    });

    // Let the debounce window elapse — the pending timer must NOT fire again.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });

    // write_file should have been called exactly once for this content.
    expect(writeCalls).toEqual([`${FILE}:edited`]);
  }, 10000);
});

describe('App external reload race', () => {
  it('does not clobber a keystroke that lands while an external reload is mid-read', async () => {
    const FILE = '/test/file.md';
    let readCount = 0;
    let resolveReload: (content: string) => void = () => {};
    let fileSystemChangeHandler:
      | ((event: { payload: { paths: string[] } }) => void)
      | null = null;

    vi.mocked(open).mockResolvedValue(FILE);

    vi.mocked(listen).mockImplementation((event: string, handler: unknown) => {
      if (event === 'file-system-changed') {
        fileSystemChangeHandler = handler as typeof fileSystemChangeHandler;
      }
      return Promise.resolve(() => {});
    });

    vi.mocked(invoke).mockImplementation(((command: string) => {
      if (command === 'read_file') {
        readCount += 1;
        // First read = opening the file. Resolve immediately.
        if (readCount === 1) return Promise.resolve('initial content');
        // Second read = the external reload. Hold it open so a keystroke
        // can land during the read window.
        return new Promise<string>((res) => {
          resolveReload = res;
        });
      }
      return defaultInvoke(command);
    }) as never);

    render(<App />);

    // Open a file so there is an active file to reload.
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));

    await screen.findByText(FILE);
    expect(screen.getByTestId('editor')).toHaveValue('initial content');

    // External change arrives for the active file -> schedules a reload read.
    act(() => {
      fileSystemChangeHandler?.({ payload: { paths: [FILE] } });
    });

    // Wait until the reload's read_file call is in flight (awaiting our resolve).
    await waitFor(() => expect(readCount).toBe(2));

    // A keystroke lands while the read is still pending.
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'local edit while reloading' },
    });
    expect(screen.getByTestId('editor')).toHaveValue('local edit while reloading');

    // The external read now resolves with stale content.
    await act(async () => {
      resolveReload('STALE EXTERNAL CONTENT');
      await Promise.resolve();
    });

    // The local edit must survive; the stale content must be discarded.
    expect(screen.getByTestId('editor')).toHaveValue('local edit while reloading');
    expect(screen.queryByText('已刷新外部修改')).not.toBeInTheDocument();
  });
});
