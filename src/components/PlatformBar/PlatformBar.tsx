import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Platform {
  name: string;
  display_name: string;
  supports_external_images: boolean;
}

interface PlatformBarProps {
  markdown: string;
  documentPath: string;
  onStatusChange: (message: string) => void;
}

export function PlatformBar({ markdown, documentPath, onStatusChange }: PlatformBarProps) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<Platform[]>('get_platforms').then(setPlatforms);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePublish = async (platform: string) => {
    setIsOpen(false);
    try {
      const result = await invoke<string>('convert_and_copy', {
        markdown,
        platform,
        documentPath: documentPath || null,
      });
      onStatusChange(result);
    } catch (err) {
      onStatusChange(`错误: ${err}`);
    }
  };

  return (
    <div className="platform-bar" ref={menuRef}>
      <button
        className="menu-btn publish-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        发布
      </button>
      {isOpen && (
        <div className="publish-menu">
          {platforms.map((p) => (
            <button
              key={p.name}
              className="platform-item"
              onClick={() => handlePublish(p.name)}
            >
              {p.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
