import { useEffect, useRef, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import remarkCjkFriendly from 'remark-cjk-friendly';
import type { ThemeAppearance } from '../../preferences';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  colorMode: ThemeAppearance;
}

export function Editor({ value, onChange, colorMode }: EditorProps) {
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

  return (
    <div className="editor-container" ref={containerRef} data-color-mode={colorMode}>
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || '')}
        preview="live"
        height={editorHeight || '100%'}
        visibleDragbar={false}
        previewOptions={{
          // 修复中文 + 全角标点旁加粗/斜体语法失效问题（CommonMark flanking 缺陷）
          remarkPlugins: [remarkCjkFriendly],
        }}
      />
    </div>
  );
}
