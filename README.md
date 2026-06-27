# MDBridge

跨平台桌面 Markdown 编辑器，将文章转换为适配多个媒体平台的格式并复制到剪贴板，你只需前往目标平台粘贴即可完成发布。**不涉及自动发布**，仅做格式转换 + 剪贴板复制。

## 功能特性

- **实时预览** — 左侧 Markdown 编辑，右侧实时渲染，所见即所得
- **一键复制** — 选择目标平台，自动转换格式并复制到剪贴板，然后前往对应平台编辑器粘贴即可
- **6 大平台支持** — 微信公众号、B站专栏、CSDN、知乎、掘金、推特
- **智能图片处理** — 不支持外链的平台自动下载图片并内嵌为 base64
- **文件管理** — 支持打开单个 .md 文件或整个文件夹，文件树侧栏可调宽、可一键左右折叠
- **Git 版本历史** — 在本地 Git 仓库中查看本地/远程/最近分支、提交路线、当前文档提交历史、提交者和 diff，并支持恢复历史版本、提交当前文档、拉取、推送和基础冲突比对
- **系统托盘** — 关闭窗口最小化到托盘，不退出应用
- **自动更新** — 内置版本检查与更新功能
- **快捷键** — 保存 `Cmd/Ctrl+S`、快速发布 `Cmd/Ctrl+Shift+P`

## 截图

### 主界面

左侧 Markdown 编辑，右侧实时渲染预览，所见即所得。

![MDBridge 主界面](https://cdn.jsdelivr.net/gh/gfishlab/img-bed/images/mdbridge-editor.png)

### 文件树

打开文件夹后，左侧文件树侧栏展示目录结构，支持拖拽调宽、定位当前文件，并可一键左右折叠以腾出编辑空间。

![文件树](https://cdn.jsdelivr.net/gh/gfishlab/img-bed/images/mdbridge-filetree.png)

### 发布菜单

选择目标平台后，内容会自动转换格式并复制到剪贴板。然后打开对应平台的编辑器（如微信公众号后台），直接粘贴即可。

![发布菜单](https://cdn.jsdelivr.net/gh/gfishlab/img-bed/images/mdbridge-publish.png)

### 设置

可配置图片缓存大小、默认发布平台、启动时检查更新等。

![设置](https://cdn.jsdelivr.net/gh/gfishlab/img-bed/images/mdbridge-settings.png)

### 帮助页面

内置 Markdown 语法与快捷键速查表。

![帮助页面](https://cdn.jsdelivr.net/gh/gfishlab/img-bed/images/mdbridge-help.png)

## 支持平台

| 平台 | 外链图片 | 特殊处理 |
|------|:--------:|---------|
| 微信公众号 | ✅ | 表格转文本 |
| B站专栏 | ❌ | 图片 base64 内嵌 |
| CSDN | ⚠️ | 外链图片支持不稳定，CDN 异常时自动 base64 内嵌 |
| 知乎 | ✅ | — |
| 掘金 | ✅ | — |
| 推特 | ✅ | 纯文本模式 |

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Tauri 2.x |
| 后端 | Rust |
| 前端 | React 18 + TypeScript |
| 编辑器 | @uiw/react-md-editor |
| MD 解析 | comrak (CommonMark AST) |
| 剪贴板 | arboard |
| 自动更新 | tauri-plugin-updater |

## 开发

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.70
- [Tauri 2.x CLI](https://v2.tauri.app/start/prerequisites/)

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/gfishlab/MdBridge.git
cd MdBridge

# 安装前端依赖
npm install

# 开发模式运行
npm run tauri dev
```

### 构建

```bash
# 构建生产版本
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

### 测试

```bash
# 前端测试
npm test

# Rust 测试
npm run test:rust
```

## 快捷键

| 功能 | macOS | Windows/Linux |
|------|-------|---------------|
| 保存 | `⌘ S` | `Ctrl S` |
| 快速发布 | `⌘ ⇧ P` | `Ctrl Shift P` |
| 呼出窗口 | `⌘ ⇧ M` | `Ctrl Shift M` |
| 加粗 | `⌘ B` | `Ctrl B` |
| 斜体 | `⌘ I` | `Ctrl I` |
| 插入链接 | `⌘ L` | `Ctrl L` |
| 插入图片 | `⌘ K` | `Ctrl K` |
| 插入代码 | `⌘ J` | `Ctrl J` |

## 项目结构

```
MdBridge/
├── src/                        # React 前端
│   ├── components/
│   │   ├── Editor/             # Markdown 编辑器
│   │   ├── FileTree/           # 文件树
│   │   ├── Help/               # 帮助页面
│   │   ├── PlatformBar/        # 发布菜单
│   │   ├── Settings/           # 设置页面
│   │   └── UpdateDialog/       # 更新对话框
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/                  # Rust 后端
│   └── src/
│       ├── commands/           # Tauri Commands
│       ├── config/             # 配置管理
│       ├── converter/          # 转换引擎
│       │   ├── ast.rs          # AST 解析
│       │   ├── html.rs         # HTML 生成
│       │   └── platforms/      # 各平台转换器
│       ├── clipboard/          # 剪贴板管理
│       ├── image_cache/        # 图片缓存 (LRU)
│       ├── tray/               # 系统托盘
│       └── updater/            # 自动更新
├── docs/                       # 文档
└── package.json
```

## 贡献

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT
