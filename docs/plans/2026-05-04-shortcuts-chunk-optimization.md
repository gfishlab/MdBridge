# 快捷键完善 & 代码分割优化

## Context

帮助页面已展示快捷键说明（⌘+1~6 标题、⌘+B 加粗等），但：
1. 编辑器的快捷键功能实际已由 `@uiw/react-md-editor` 4.1.0 内置支持（标题、加粗、斜体等），无需额外绑定
2. 只有 `⌘+S` 保存在 App.tsx 作为 window 全局监听器实现，编辑器内的快捷键都已开箱即用
3. 前端构建产出一个 1.2MB 的单 JS chunk，需要代码分割

## 实际工作

### 1. 更新帮助页面快捷键内容（与编辑器实际内置快捷键对齐）

**文件:** `src/components/Help/Help.tsx`

编辑器内置快捷键完整列表：
- `⌘/Ctrl+1~6` — 标题 1-6
- `⌘/Ctrl+B` — 加粗
- `⌘/Ctrl+I` — 斜体
- `⌘/Ctrl+Q` — 引用
- `⌘/Ctrl+L` — 链接
- `⌘/Ctrl+K` — 图片
- `⌘/Ctrl+J` — 行内代码
- `⌘/Ctrl+Shift+J` — 代码块
- `⌘/Ctrl+H` — 分割线
- `⌘/Ctrl+/` — 注释
- `Ctrl+Shift+U` — 无序列表
- `Ctrl+Shift+O` — 有序列表
- `Ctrl+Shift+C` — 待办列表
- `Ctrl+Shift+X` — 删除线
- `Ctrl+D` — 复制行
- `Alt+↑/↓` — 移动行

当前帮助页缺少很多快捷键（引用、图片、列表、代码块等），需要补全。

### 2. Vite 代码分割优化

**文件:** `vite.config.ts`

在 `build.rollupOptions.output.manualChunks` 中拆分大型第三方依赖：
- `react-vendor`: react, react-dom
- `md-editor`: @uiw/react-md-editor, @uiw/react-markdown-preview, rehype 相关
- `index`: 应用代码

目标：每个 chunk < 500KB

## 验证

1. `npx vite build` 确认无 chunk size 警告
2. `npx tauri dev` 启动应用，在编辑器中测试快捷键：
   - ⌘+1~6 切换标题级别
   - ⌘+B 加粗、⌘+I 斜体
   - ⌘+J 行内代码
   - ⌘+S 保存
3. 点击帮助按钮确认快捷键列表完整且区分系统
