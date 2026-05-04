import MDEditor from '@uiw/react-md-editor';

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
      />
    </div>
  );
}
