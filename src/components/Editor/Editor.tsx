import MDEditor from '@uiw/react-md-editor';
import remarkCjkFriendly from 'remark-cjk-friendly';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function Editor({ value, onChange }: EditorProps) {
  return (
    <div className="editor-container" data-color-mode="light">
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || '')}
        preview="live"
        height="100%"
        visibleDragbar={false}
        previewOptions={{
          // 修复中文 + 全角标点旁加粗/斜体语法失效问题（CommonMark flanking 缺陷）
          remarkPlugins: [remarkCjkFriendly],
        }}
      />
    </div>
  );
}
