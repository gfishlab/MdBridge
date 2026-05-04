import { useState } from 'react';
import { Editor } from './components/Editor';
import './App.css';

function App() {
  const [markdown, setMarkdown] = useState('# Hello MDBridge\n\nStart writing...');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');

  return (
    <div className="app">
      <header className="toolbar">
        <span className="app-name">MDBridge</span>
        <div className="toolbar-center">
          {/* File and Publish menus will go here */}
        </div>
        <div className="view-toggle">
          <button
            className={viewMode === 'edit' ? 'active' : ''}
            onClick={() => setViewMode('edit')}
            title="编辑模式"
          >✏️</button>
          <button
            className={viewMode === 'split' ? 'active' : ''}
            onClick={() => setViewMode('split')}
            title="并排模式"
          >↔️</button>
          <button
            className={viewMode === 'preview' ? 'active' : ''}
            onClick={() => setViewMode('preview')}
            title="预览模式"
          >👁</button>
        </div>
      </header>
      <main className="content">
        <Editor value={markdown} onChange={setMarkdown} viewMode={viewMode} />
      </main>
      <footer className="status-bar">
        <span className="status-message"></span>
      </footer>
    </div>
  );
}

export default App;
