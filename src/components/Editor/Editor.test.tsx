import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, resolvePreviewImageSource } from './Editor';

vi.mock('@uiw/react-md-editor', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (value?: string) => void }) => (
    <textarea
      aria-label="Markdown 编辑器"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.unstubAllGlobals();
});

describe('Editor image paste', () => {
  const resizeObserver = class {
    observe() {}
    disconnect() {}
  };

  it('inserts a pasted HTTP image link as Markdown', async () => {
    vi.stubGlobal('ResizeObserver', resizeObserver);
    vi.mocked(invoke).mockResolvedValueOnce({
      markdown: '![cover](https://img.example.com/cover.png)',
    });
    const onInsertMarkdown = vi.fn(() => true);

    render(
      <Editor
        value="before"
        onChange={vi.fn()}
        onInsertMarkdown={onInsertMarkdown}
        onStatusChange={vi.fn()}
        documentPath="/tmp/article.md"
        colorMode="light"
      />,
    );

    const editor = screen.getByRole('textbox', { name: 'Markdown 编辑器' }) as HTMLTextAreaElement;
    editor.setSelectionRange(2, 4);
    fireEvent.paste(editor, {
      clipboardData: {
        items: [],
        getData: () => 'https://img.example.com/cover.png',
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('format_image_link', {
        url: 'https://img.example.com/cover.png',
      });
    });
    expect(onInsertMarkdown).toHaveBeenCalledWith(
      '![cover](https://img.example.com/cover.png)',
      2,
      4,
      'before',
    );
  });

  it('imports a pasted image file before inserting Markdown', async () => {
    vi.stubGlobal('ResizeObserver', resizeObserver);
    vi.mocked(invoke).mockResolvedValueOnce({ markdown: '![clipboard](assets/image.png)' });
    const onInsertMarkdown = vi.fn(() => true);
    const image = new File(['png'], 'clipboard.png', { type: 'image/png' });
    Object.defineProperty(image, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('png').buffer,
    });

    render(
      <Editor
        value="before"
        onChange={vi.fn()}
        onInsertMarkdown={onInsertMarkdown}
        onStatusChange={vi.fn()}
        documentPath="/tmp/article.md"
        colorMode="light"
      />,
    );

    const editor = screen.getByRole('textbox', { name: 'Markdown 编辑器' }) as HTMLTextAreaElement;
    editor.setSelectionRange(1, 1);
    fireEvent.paste(editor, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        getData: () => '',
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('import_pasted_image', {
        dataBase64: 'cG5n',
        mimeType: 'image/png',
        fileName: 'clipboard.png',
        documentPath: '/tmp/article.md',
      });
    });
    expect(onInsertMarkdown).toHaveBeenCalledWith(
      '![clipboard](assets/image.png)',
      1,
      1,
      'before',
    );
  });
});

describe('Editor local image preview', () => {
  it('resolves a relative image against the current document before using the asset protocol', () => {
    expect(resolvePreviewImageSource('assets/cover image.png', '/tmp/posts/article.md')).toBe(
      'asset://localhost/%2Ftmp%2Fposts%2Fassets%2Fcover%20image.png',
    );
    expect(convertFileSrc).toHaveBeenCalledWith('/tmp/posts/assets/cover image.png');
  });

  it('keeps HTTP image URLs unchanged', () => {
    expect(resolvePreviewImageSource('https://img.example.com/cover.png', '/tmp/article.md')).toBe(
      'https://img.example.com/cover.png',
    );
  });

  it('passes Windows absolute and UNC paths directly to the asset protocol', () => {
    resolvePreviewImageSource('C:/Users/Me/Pictures/cover.png', 'C:/docs/article.md');
    resolvePreviewImageSource('\\\\server\\share\\cover.png', 'C:/docs/article.md');

    expect(convertFileSrc).toHaveBeenCalledWith('C:/Users/Me/Pictures/cover.png');
    expect(convertFileSrc).toHaveBeenCalledWith('\\\\server\\share\\cover.png');
  });
});
