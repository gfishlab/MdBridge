import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import App from './App';

// Render the editor as a plain controlled textarea so tests can drive
// keystrokes deterministically instead of fighting the real MDEditor.
vi.mock('./components/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="editor"
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
    });
  }
  if (command === 'get_app_version') return Promise.resolve('0.1.4');
  if (command === 'check_for_updates') return Promise.resolve(false);
  return Promise.resolve(null);
}

afterEach(() => {
  vi.mocked(invoke).mockImplementation(defaultInvoke as never);
  vi.mocked(listen).mockImplementation(() => Promise.resolve(() => {}));
  vi.mocked(open).mockResolvedValue(null);
});

describe('App', () => {
  it('renders the toolbar actions', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /文件/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发布/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /帮助/ })).toBeInTheDocument();
  });
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
