import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Editor } from './components/Editor';
import { PlatformBar } from './components/PlatformBar';
import { FileTree } from './components/FileTree';
import { GitPanel, type GitChangedFile, type GitStatus } from './components/GitPanel';
import { UpdateDialog } from './components/UpdateDialog';
import { Settings } from './components/Settings';
import { Help } from './components/Help/Help';
import {
  normalizeTextStylePreference,
  normalizeThemePreference,
  resolveThemeAppearance,
  type TextStylePreference,
  type ThemePreference,
} from './preferences';
import './App.css';

// How long after the user stops typing before edits are persisted to disk.
const AUTO_SAVE_DELAY = 800;
const DEFAULT_MARKDOWN = '# Hello MDBridge\n\nStart writing...';
const MAX_RECENT_ITEMS = 5;

interface Config {
  image_cache_size_mb: number;
  default_platform: string;
  check_updates_on_startup: boolean;
  theme_preference?: string;
  text_style?: string;
  recent_files: string[];
  recent_folders: string[];
}

interface FileSystemChange {
  paths: string[];
}

interface DocumentTab {
  id: string;
  path: string;
  content: string;
  hasLocalEdits: boolean;
}

interface TabContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

interface GitOperationResult {
  message: string;
}

interface GitRemote {
  name: string;
  url: string;
}

interface GitBranch {
  name: string;
  current: boolean;
  kind: string;
}

interface GitRemoteForm {
  name: string;
  domain: string;
  branchName: string;
  url: string;
}

interface GitToastState {
  type: 'success' | 'error';
  message: string;
}

type DiffRowKind = 'context' | 'added' | 'deleted' | 'modified' | 'hunk' | 'meta';

interface SideBySideDiffRow {
  id: string;
  kind: DiffRowKind;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldText: string;
  newText: string;
}

interface ParsedSideBySideDiff {
  rows: SideBySideDiffRow[];
  differenceCount: number;
}

export function getStartupFileFromSearch(search = window.location.search): string {
  return new URLSearchParams(search).get('file') ?? '';
}

