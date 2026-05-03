# MdBridge

## 项目目标

跨平台（Mac + Windows）桌面 Markdown 编辑器，将 MD 文档转换为适配多个媒体平台的格式，通过剪贴板复制供用户粘贴发布。**不涉及自动发布**，仅做格式转换 + 复制到剪贴板。

## 目标平台

微信公众号、B站专栏、CSDN、抖音/小红书、推特、知乎、掘金（共 7 个）

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Tauri 2.x |
| 后端 | Rust |
| 前端 | React 18 + TypeScript |
| 编辑器 | @uiw/react-md-editor (CodeMirror 6) |
| MD 解析 | comrak (CommonMark AST) |
| 剪贴板 | arboard |
| 自动更新 | tauri-plugin-updater |

## 验收标准

1. 用户可在编辑区用标准 Markdown 语法写作，支持实时预览
2. 点击"发布"按钮弹出平台下拉菜单，选择平台后自动转换格式并复制到剪贴板
3. 粘贴到对应平台编辑器后格式正确，无需手动调整
4. 支持打开单个 .md 文件和文件夹（含文件树）
5. 图片链接对支持外链的平台原样保留，对不支持外链的平台自动下载并内嵌
6. 图片缓存使用磁盘 LRU 策略，上限 500MB 可配置
7. 关闭窗口时最小化到系统托盘，不退出应用
8. 支持自动更新（下载→替换→提示重启）
9. 提供设置页（缓存大小、默认平台、快捷键配置、检查更新开关）
10. 快捷键：保存 `Cmd/Ctrl+S`、快速发布 `Cmd/Ctrl+Shift+P`、呼出窗口 `Cmd/Ctrl+Shift+M`

## 项目约定

- 设计文档：`docs/plans/2026-05-03-mddesign-design.md`
- 实现计划：`docs/plans/2026-05-03-mdbridge-implementation.md`
- 详细规则见 `.claude/rules/`
- 子代理定义见 `.claude/agents/`
- 项目记忆见 `.claude/memory/`

## 工作流

1. 新会话自动加载 `session-brief.md`
2. 中等及以上任务读取 `project-progress.md`
3. 子代理路由规则见 `subagent-routing.md`
