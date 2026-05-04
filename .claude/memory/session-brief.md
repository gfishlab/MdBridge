# Session Brief

## 项目

MDBridge — 跨平台桌面 Markdown 编辑器，支持将 MD 文档转换为适配 7 个媒体平台的格式，通过剪贴板复制供粘贴发布。

## 当前状态

- 分支: `feat/mdbridge-mvp`（已推送到 GitHub）
- Chunk 1-3 已完成（Task 1-10），49 个 Rust 测试通过
- 转换引擎、图片缓存、剪贴板、配置模块均已实现
- 下一步: Task 11（Tauri Commands）开始 Chunk 4

## 技术栈

- Tauri 2.x + Rust 后端
- React 18 + TypeScript 前端
- @uiw/react-md-editor 编辑器
- comrak AST 解析
- arboard 剪贴板
- tauri-plugin-updater 自动更新

## 目标平台

微信公众号、B站专栏、CSDN、抖音/小红书、推特、知乎、掘金
