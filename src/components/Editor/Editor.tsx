import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import MDEditor from '@uiw/react-md-editor';
import remarkCjkFriendly from 'remark-cjk-friendly';
import type { ThemeAppearance } from '../../preferences';

const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onInsertMarkdown: (
    markdown: string,
    selectionStart: number,
    selectionEnd: number,
    expectedValue: string,
  ) => boolean;
  onStatusChange: (message: string) => void;
  documentPath: string;
  colorMode: ThemeAppearance;
}

interface ImageImportResult {
  markdown: string;
}

type RehypeNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
};

export function Editor({
  value,
  onChange,
  onInsertMarkdown,
  onStatusChange,
  documentPath,
  colorMode,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setEditorHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const insertImportedImage = (
    textarea: HTMLTextAreaElement,
    markdown: string,
    selectionStart: number,
    selectionEnd: number,
    expectedValue: string,
  ): boolean => {
    if (!onInsertMarkdown(markdown, selectionStart, selectionEnd, expectedValue)) {
      return false;
    }
    requestAnimationFrame(() => {
      const cursor = selectionStart + markdown.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
    return true;
  };

  const handlePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const textarea = event.target instanceof HTMLTextAreaElement
      ? event.target
      : containerRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) return;

    const imageItem = Array.from(event.clipboardData.items).find((item) => (
      item.kind === 'file' && item.type.startsWith('image/')
    ));
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const expectedValue = textarea.value;

    if (imageItem) {
      const image = imageItem.getAsFile();
      if (!image) return;

      event.preventDefault();
      if (image.size > MAX_CLIPBOARD_IMAGE_BYTES) {
        onStatusChange('图片过大，最大支持 20 MiB');
        return;
      }
      onStatusChange('正在导入图片...');
      try {
        const dataBase64 = await fileToBase64(image);
        const result = await invoke<ImageImportResult>('import_pasted_image', {
          dataBase64,
          mimeType: image.type || 'image/png',
          fileName: image.name || null,
          documentPath: documentPath || null,
        });
        if (insertImportedImage(textarea, result.markdown, selectionStart, selectionEnd, expectedValue)) {
          onStatusChange('图片已插入');
        } else {
          onStatusChange('图片导入完成，但编辑内容已变化，未插入内容');
        }
      } catch (error) {
        onStatusChange(`图片导入失败: ${String(error)}`);
      }
      return;
    }

    const text = event.clipboardData.getData('text/plain').trim();
    if (!isStandaloneHttpUrl(text)) return;

    event.preventDefault();
    try {
      const result = await invoke<ImageImportResult>('format_image_link', { url: text });
      if (insertImportedImage(textarea, result.markdown, selectionStart, selectionEnd, expectedValue)) {
        onStatusChange('图片链接已插入');
      } else {
        onStatusChange('图片链接已准备，但编辑内容已变化，未插入内容');
      }
    } catch (error) {
      onStatusChange(`图片链接插入失败: ${String(error)}`);
    }
  };

  return (
    <div
      className="editor-container"
      ref={containerRef}
      data-color-mode={colorMode}
      onPaste={handlePaste}
    >
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || '')}
        preview="live"
        height={editorHeight || '100%'}
        visibleDragbar={false}
        previewOptions={{
          // 修复中文 + 全角标点旁加粗/斜体语法失效问题（CommonMark flanking 缺陷）
          remarkPlugins: [remarkCjkFriendly],
          rehypeRewrite: (node: RehypeNode) => {
            if (node.type !== 'element' || node.tagName !== 'img') return;
            const source = node.properties?.src;
            if (typeof source !== 'string') return;
            node.properties!.src = resolvePreviewImageSource(source, documentPath);
          },
        }}
      />
    </div>
  );
}

export function resolvePreviewImageSource(source: string, documentPath: string): string {
  if (isExternalImageSource(source)) return source;

  const localPath = isAbsoluteLocalPath(source)
    ? source
    : resolveRelativeImagePath(source, documentPath);
  return localPath ? convertFileSrc(localPath) : source;
}

function isExternalImageSource(source: string): boolean {
  return /^(?:https?:|data:|blob:|asset:|file:)/i.test(source);
}

function isAbsoluteLocalPath(source: string): boolean {
  return source.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(source)
    || /^[\\/]{2}/.test(source);
}

function resolveRelativeImagePath(source: string, documentPath: string): string | null {
  if (!documentPath) return null;
  const separator = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'));
  if (separator === -1) return null;
  const directory = documentPath.slice(0, separator).replace(/\\/g, '/');
  return normalizePosixPath(`${directory}/${source}`);
}

function normalizePosixPath(path: string): string {
  const isAbsolute = path.startsWith('/');
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${isAbsolute ? '/' : ''}${segments.join('/')}`;
}

function isStandaloneHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
