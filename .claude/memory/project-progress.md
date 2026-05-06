# Project Progress

## 已完成

- [x] 项目骨架初始化
- [x] 需求分析与设计文档
- [x] 实现计划编写
- [x] Task 1: Tauri 2.x + React 18 项目脚手架
- [x] Task 2: 项目结构（前端组件目录）
- [x] Task 2.5: 测试基础设施（Vitest + Rust 测试工具）
- [x] Task 3: AST 解析器（comrak: parse_markdown, walk_nodes, extract_image_urls）
- [x] Task 4: PlatformConverter trait + 6 个平台模块
- [x] Task 5: 基础 HTML 生成器（ast_to_html）
- [x] Task 6: 微信公众号转换器（自定义 HTML，表格转文本）
- [x] Task 7: 剩余 5 个平台转换器（bilibili, csdn, twitter, zhihu, juejin）
- [x] Task 8: 图片磁盘缓存（LRU 淘汰 + SHA256 哈希）
- [x] Task 9: 剪贴板管理器（纯文本、HTML、富文本）
- [x] Task 10: 配置模块（AppConfig 加载/保存）
- [x] Task 11: Tauri Commands（连接后端所有功能）
- [x] Task 12: 前端编辑器组件（@uiw/react-md-editor 集成）
- [x] Task 13: 前端平台栏 + 复制流程
- [x] Task 14: 文件管理（单文件 + 文件夹 + 文件树）
- [x] Task 15: 系统托盘（关闭窗口最小化到托盘，蓝色背景白色M图标）
- [x] Task 16: 自动更新（tauri-plugin-updater）
- [x] Task 17: 设置页面
- [x] Task 19: GitHub Actions CI
- [x] Task 20: Release Workflow
- [x] Task 21: Code Quality (ESLint, rustfmt, clippy)
- [x] Task 22: PR Template + Contributing Guide

## UI 优化（2026-05-04）

- [x] 去掉顶部 MDBridge 标题文字
- [x] 文件、发布、设置菜单移到左边左对齐，添加 SVG 图标
- [x] 去掉右上角编辑/预览/分屏切换按钮（编辑器自带）
- [x] 编辑器默认使用分屏模式
- [x] 设置按钮从右上角移到工具栏菜单区域

## Bug 修复 & 功能增强（2026-05-04）

- [x] 修复文件对话框无响应（添加 Tauri capabilities/default.json 权限配置）
- [x] 新增帮助页面（Markdown 语法速查 + 快捷键，区分 macOS/Windows）
- [x] 帮助页快捷键与编辑器内置快捷键对齐（标题、文本格式、插入元素、列表、编辑操作）
- [x] Vite 代码分割优化（1.2MB 单 chunk → 5 个 chunk，无构建警告）
- [x] 文件树排序分组 + 可拖拽调整宽度
- [x] 文件树默认折叠、一键展开/折叠、定位当前文件按钮
- [x] 修复剪贴板粘贴无反应（同时设置 HTML + 纯文本格式）
- [x] CSDN 标记为不支持外链图片，自动下载内嵌 base64
- [x] 图片下载增加错误反馈和 MIME 文件头检测

## 平台调整与文件树修复（2026-05-06）

- [x] 移除抖音/小红书发布平台（发布菜单、设置页、后端平台注册）
- [x] 删除抖音转换器和抖音专用图片/封面处理逻辑
- [x] 旧配置 default_platform=douyin 自动迁移回 wechat
- [x] 目标平台更新为 6 个：微信公众号、B站专栏、CSDN、推特、知乎、掘金
- [x] 修复文件树右侧拖拽条定位，支持鼠标左右拖动调整左侧文件树宽度
- [x] 拖拽文件树宽度时锁定 col-resize 光标并避免选中文字

## 测试状态

- Rust: 45 tests passing（`cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`）
- Frontend build: passing（`npm run build`）
- Frontend unit: 现有 `npm test -- --run` 仍需补 Tauri API mock，并更新已移除的 MDBridge 标题断言
- 分支: feat/mdbridge-mvp
- 最新提交: chore: remove douyin platform

## MVP 状态: 全部完成