export function getStartupFolderFromSearch(search = window.location.search): string {
  return new URLSearchParams(search).get('folder') ?? '';
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getTabTitle(tab: DocumentTab): string {
  return tab.path ? getFileName(tab.path) : '未命名';
}

function addRecentPath(items: string[], path: string): string[] {
  return [path, ...items.filter((item) => item !== path)].slice(0, MAX_RECENT_ITEMS);
}

function App() {
  const startupFileRef = useRef(getStartupFileFromSearch());
  const startupFolderRef = useRef(getStartupFolderFromSearch());
  const nextTabIdRef = useRef(2);
  const [tabs, setTabs] = useState<DocumentTab[]>([
    {
      id: 'tab-1',
      path: '',
      content: DEFAULT_MARKDOWN,
      hasLocalEdits: false,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [statusMessage, setStatusMessage] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [showFileTree, setShowFileTree] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showEditMenu, setShowEditMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showGitMenu, setShowGitMenu] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitBranches, setGitBranches] = useState<GitBranch[]>([]);
  const [gitBranchesLoading, setGitBranchesLoading] = useState(false);
  const [gitBranchesError, setGitBranchesError] = useState('');
  const [gitBranchActionLoading, setGitBranchActionLoading] = useState('');
  const [gitActionLoading, setGitActionLoading] = useState('');
  const [gitRefreshSignal, setGitRefreshSignal] = useState(0);
  const [selectedGitChangedFile, setSelectedGitChangedFile] = useState<GitChangedFile | null>(null);
  const [worktreeDiff, setWorktreeDiff] = useState('');
  const [worktreeDiffLoading, setWorktreeDiffLoading] = useState(false);
  const [gitToast, setGitToast] = useState<GitToastState | null>(null);
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);
  const [gitRemotes, setGitRemotes] = useState<GitRemote[]>([]);
  const [selectedRemoteName, setSelectedRemoteName] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteActionLoading, setRemoteActionLoading] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const [showAddRemoteForm, setShowAddRemoteForm] = useState(false);
  const [remoteForm, setRemoteForm] = useState<GitRemoteForm>({
    name: '',
    domain: '',
    branchName: 'master',
    url: '',
  });
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [textStyle, setTextStyle] = useState<TextStylePreference>('standard');
  const [prefersDarkMode, setPrefersDarkMode] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const gitMenuRef = useRef<HTMLDivElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const recentFilesRef = useRef<string[]>([]);
  const recentFoldersRef = useRef<string[]>([]);
  const currentFileRef = useRef('');
  const markdownRef = useRef(DEFAULT_MARKDOWN);
  const hasLocalEditsRef = useRef(false);
  const externalReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const markdown = activeTab?.content ?? '';
  const currentFile = activeTab?.path ?? '';
  const markdownStats = getMarkdownStats(markdown);
  const themeAppearance = resolveThemeAppearance(themePreference, prefersDarkMode);
  const gitWorkspacePath = folderPath || currentFile;
  const gitPanelWorkspacePath = gitWorkspacePath || gitStatus?.repo_root || '';

  useEffect(() => {
    tabsRef.current = tabs;
    activeTabIdRef.current = activeTabId;
    currentFileRef.current = activeTab?.path ?? '';
    markdownRef.current = activeTab?.content ?? '';
    hasLocalEditsRef.current = activeTab?.hasLocalEdits ?? false;
  }, [tabs, activeTabId, activeTab]);

  useEffect(() => {
    recentFilesRef.current = recentFiles;
  }, [recentFiles]);

  useEffect(() => {
    recentFoldersRef.current = recentFolders;
  }, [recentFolders]);

  useEffect(() => {
    if (!gitToast) return undefined;
    const timer = window.setTimeout(() => setGitToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [gitToast]);

  useEffect(() => {
    let cancelled = false;
    if (!gitWorkspacePath) {
      setGitStatus(null);
      setGitStatusLoading(false);
      return;
    }

    setGitStatusLoading(true);
    invoke<GitStatus>('get_git_status', { path: gitWorkspacePath })
      .then((status) => {
        if (cancelled) return;
        setGitStatus(isGitStatus(status) ? status : null);
      })
      .catch(() => {
        if (!cancelled) setGitStatus(null);
      })
      .finally(() => {
        if (!cancelled) setGitStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gitWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    const actionPath = gitStatus?.repo_root || gitWorkspacePath;
    if (!actionPath) {
      setGitBranches([]);
      setGitBranchesLoading(false);
      setGitBranchesError('');
      return;
    }

    setGitBranchesLoading(true);
    setGitBranchesError('');
    invoke<GitBranch[]>('get_git_branches', { path: actionPath })
      .then((branches) => {
        if (cancelled) return;
        setGitBranches(Array.isArray(branches) ? branches : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setGitBranches([]);
        setGitBranchesError(String(err));
      })
      .finally(() => {
        if (!cancelled) setGitBranchesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gitStatus?.repo_root, gitWorkspacePath, gitRefreshSignal]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setPrefersDarkMode(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Cancel any pending auto-save on unmount so the timer does not leak.
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setShowFileMenu(false);
      }
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) {
        setShowEditMenu(false);
      }
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
      }
      if (gitMenuRef.current && !gitMenuRef.current.contains(e.target as Node)) {
        setShowGitMenu(false);
      }
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setShowBranchMenu(false);
      }
      setTabContextMenu(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    async function checkStartupUpdates() {
      try {
        const config = await invoke<Config>('get_config');
        setRecentFiles(config.recent_files ?? []);
        setRecentFolders(config.recent_folders ?? []);
        setThemePreference(normalizeThemePreference(config.theme_preference));
        setTextStyle(normalizeTextStylePreference(config.text_style));
        if (config.check_updates_on_startup) {
          await invoke('check_for_updates');
        }
      } catch (err) {
        console.error('Startup update check failed:', err);
      }
    }

    checkStartupUpdates();
  }, []);

  useEffect(() => {
    const unlisten = listen<Config>('config-updated', (event) => {
      const config = event.payload;
      setThemePreference(normalizeThemePreference(config.theme_preference));
      setTextStyle(normalizeTextStylePreference(config.text_style));
      setRecentFiles(config.recent_files ?? []);
      setRecentFolders(config.recent_folders ?? []);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const startupFile = startupFileRef.current;
    if (!startupFile) return;

    let cancelled = false;
    invoke<string>('read_file', { path: startupFile })
      .then((content) => {
        if (cancelled) return;
        setTabs((prev) => prev.map((tab) => (
          tab.id === activeTabIdRef.current
            ? { ...tab, path: startupFile, content, hasLocalEdits: false }
            : tab
        )));
      })
      .catch((err) => {
        if (!cancelled) setStatusMessage(`打开启动文件失败: ${err}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const startupFolder = startupFolderRef.current;
    if (!startupFolder) return;

    openFolderPath(startupFolder).catch((err) => {
      setStatusMessage(`打开启动文件夹失败: ${err}`);
    });
  }, []);

  const createTabId = () => {
    const id = `tab-${nextTabIdRef.current}`;
    nextTabIdRef.current += 1;
    return id;
  };

  const updateTab = (tabId: string, updater: (tab: DocumentTab) => DocumentTab) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  };

  const updateActiveTab = (updater: (tab: DocumentTab) => DocumentTab) => {
    const tabId = activeTabIdRef.current;
    updateTab(tabId, updater);
  };

  const activeTabCanBeReplaced = () => {
    const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current);
    if (!tab) return false;
    return !tab.path && !tab.hasLocalEdits && (tab.content === DEFAULT_MARKDOWN || tab.content === '');
  };

  const persistRecentPaths = async (nextFiles: string[], nextFolders: string[]) => {
    try {
      await invoke('update_config', {
        updates: {
          recent_files: nextFiles,
          recent_folders: nextFolders,
        },
      });
    } catch (err) {
      console.error('Failed to update recent paths:', err);
    }
  };

  const rememberRecentFile = (path: string) => {
    setRecentFiles((prev) => {
      const nextFiles = addRecentPath(prev, path);
      recentFilesRef.current = nextFiles;
      persistRecentPaths(nextFiles, recentFoldersRef.current);
      return nextFiles;
    });
  };

  const rememberRecentFolder = (path: string) => {
    setRecentFolders((prev) => {
      const nextFolders = addRecentPath(prev, path);
      recentFoldersRef.current = nextFolders;
      persistRecentPaths(recentFilesRef.current, nextFolders);
      return nextFolders;
    });
  };

  const openFolderPath = async (path: string) => {
    await flushSave();
    await invoke('watch_folder', { path });
    setFolderPath(path);
    setShowFileTree(true);
    rememberRecentFolder(path);
    setShowFileMenu(false);
    setShowViewMenu(false);
  };

  // Persist any pending debounced auto-save immediately. Called when the user
  // switches tabs, opens a new file, or manually saves — so that edits to the
  // active file are never lost when the visible document changes. Uses refs
  // (not closure-captured state) so the latest tab, path, and content are used.
  const flushSave = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      const tabId = activeTabIdRef.current;
      const path = currentFileRef.current;
      if (!path) return;
      try {
        await invoke('write_file', { path, content: markdownRef.current });
        updateTab(tabId, (tab) => ({ ...tab, hasLocalEdits: false }));
      } catch (err) {
        setStatusMessage(`自动保存失败: ${err}`);
      }
    }
  };

  const openDocumentInTab = async (path: string) => {
    await flushSave();

    const existingTab = tabsRef.current.find((tab) => tab.path === path);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      rememberRecentFile(path);
      return;
    }

    const content = await invoke<string>('read_file', { path });
    if (activeTabCanBeReplaced()) {
      const tabId = activeTabIdRef.current;
      updateTab(tabId, () => ({ id: tabId, path, content, hasLocalEdits: false }));
    } else {
      const tabId = createTabId();
      setTabs((prev) => [...prev, { id: tabId, path, content, hasLocalEdits: false }]);
      setActiveTabId(tabId);
    }
    rememberRecentFile(path);
  };

  const handleNewFile = async () => {
    await flushSave();
    setShowFileMenu(false);
    setShowEditMenu(false);
    const tabId = createTabId();
    setTabs((prev) => [...prev, { id: tabId, path: '', content: '', hasLocalEdits: false }]);
    setActiveTabId(tabId);
    setStatusMessage('新建标签页');
  };

  const handleNewWindow = async () => {
    await flushSave();
    await invoke('open_new_window');
    setShowFileMenu(false);
    setStatusMessage('已打开新窗口');
  };

  const handleOpenFile = async () => {
    const selected = await open({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (selected) {
      await openDocumentInTab(selected as string);
      setShowFileMenu(false);
    }
  };

  const openFileInNewWindow = async (path: string) => {
    await flushSave();
    await invoke('open_file_in_new_window', { path });
    rememberRecentFile(path);
    setStatusMessage('已在新窗口打开');
  };

  const handleOpenFileInNewWindow = async () => {
    await flushSave();
    const selected = await open({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (selected) {
      await invoke('open_file_in_new_window', { path: selected });
      rememberRecentFile(selected as string);
      setStatusMessage('已在新窗口打开');
      setShowFileMenu(false);
    }
  };

  const handleOpenFolderInNewWindow = async () => {
    await flushSave();
    const selected = await open({ directory: true });
    if (selected) {
      await invoke('open_folder_in_new_window', { path: selected });
      rememberRecentFolder(selected as string);
      setStatusMessage('已在新窗口打开文件夹');
      setShowFileMenu(false);
    }
  };

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      await openFolderPath(selected as string);
    }
  };

  const handleOpenRecentFile = async (path: string) => {
    try {
      await openDocumentInTab(path);
      setShowFileMenu(false);
    } catch (err) {
      setStatusMessage(`打开最近文件失败: ${err}`);
    }
  };

  const handleOpenRecentFolder = async (path: string) => {
    try {
      await openFolderPath(path);
    } catch (err) {
      setStatusMessage(`打开最近文件夹失败: ${err}`);
    }
  };

  const handleFileSelect = async (path: string) => {
    await openDocumentInTab(path);
  };

  const handleSave = async () => {
    // Cancel any pending auto-save so we don't write twice.
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const tabId = activeTabIdRef.current;
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;

    if (tab.path) {
      await invoke('write_file', { path: tab.path, content: tab.content });
      updateTab(tabId, (item) => ({ ...item, hasLocalEdits: false }));
      setStatusMessage('已保存');
    } else {
      const selected = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (selected) {
        await invoke('write_file', { path: selected, content: tab.content });
        rememberRecentFile(selected as string);
        updateTab(tabId, (item) => ({
          ...item,
          path: selected as string,
          hasLocalEdits: false,
        }));
        setStatusMessage('已保存');
      }
    }
    setShowFileMenu(false);
    setShowEditMenu(false);
  };

  const handleCopyCurrentPath = async () => {
    if (!currentFileRef.current) {
      setStatusMessage('当前文档还没有文件路径');
      return;
    }

    try {
      await navigator.clipboard.writeText(currentFileRef.current);
      setStatusMessage('已复制当前文件路径');
    } catch {
      setStatusMessage('复制文件路径失败');
    } finally {
      setShowEditMenu(false);
    }
  };

  const handleEditorChange = (value: string) => {
    const tabId = activeTabIdRef.current;
    markdownRef.current = value;
    hasLocalEditsRef.current = true;
    tabsRef.current = tabsRef.current.map((tab) => (
      tab.id === tabId ? { ...tab, content: value, hasLocalEdits: true } : tab
    ));
    updateTab(tabId, (tab) => ({ ...tab, content: value, hasLocalEdits: true }));

    // Schedule a debounced auto-save whenever editing a file that exists on
    // disk. Untitled documents (no currentFile) are skipped — they still need
    // an explicit "另存为" via handleSave.
    const path = currentFileRef.current;
    if (!path) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      autoSaveTimerRef.current = null;
      // Re-check after the delay: the user may have switched files or already
      // saved manually during the debounce window.
      if (currentFileRef.current !== path || !hasLocalEditsRef.current) return;
      try {
        await invoke('write_file', { path, content: markdownRef.current });
        updateTab(tabId, (tab) => ({ ...tab, hasLocalEdits: false }));
        setStatusMessage('已自动保存');
      } catch (err) {
        setStatusMessage(`自动保存失败: ${err}`);
      }
    }, AUTO_SAVE_DELAY);
  };

  useEffect(() => {
    if (!folderPath) return;

    invoke('watch_folder', { path: folderPath }).catch((err) => {
      setStatusMessage(`监听文件夹失败: ${err}`);
    });

    return () => {
      invoke('unwatch_folder').catch(() => {});
    };
  }, [folderPath]);

  useEffect(() => {
    if (!currentFile) return;

    const interval = setInterval(async () => {
      const activeFile = currentFileRef.current;
      if (!activeFile || hasLocalEditsRef.current) return;

      try {
        const content = await invoke<string>('read_file', { path: activeFile });
        // Re-check after the async read: a keystroke or file switch during the
        // read window must not be clobbered by stale external content.
        if (hasLocalEditsRef.current || currentFileRef.current !== activeFile) return;
        if (content !== markdownRef.current) {
          updateActiveTab((tab) => ({ ...tab, content }));
          setStatusMessage('已刷新外部修改');
        }
      } catch {
        // Ignore transient read errors; direct event handling reports immediate failures.
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [currentFile]);

  useEffect(() => {
    const unlisten = listen<FileSystemChange>('file-system-changed', (event) => {
      const activeFile = currentFileRef.current;
      if (!activeFile || !event.payload.paths.includes(activeFile)) return;

      if (hasLocalEditsRef.current) {
        setStatusMessage('当前文件已在外部修改，请先保存或重新打开以避免覆盖本地编辑');
        return;
      }

      if (externalReloadTimerRef.current) clearTimeout(externalReloadTimerRef.current);
      externalReloadTimerRef.current = setTimeout(async () => {
        if (hasLocalEditsRef.current) {
          setStatusMessage('当前文件已在外部修改，请先保存或重新打开以避免覆盖本地编辑');
          return;
        }

        try {
          const content = await invoke<string>('read_file', { path: activeFile });
          // Re-check after the async read: a keystroke or file switch during the
          // read window must not be clobbered by stale external content.
          if (hasLocalEditsRef.current || currentFileRef.current !== activeFile) return;
          updateActiveTab((tab) => ({ ...tab, content }));
          setStatusMessage('已刷新外部修改');
        } catch (err) {
          setStatusMessage(`刷新文件失败: ${err}`);
        }
      }, 150);
    });

    return () => {
      if (externalReloadTimerRef.current) clearTimeout(externalReloadTimerRef.current);
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFile, markdown]);

  const handleTabSelect = async (tabId: string) => {
    if (tabId === activeTabIdRef.current) return;
    await flushSave();
    setActiveTabId(tabId);
  };

  const closeTabs = async (tabIds: string[], fallbackActiveTabId?: string) => {
    const tabIdSet = new Set(tabIds);
    setTabContextMenu(null);
    if (tabIdSet.size === 0) return;

    const activeBeforeClose = activeTabIdRef.current;
    if (tabIdSet.has(activeBeforeClose)) await flushSave();

    setTabs((prev) => {
      const nextTabs = prev.filter((tab) => !tabIdSet.has(tab.id));
      if (nextTabs.length === 0) {
        const replacementId = createTabId();
        setActiveTabId(replacementId);
        return [{ id: replacementId, path: '', content: DEFAULT_MARKDOWN, hasLocalEdits: false }];
      }

      if (!nextTabs.some((tab) => tab.id === activeBeforeClose)) {
        const fallbackTab = nextTabs.find((tab) => tab.id === fallbackActiveTabId);
        if (fallbackTab) {
          setActiveTabId(fallbackTab.id);
        } else {
          const closingIndex = prev.findIndex((tab) => tab.id === activeBeforeClose);
          const nextIndex = Math.min(Math.max(closingIndex, 0), nextTabs.length - 1);
          setActiveTabId(nextTabs[nextIndex].id);
        }
      }

      return nextTabs;
    });
  };

  const handleTabClose = async (tabId: string) => {
    await closeTabs([tabId]);
  };

  const getContextMenuTabIndex = () => {
    if (!tabContextMenu) return -1;
    return tabs.findIndex((tab) => tab.id === tabContextMenu.tabId);
  };

  const handleCloseOtherTabs = async () => {
    if (!tabContextMenu) return;
    const targetTabId = tabContextMenu.tabId;
    await closeTabs(
      tabsRef.current.filter((tab) => tab.id !== targetTabId).map((tab) => tab.id),
      targetTabId,
    );
    setActiveTabId(targetTabId);
  };

  const handleCloseLeftTabs = async () => {
    const targetIndex = getContextMenuTabIndex();
    if (!tabContextMenu || targetIndex < 0) return;
    await closeTabs(
      tabsRef.current.slice(0, targetIndex).map((tab) => tab.id),
      tabContextMenu.tabId,
    );
  };

  const handleCloseRightTabs = async () => {
    const targetIndex = getContextMenuTabIndex();
    if (!tabContextMenu || targetIndex < 0) return;
    await closeTabs(
      tabsRef.current.slice(targetIndex + 1).map((tab) => tab.id),
      tabContextMenu.tabId,
    );
  };

  const handleCloseAllTabs = async () => {
    await closeTabs(tabsRef.current.map((tab) => tab.id));
  };

  const handleSettingsSaved = (config: {
    theme_preference?: string;
    text_style?: string;
  }) => {
    setThemePreference(normalizeThemePreference(config.theme_preference));
    setTextStyle(normalizeTextStylePreference(config.text_style));
    setShowSettings(false);
  };

  const handleToggleGitPanel = () => {
    if (!gitPanelWorkspacePath) {
      setStatusMessage('打开文件夹或保存文档后可使用版本中心');
      return;
    }
    setShowGitPanel((visible) => !visible);
  };

  const handleRestoreGitVersion = (content: string) => {
    const tabId = activeTabIdRef.current;
    markdownRef.current = content;
    hasLocalEditsRef.current = false;
    tabsRef.current = tabsRef.current.map((tab) => (
      tab.id === tabId ? { ...tab, content, hasLocalEdits: false } : tab
    ));
    updateTab(tabId, (tab) => ({ ...tab, content, hasLocalEdits: false }));
    setStatusMessage('已恢复到选中的历史版本');
  };

  const refreshGitRepositoryStatus = async (path: string) => {
    if (!path) {
      setGitStatus(null);
      return null;
    }

    setGitStatusLoading(true);
    try {
      const status = await invoke<GitStatus>('get_git_status', { path });
      const normalizedStatus = isGitStatus(status) ? status : null;
      setGitStatus(normalizedStatus);
      return normalizedStatus;
    } catch {
      setGitStatus(null);
      return null;
    } finally {
      setGitStatusLoading(false);
    }
  };

  const resolveGitActionPath = async () => {
    const currentPath = gitStatus?.repo_root || gitWorkspacePath;
    if (currentPath) return currentPath;

    const status = await refreshGitRepositoryStatus('.');
    return status?.repo_root ?? '';
  };

  const loadGitRemotes = async (path?: string) => {
    const actionPath = path || await resolveGitActionPath();
    if (!actionPath) {
      setRemoteError('打开文件夹或保存文档后可管理远程分支');
      setGitRemotes([]);
      return;
    }

    setRemoteLoading(true);
    setRemoteError('');
    try {
      const remotes = await invoke<GitRemote[]>('get_git_remotes', { path: actionPath });
      const normalizedRemotes = Array.isArray(remotes) ? remotes : [];
      setGitRemotes(normalizedRemotes);
      setSelectedRemoteName((current) => (
        normalizedRemotes.some((remote) => remote.name === current)
          ? current
          : normalizedRemotes[0]?.name ?? ''
      ));
    } catch (err) {
      setGitRemotes([]);
      setSelectedRemoteName('');
      setRemoteError(`读取远程分支配置失败: ${err}`);
    } finally {
      setRemoteLoading(false);
    }
  };

  const runGitMenuAction = async (command: string, label: string) => {
    setGitActionLoading(label);
    setShowGitMenu(false);
    try {
      const actionPath = await resolveGitActionPath();
      if (!actionPath) {
        setStatusMessage('打开文件夹或保存文档后可使用 Git 操作');
        return;
      }

      await flushSave();
      const result = await invoke<GitOperationResult>(command, { path: actionPath });
      const message = result.message || `${label}完成`;
      setStatusMessage(message);
      setGitToast({ type: 'success', message });
      setGitRefreshSignal((value) => value + 1);
      await refreshGitRepositoryStatus(actionPath);
    } catch (err) {
      setStatusMessage(`${label}失败: ${err}`);
      setGitToast({ type: 'error', message: `${label}失败: ${err}` });
    } finally {
      setGitActionLoading('');
    }
  };

  const handleCheckoutBranch = async (branch: GitBranch) => {
    if (branch.current || gitBranchActionLoading) return;
    const actionPath = await resolveGitActionPath();
    if (!actionPath) {
      setStatusMessage('打开文件夹或保存文档后可切换分支');
      return;
    }

    const confirmed = (gitStatus?.changed_files ?? 0) === 0
      || window.confirm(`切换到 ${branch.name} 前请确认：当前未保存的改动会继续保留，但可能需要你手动处理冲突。继续切换？`);
    if (!confirmed) return;

    setGitBranchActionLoading(branch.name);
    setShowBranchMenu(false);
    try {
      await flushSave();
      const result = await invoke<GitOperationResult>('checkout_git_branch', {
        path: actionPath,
        branch: branch.name,
        kind: branch.kind,
      });
      const message = result.message || `已切换到 ${branch.name}`;
      setStatusMessage(message);
      setGitToast({ type: 'success', message });
      setGitRefreshSignal((value) => value + 1);
      await refreshGitRepositoryStatus(actionPath);
    } catch (err) {
      setStatusMessage(`切换分支失败: ${err}`);
      setGitToast({ type: 'error', message: `切换分支失败: ${err}` });
    } finally {
      setGitBranchActionLoading('');
    }
  };

  const handleManageRemoteBranches = async () => {
    setShowGitMenu(false);
    const actionPath = await resolveGitActionPath();
    if (!actionPath) {
      setStatusMessage('打开文件夹或保存文档后可管理远程分支');
      return;
    }

    setShowRemoteDialog(true);
    setShowAddRemoteForm(false);
    setRemoteForm({
      name: '',
      domain: '',
      branchName: gitStatus?.branch || 'master',
      url: '',
    });
    setStatusMessage('已打开远程分支管理');
    await loadGitRemotes(actionPath);
  };

  const handleCloseRemoteDialog = () => {
    setShowRemoteDialog(false);
    setShowAddRemoteForm(false);
    setRemoteError('');
  };

  const handleAddRemote = async () => {
    const actionPath = await resolveGitActionPath();
    if (!actionPath) {
      setRemoteError('打开文件夹或保存文档后可添加远程分支');
      return;
    }

    setRemoteActionLoading('添加 remote');
    setRemoteError('');
    try {
      const result = await invoke<GitOperationResult>('add_git_remote', {
        path: actionPath,
        name: remoteForm.name.trim(),
        domain: remoteForm.domain.trim(),
        branchName: remoteForm.branchName.trim(),
        url: remoteForm.url.trim(),
      });
      const message = result.message || `已添加 remote ${remoteForm.name.trim()}`;
      setGitToast({ type: 'success', message });
      setStatusMessage(message);
      setRemoteForm({
        name: '',
        domain: '',
        branchName: gitStatus?.branch || 'master',
        url: '',
      });
      setShowAddRemoteForm(false);
      await loadGitRemotes(actionPath);
    } catch (err) {
      setRemoteError(`添加 remote 失败: ${err}`);
    } finally {
      setRemoteActionLoading('');
    }
  };

  const handleRemoveRemote = async () => {
    if (!selectedRemoteName) return;
    const confirmed = window.confirm(`删除 remote ${selectedRemoteName}？`);
    if (!confirmed) return;

    const actionPath = await resolveGitActionPath();
    if (!actionPath) {
      setRemoteError('打开文件夹或保存文档后可删除远程分支');
      return;
    }

    setRemoteActionLoading('删除 remote');
    setRemoteError('');
    try {
      const result = await invoke<GitOperationResult>('remove_git_remote', {
        path: actionPath,
        name: selectedRemoteName,
      });
      const message = result.message || `已删除 remote ${selectedRemoteName}`;
      setGitToast({ type: 'success', message });
      setStatusMessage(message);
      await loadGitRemotes(actionPath);
    } catch (err) {
      setRemoteError(`删除 remote 失败: ${err}`);
    } finally {
      setRemoteActionLoading('');
    }
  };

  const handleChangedFileSelect = async (file: GitChangedFile) => {
    const actionPath = gitPanelWorkspacePath || await resolveGitActionPath();
    if (!actionPath) {
      setStatusMessage('打开文件夹或保存文档后可查看改动');
      return;
    }

    setSelectedGitChangedFile(file);
    setWorktreeDiff('');
    setWorktreeDiffLoading(true);
    try {
      await flushSave();
      const nextDiff = await invoke<string>('get_git_worktree_file_diff', {
        path: actionPath,
        filePath: file.path,
      });
      setWorktreeDiff(nextDiff.trim() || '该文件没有可显示的改动。');
    } catch (err) {
      setWorktreeDiff(`读取改动失败: ${err}`);
    } finally {
      setWorktreeDiffLoading(false);
    }
  };

  const handleCloseChangedFileDiff = () => {
    setSelectedGitChangedFile(null);
    setWorktreeDiff('');
    setWorktreeDiffLoading(false);
  };

  const handleRollbackChangedFile = async () => {
    if (!selectedGitChangedFile) return;

    const confirmed = window.confirm(`回滚 ${selectedGitChangedFile.path} 的本地改动？此操作不可撤销。`);
    if (!confirmed) return;

    const actionPath = gitPanelWorkspacePath || await resolveGitActionPath();
    if (!actionPath) {
      setStatusMessage('打开文件夹或保存文档后可回滚改动');
      return;
    }

    setGitActionLoading(`回滚 ${selectedGitChangedFile.path}`);
    setWorktreeDiffLoading(true);
    try {
      await flushSave();
      const result = await invoke<GitOperationResult>('rollback_git_changed_file', {
        path: actionPath,
        filePath: selectedGitChangedFile.path,
      });
      setStatusMessage(result.message || `已回滚 ${selectedGitChangedFile.path}`);
      handleCloseChangedFileDiff();
      setGitRefreshSignal((value) => value + 1);
      await refreshGitRepositoryStatus(actionPath);
    } catch (err) {
      setStatusMessage(`回滚失败: ${err}`);
    } finally {
      setGitActionLoading('');
      setWorktreeDiffLoading(false);
    }
  };

  return (
    <div
      className="app"
      data-theme={themePreference}
      data-theme-appearance={themeAppearance}
      data-text-style={textStyle}
    >
      <header className="toolbar">
        <div className="toolbar-left">
          <div className="branch-menu-container" ref={branchMenuRef}>
            <button
              type="button"
              className={`branch-selector-btn ${showBranchMenu ? 'active' : ''}`}
              onClick={() => {
                setShowBranchMenu((visible) => !visible);
                setShowFileMenu(false);
                setShowEditMenu(false);
                setShowGitMenu(false);
                setShowViewMenu(false);
              }}
              disabled={!gitWorkspacePath && !gitStatus}
              aria-label={getBranchSelectorAriaLabel(gitStatus, gitBranchesLoading)}
            >
              <GitMenuIcon />
              <span>{getCurrentBranchLabel(gitStatus, gitBranchesLoading)}</span>
              <ChevronDownIcon />
            </button>
            {showBranchMenu && (
              <BranchDropdown
                branches={gitBranches}
                currentBranch={gitStatus?.branch ?? ''}
                loading={gitBranchesLoading}
                error={gitBranchesError}
                actionLoading={gitBranchActionLoading}
                onCheckout={handleCheckoutBranch}
              />
            )}
          </div>
          <div className="file-menu-container" ref={fileMenuRef}>
            <button
              className="menu-btn"
              onClick={() => {
                setShowFileMenu(!showFileMenu);
                setShowEditMenu(false);
                setShowGitMenu(false);
                setShowViewMenu(false);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              文件
            </button>
            {showFileMenu && (
              <div className="file-menu">
                <button onClick={handleNewFile}>新建标签页</button>
                <button onClick={handleNewWindow}>新建窗口</button>
                <button onClick={handleOpenFile}>打开文件</button>
                <button onClick={handleOpenFileInNewWindow}>在新窗口打开文件</button>
                <button onClick={handleOpenFolder}>打开文件夹</button>
                <button onClick={handleOpenFolderInNewWindow}>在新窗口打开文件夹</button>
                <button onClick={handleSave}>保存</button>
                {(recentFiles.length > 0 || recentFolders.length > 0) && (
                  <>
                    {recentFiles.length > 0 && (
                      <div className="file-menu-section">
                        <div className="file-menu-section-title">最近打开的文件</div>
                        {recentFiles.map((path) => (
                          <button
                            key={`file-${path}`}
                            className="recent-path-item"
                            title={path}
                            onClick={() => handleOpenRecentFile(path)}
                          >
                            {getFileName(path)}
                          </button>
                        ))}
                      </div>
                    )}
                    {recentFolders.length > 0 && (
                      <div className="file-menu-section">
                        <div className="file-menu-section-title">最近打开的文件夹</div>
                        {recentFolders.map((path) => (
                          <button
                            key={`folder-${path}`}
                            className="recent-path-item"
                            title={path}
                            onClick={() => handleOpenRecentFolder(path)}
                          >
                            {getFileName(path)}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="file-menu-container" ref={editMenuRef}>
            <button
              className="menu-btn"
              onClick={() => {
                setShowEditMenu(!showEditMenu);
                setShowFileMenu(false);
                setShowGitMenu(false);
                setShowViewMenu(false);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
              编辑
            </button>
            {showEditMenu && (
              <div className="file-menu compact-menu">
                <button onClick={handleNewFile}>新建标签页</button>
                <button onClick={handleSave}>保存当前文档</button>
                <button onClick={handleCopyCurrentPath}>复制当前文件路径</button>
              </div>
            )}
          </div>
          <PlatformBar markdown={markdown} onStatusChange={setStatusMessage} />
          <div className="file-menu-container" ref={gitMenuRef}>
            <button
              className={`menu-btn ${showGitMenu ? 'active' : ''}`}
              onClick={() => {
                setShowGitMenu(!showGitMenu);
                setShowFileMenu(false);
                setShowEditMenu(false);
                setShowViewMenu(false);
              }}
            >
              <GitMenuIcon />
              Git
            </button>
            {showGitMenu && (
              <div className="file-menu compact-menu git-top-menu">
                <button
                  type="button"
                  onClick={() => runGitMenuAction('fetch_git_repository', 'Fetch 更新')}
                  disabled={!!gitActionLoading}
                >
                  Fetch 更新
                </button>
                <button
                  type="button"
                  onClick={() => runGitMenuAction('pull_git_repository', 'Pull 拉取')}
                  disabled={!!gitActionLoading}
                >
                  Pull 拉取
                </button>
                <button
                  type="button"
                  onClick={() => runGitMenuAction('push_git_repository', 'Push 推送')}
                  disabled={!!gitActionLoading}
                >
                  Push 推送
                </button>
                <button type="button" onClick={handleManageRemoteBranches}>
                  管理远程分支
                </button>
              </div>
            )}
          </div>
          <div className="file-menu-container" ref={viewMenuRef}>
            <button
              className="menu-btn"
              onClick={() => {
                setShowViewMenu(!showViewMenu);
                setShowFileMenu(false);
                setShowEditMenu(false);
                setShowGitMenu(false);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <path d="M9 4v16"/>
                <path d="M14 9h4"/>
                <path d="M14 13h4"/>
              </svg>
              视图
            </button>
            {showViewMenu && (
              <div className="file-menu compact-menu">
                <button
                  onClick={() => {
                    setShowFileTree((visible) => !visible);
                    setShowViewMenu(false);
                  }}
                  disabled={!folderPath}
                >
                  {showFileTree ? '隐藏文件树' : '显示文件树'}
                </button>
                <button
                  onClick={() => {
                    setShowSettings(true);
                    setShowViewMenu(false);
                  }}
                >
                  外观和文字样式
                </button>
              </div>
            )}
          </div>
          <button
            className="menu-btn"
            onClick={() => setShowSettings(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            设置
          </button>
          <button
            className="menu-btn"
            onClick={() => setShowHelp(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            帮助
          </button>
        </div>
      </header>
      <div className="main-content">
        {showGitPanel && gitPanelWorkspacePath ? (
          <GitPanel
            workspacePath={gitPanelWorkspacePath}
            currentFile={currentFile}
            hasLocalEdits={!!activeTab?.hasLocalEdits}
            selectedChangedFilePath={selectedGitChangedFile?.path ?? ''}
            onBeforeGitAction={flushSave}
            onChangedFileSelect={handleChangedFileSelect}
            onClose={() => setShowGitPanel(false)}
            onRepositoryStatusChange={setGitStatus}
            onRestoreVersion={handleRestoreGitVersion}
            onStatusChange={setStatusMessage}
            refreshSignal={gitRefreshSignal}
          />
        ) : showFileTree && folderPath ? (
          <FileTree
            folderPath={folderPath}
            onFileSelect={handleFileSelect}
            onFileOpenInNewWindow={openFileInNewWindow}
            currentFile={currentFile}
          />
        ) : null}
        <main className="content">
          <div className="tab-strip" role="tablist" aria-label="打开的文档">
            {tabs.map((tab) => {
              const title = getTabTitle(tab);
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`doc-tab ${active ? 'active' : ''}`}
                  role="tab"
                  aria-selected={active}
                  title={tab.path || title}
                  onClick={() => handleTabSelect(tab.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setShowFileMenu(false);
                    setTabContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
                  }}
                  >
                  {tab.hasLocalEdits && <span className="doc-tab-dirty" aria-label="未保存修改" />}
                  <span className="doc-tab-title">
                    {title}
                  </span>
                  <button
                    className="doc-tab-close"
                    aria-label={`关闭 ${title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleTabClose(tab.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              className="doc-tab-add"
              type="button"
              aria-label="新建标签页"
              title="新建标签页"
              onClick={handleNewFile}
            >
              +
            </button>
          </div>
          {tabContextMenu && (
            <div
              className="tab-context-menu"
              role="menu"
              style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button type="button" role="menuitem" onClick={handleCloseOtherTabs}>
                关闭其他标签页
              </button>
              <button type="button" role="menuitem" onClick={handleCloseLeftTabs}>
                关闭左侧标签页
              </button>
              <button type="button" role="menuitem" onClick={handleCloseRightTabs}>
                关闭右侧标签页
              </button>
              <button type="button" role="menuitem" onClick={handleCloseAllTabs}>
                关闭全部标签页
              </button>
            </div>
          )}
          {selectedGitChangedFile ? (
            <GitWorktreeDiffView
              file={selectedGitChangedFile}
              diff={worktreeDiff}
              loading={worktreeDiffLoading}
              rollbackLoading={gitActionLoading === `回滚 ${selectedGitChangedFile.path}`}
              onClose={handleCloseChangedFileDiff}
              onRollback={handleRollbackChangedFile}
            />
          ) : (
            <Editor
              value={markdown}
              onChange={handleEditorChange}
              colorMode={themeAppearance}
            />
          )}
        </main>
      </div>
      <footer className="status-bar">
        <button
          type="button"
          className={`git-status-btn ${showGitPanel ? 'active' : ''}`}
          onClick={handleToggleGitPanel}
          title="打开版本中心"
          aria-label={getGitStatusAriaLabel(gitStatus, gitStatusLoading)}
        >
          <BranchStatusIcon />
          <span>{getGitStatusLabel(gitStatus, gitStatusLoading)}</span>
        </button>
        <span className="status-message">{statusMessage || '就绪'}</span>
        <span className="status-meta">{markdownStats.lines} 行</span>
        <span className="status-meta">{markdownStats.characters} 字符</span>
        <span className={`status-save ${activeTab?.hasLocalEdits ? 'dirty' : ''}`}>
          {activeTab?.hasLocalEdits ? '未保存' : '已同步'}
        </span>
        {currentFile && <span className="file-path">{currentFile}</span>}
      </footer>
      {gitToast && (
        <GitToast
          type={gitToast.type}
          message={gitToast.message}
          onClose={() => setGitToast(null)}
        />
      )}
      <UpdateDialog />
      {showRemoteDialog && (
        <RemoteManagementDialog
          remotes={gitRemotes}
          selectedRemoteName={selectedRemoteName}
          loading={remoteLoading}
          actionLoading={remoteActionLoading}
          error={remoteError}
          showAddForm={showAddRemoteForm}
          form={remoteForm}
          onSelectRemote={setSelectedRemoteName}
          onToggleAddForm={() => {
            setRemoteError('');
            setShowAddRemoteForm((visible) => !visible);
          }}
          onRemoveRemote={handleRemoveRemote}
          onFormChange={setRemoteForm}
          onAddRemote={handleAddRemote}
          onClose={handleCloseRemoteDialog}
        />
      )}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSaved={handleSettingsSaved}
        />
      )}
      {showHelp && <Help onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function GitToast({
  type,
  message,
  onClose,
}: {
  type: 'success' | 'error';
  message: string;
  onClose: () => void;
}) {
  return (
    <div className={`git-toast ${type}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="关闭 Git 提示">
        ×
      </button>
    </div>
  );
}

function BranchDropdown({
  branches,
  currentBranch,
  loading,
  error,
  actionLoading,
  onCheckout,
}: {
  branches: GitBranch[];
  currentBranch: string;
  loading: boolean;
  error: string;
  actionLoading: string;
  onCheckout: (branch: GitBranch) => void;
}) {
  const branchGroups = groupGitBranches(branches);

  return (
    <div className="branch-dropdown" role="menu" aria-label="分支列表">
      <div className="branch-dropdown-header">
        <span>当前分支</span>
        <strong>{currentBranch || '未读取'}</strong>
      </div>
      {loading && <div className="branch-dropdown-state">正在读取分支...</div>}
      {error && <div className="branch-dropdown-error">读取分支失败：{error}</div>}
      {!loading && !error && branches.length === 0 && (
        <div className="branch-dropdown-state">当前文档库还没有可显示的分支。</div>
      )}
      {!loading && !error && (
        <>
          <BranchDropdownGroup
            title="本地分支"
            branches={branchGroups.local}
            actionLoading={actionLoading}
            onCheckout={onCheckout}
          />
          <BranchDropdownGroup
            title="远程分支"
            branches={branchGroups.remote}
            actionLoading={actionLoading}
            onCheckout={onCheckout}
          />
          <BranchDropdownGroup
            title="最近使用"
            branches={branchGroups.recent}
            actionLoading={actionLoading}
            onCheckout={onCheckout}
          />
        </>
      )}
    </div>
  );
}

function BranchDropdownGroup({
  title,
  branches,
  actionLoading,
  onCheckout,
}: {
  title: string;
  branches: GitBranch[];
  actionLoading: string;
  onCheckout: (branch: GitBranch) => void;
}) {
  if (branches.length === 0) return null;

  return (
    <section className="branch-dropdown-group" aria-label={title}>
      <div className="branch-dropdown-group-title">{title}</div>
      {branches.map((branch) => (
        <button
          key={`${branch.kind}-${branch.name}`}
          type="button"
          role="menuitem"
          className={`branch-dropdown-item ${branch.current ? 'current' : ''}`}
          onClick={() => onCheckout(branch)}
          disabled={!!actionLoading || branch.current}
          aria-current={branch.current ? 'true' : undefined}
          aria-label={`${branch.name} ${branch.current ? '当前分支' : getGitBranchKindLabel(branch.kind)}`}
        >
          <span className="branch-dropdown-item-name">{branch.name}</span>
          {branch.current && <span className="branch-current-mark">当前</span>}
        </button>
      ))}
    </section>
  );
}

function RemoteManagementDialog({
  remotes,
  selectedRemoteName,
  loading,
  actionLoading,
  error,
  showAddForm,
  form,
  onSelectRemote,
  onToggleAddForm,
  onRemoveRemote,
  onFormChange,
  onAddRemote,
  onClose,
}: {
  remotes: GitRemote[];
  selectedRemoteName: string;
  loading: boolean;
  actionLoading: string;
  error: string;
  showAddForm: boolean;
  form: GitRemoteForm;
  onSelectRemote: (name: string) => void;
  onToggleAddForm: () => void;
  onRemoveRemote: () => void;
  onFormChange: (form: GitRemoteForm) => void;
  onAddRemote: () => void;
  onClose: () => void;
}) {
  const canAddRemote = Boolean(form.name.trim()
    && form.domain.trim()
    && form.branchName.trim()
    && form.url.trim()
    && !actionLoading);

  return (
    <div className="remote-dialog-overlay" role="presentation">
      <section
        className="remote-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-dialog-title"
      >
        <header className="remote-dialog-header">
          <div>
            <h2 id="remote-dialog-title">Management Remote</h2>
            <p>管理当前文档库已配置的远程地址。</p>
          </div>
          <button type="button" className="remote-dialog-close" onClick={onClose} aria-label="关闭远程分支管理">
            ×
          </button>
        </header>

        <div className="remote-toolbar" aria-label="Remote 管理工具栏">
          <button type="button" onClick={onToggleAddForm} aria-label="新增 remote">
            +
          </button>
          <button
            type="button"
            onClick={onRemoveRemote}
            disabled={!selectedRemoteName || !!actionLoading}
            aria-label="删除 remote"
          >
            −
          </button>
          <span>{actionLoading || (loading ? '正在读取 remote...' : `${remotes.length} 个 remote`)}</span>
        </div>

        {error && <div className="remote-error" role="alert">{error}</div>}

        <div className="remote-table" role="table" aria-label="Git Remotes">
          <div className="remote-table-row heading" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">URL</span>
          </div>
          {remotes.length === 0 && !loading && (
            <div className="remote-empty">当前还没有配置 remote。</div>
          )}
          {remotes.map((remote) => (
            <button
              key={remote.name}
              type="button"
              className={`remote-table-row item ${remote.name === selectedRemoteName ? 'selected' : ''}`}
              onClick={() => onSelectRemote(remote.name)}
              role="row"
              aria-label={`选择 remote ${remote.name}`}
            >
              <strong role="cell">{remote.name}</strong>
              <span role="cell">{remote.url}</span>
            </button>
          ))}
        </div>

        {showAddForm && (
          <div className="remote-add-form" aria-label="新增 Remote 表单">
            <label>
              <span>Name 名称</span>
              <input
                value={form.name}
                onChange={(event) => onFormChange({ ...form, name: event.target.value })}
                placeholder="origin"
              />
            </label>
            <label>
              <span>Domain 域名</span>
              <input
                value={form.domain}
                onChange={(event) => onFormChange({ ...form, domain: event.target.value })}
                placeholder="github.com"
              />
            </label>
            <label>
              <span>Branch 分支名</span>
              <input
                value={form.branchName}
                onChange={(event) => onFormChange({ ...form, branchName: event.target.value })}
                placeholder="master"
              />
            </label>
            <label className="remote-url-field">
              <span>URL 地址</span>
              <input
                value={form.url}
                onChange={(event) => onFormChange({ ...form, url: event.target.value })}
                placeholder="git@github.com:org/repo.git"
              />
            </label>
            <div className="remote-form-actions">
              <button type="button" onClick={onToggleAddForm}>取消</button>
              <button
                type="button"
                className="primary"
                onClick={onAddRemote}
                disabled={!canAddRemote}
              >
                {actionLoading === '添加 remote' ? '添加中...' : '添加 Remote'}
              </button>
            </div>
          </div>
        )}

        <footer className="remote-dialog-footer">
          <button type="button" className="primary" onClick={onClose}>
            OK
          </button>
        </footer>
      </section>
    </div>
  );
}

function GitWorktreeDiffView({
  file,
  diff,
  loading,
  rollbackLoading,
  onClose,
  onRollback,
}: {
  file: GitChangedFile;
  diff: string;
  loading: boolean;
  rollbackLoading: boolean;
  onClose: () => void;
  onRollback: () => void;
}) {
  const parsedDiff = parseSideBySideDiff(diff);

  return (
    <section className="worktree-diff-view" aria-label="工作区文件改动">
      <header className="worktree-diff-header">
        <div className="worktree-diff-title">
          <span>当前改动</span>
          <strong>{file.path}</strong>
        </div>
        <div className="worktree-diff-actions">
          <button type="button" className="worktree-secondary-btn" onClick={onClose}>
            返回编辑
          </button>
          <button
            type="button"
            className="worktree-secondary-btn danger"
            onClick={onRollback}
            disabled={loading || rollbackLoading}
          >
            {rollbackLoading ? '回滚中...' : `回滚 ${file.path}`}
          </button>
        </div>
      </header>
      <div className="worktree-diff-toolbar" aria-label="差异查看工具栏">
        <span className="worktree-view-mode">Side-by-side viewer</span>
        <span className="worktree-toolbar-pill">Do not ignore</span>
        <span className="worktree-toolbar-pill">Highlight words</span>
        <span className="worktree-diff-count">{formatDifferenceCount(parsedDiff.differenceCount)}</span>
      </div>
      <div className="worktree-side-by-side" aria-label="差异内容">
        <div className="worktree-pane-heading old" aria-label="原始版本">
          <span>工作区版本</span>
        </div>
        <div className="worktree-pane-heading current" aria-label="当前版本">
          <span>当前版本</span>
        </div>
        {loading ? (
          <div className="worktree-diff-loading">正在读取改动...</div>
        ) : parsedDiff.rows.length === 0 ? (
          <div className="worktree-diff-loading">该文件没有可显示的改动。</div>
        ) : (
          <div className="worktree-diff-rows" role="table" aria-label="Side-by-side diff">
            {parsedDiff.rows.map((row) => (
              <div key={row.id} className={`worktree-diff-row ${row.kind}`} role="row">
                {row.kind === 'hunk' || row.kind === 'meta' ? (
                  <div className="worktree-hunk-line" role="cell">
                    {row.oldText || row.newText}
                  </div>
                ) : (
                  <>
                    <span className="worktree-line-number old" role="cell">
                      {row.oldLineNumber ?? ''}
                    </span>
                    <code className="worktree-code-cell old" role="cell">
                      {row.oldText || ' '}
                    </code>
                    <span className="worktree-line-number current" role="cell">
                      {row.newLineNumber ?? ''}
                    </span>
                    <code className="worktree-code-cell current" role="cell">
                      {row.newText || ' '}
                    </code>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function parseSideBySideDiff(diff: string): ParsedSideBySideDiff {
  if (!diff.trim()) return { rows: [], differenceCount: 0 };

  const lines = diff.split('\n');
  const rows: SideBySideDiffRow[] = [];
  let differenceCount = 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let insideHunk = false;
  let index = 0;

  const addRow = (row: Omit<SideBySideDiffRow, 'id'>) => {
    rows.push({ id: `diff-row-${rows.length}`, ...row });
  };

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNumber = Number(match[1]);
        newLineNumber = Number(match[2]);
        insideHunk = true;
      }
      addRow({
        kind: 'hunk',
        oldLineNumber: null,
        newLineNumber: null,
        oldText: line,
        newText: line,
      });
      index += 1;
      continue;
    }

    if (!insideHunk) {
      if (isDiffMetadataLine(line)) {
        index += 1;
        continue;
      }
      if ((line.startsWith('-') && !line.startsWith('---'))
        || (line.startsWith('+') && !line.startsWith('+++'))
        || line.startsWith(' ')) {
        insideHunk = true;
        oldLineNumber = 1;
        newLineNumber = 1;
        continue;
      }
      addRow({
        kind: 'meta',
        oldLineNumber: null,
        newLineNumber: null,
        oldText: line,
        newText: line,
      });
      index += 1;
      continue;
    }

    if (line.startsWith('\\ No newline')) {
      index += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      const deletedLines: string[] = [];
      const addedLines: string[] = [];

      while (index < lines.length && lines[index].startsWith('-') && !lines[index].startsWith('---')) {
        deletedLines.push(lines[index].slice(1));
        index += 1;
      }

      while (index < lines.length && lines[index].startsWith('+') && !lines[index].startsWith('+++')) {
        addedLines.push(lines[index].slice(1));
        index += 1;
      }

      differenceCount += 1;
      const rowCount = Math.max(deletedLines.length, addedLines.length);
      for (let pairIndex = 0; pairIndex < rowCount; pairIndex += 1) {
        const oldText = deletedLines[pairIndex] ?? '';
        const newText = addedLines[pairIndex] ?? '';
        const hasOld = pairIndex < deletedLines.length;
        const hasNew = pairIndex < addedLines.length;

        addRow({
          kind: hasOld && hasNew ? 'modified' : hasOld ? 'deleted' : 'added',
          oldLineNumber: hasOld ? oldLineNumber : null,
          newLineNumber: hasNew ? newLineNumber : null,
          oldText,
          newText,
        });
        if (hasOld) oldLineNumber += 1;
        if (hasNew) newLineNumber += 1;
      }
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      differenceCount += 1;
      while (index < lines.length && lines[index].startsWith('+') && !lines[index].startsWith('+++')) {
        addRow({
          kind: 'added',
          oldLineNumber: null,
          newLineNumber,
          oldText: '',
          newText: lines[index].slice(1),
        });
        newLineNumber += 1;
        index += 1;
      }
      continue;
    }

    if (line.startsWith(' ')) {
      addRow({
        kind: 'context',
        oldLineNumber,
        newLineNumber,
        oldText: line.slice(1),
        newText: line.slice(1),
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      index += 1;
      continue;
    }

    addRow({
      kind: 'meta',
      oldLineNumber: null,
      newLineNumber: null,
      oldText: line,
      newText: line,
    });
    index += 1;
  }

  return { rows, differenceCount };
}

function isDiffMetadataLine(line: string) {
  return line.startsWith('diff --git')
    || line.startsWith('index ')
    || line.startsWith('--- ')
    || line.startsWith('+++ ');
}

function formatDifferenceCount(count: number) {
  return `${count} ${count === 1 ? 'difference' : 'differences'}`;
}

function getMarkdownStats(value: string) {
  return {
    lines: value.length === 0 ? 1 : value.split(/\r\n|\r|\n/).length,
    characters: value.length,
  };
}

function isGitStatus(value: unknown): value is GitStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as GitStatus;
  return typeof candidate.branch === 'string'
    && typeof candidate.changed_files === 'number'
    && typeof candidate.repo_root === 'string';
}

function groupGitBranches(branches: GitBranch[]) {
  return {
    local: branches.filter((branch) => branch.kind === 'local'),
    remote: branches.filter((branch) => branch.kind === 'remote'),
    recent: branches.filter((branch) => branch.kind === 'recent'),
  };
}

function getCurrentBranchLabel(status: GitStatus | null, loading: boolean) {
  if (loading) return '读取分支';
  return status?.branch || '分支';
}

function getBranchSelectorAriaLabel(status: GitStatus | null, loading: boolean) {
  if (loading) return '正在读取分支列表';
  if (!status) return '打开分支列表';
  return `当前分支 ${status.branch}，打开分支列表`;
}

function getGitBranchKindLabel(kind: string) {
  if (kind === 'remote') return '远程分支';
  if (kind === 'recent') return '最近使用分支';
  return '本地分支';
}

function getGitStatusLabel(status: GitStatus | null, loading: boolean) {
  if (loading) return '版本中心读取中';
  if (!status) return '版本中心';
  if (status.changed_files === 0) return '版本中心';
  return `版本中心 · ${status.changed_files} 个改动`;
}

function getGitStatusAriaLabel(status: GitStatus | null, loading: boolean) {
  if (loading) return '版本中心正在读取状态';
  if (!status) return '打开版本中心';
  if (status.changed_files === 0) return '打开版本中心，当前没有改动';
  return `打开版本中心，当前有 ${status.changed_files} 个改动`;
}

function BranchStatusIcon() {
  return (
    <svg className="status-branch-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.75 21.25 12 12 21.25 2.75 12 12 2.75Z" />
      <path d="M8 8v6" />
      <path d="M16 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M8 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M16 10c0 2.7-1.7 4-5 4H8" />
    </svg>
  );
}

function GitMenuIcon() {
  return (
    <svg className="toolbar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3v12" />
      <path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M18 9c0 4-3 6-7 6H6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="branch-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default App;
