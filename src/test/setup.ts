import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string) => {
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
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(() => Promise.resolve(null)),
  save: vi.fn(() => Promise.resolve(null)),
}));
