import MDEditor from '@uiw/react-md-editor';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  viewMode: 'edit' | 'preview' | 'split';
}

export function Editor({ value, onChange, viewMode }: EditorProps) {
  const getPreview = () => {
    switch (viewMode) {
      case 'edit': return 'edit';
      case 'preview': return 'preview';
      case 'split': return 'live';
    }
  };

  return (
    <div className="editor-container" data-color-mode="light">
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || '')}
        preview={getPreview()}
        height="100%"
        visibleDragbar={false}
      />
    </div>
  );
}
