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

- Rust: 44 tests passing（`cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`）
- Frontend build: passing（`npm run build`）
- Frontend unit: 1 test passing（`npm test -- --run`）
- 分支: main（默认分支已从 feat/mdbridge-mvp 切换到 main）
- 版本: v0.1.2

## MVP 状态: 全部完成

## README 与文档（2026-05-07）

- [x] 编写中文简体 README.md（功能特性、支持平台、技术栈、开发指南、快捷键、项目结构）
- [x] 添加应用截图（编辑器、文件菜单、发布菜单、帮助页面）
- [x] GitHub 仓库默认分支从 feat/mdbridge-mvp 切换到 main

## 功能增强（2026-05-07）

- [x] 文件菜单新增「新建文档」按钮
  - 无文件夹时：清空编辑器，显示空白文档
  - 有文件夹时：触发文件树内联输入框，输入文件名后在当前文件夹下创建 .md 文件
- [x] 文件树工具栏新增「新建文档」按钮（右上角 + 图标），点击后在文件树顶部弹出输入框
- [x] 修复保存按钮错误使用 open() 对话框的问题，改为 save() 保存对话框
- [x] 文件树新建按钮使用内联输入框替代被 Tauri WKWebView 屏蔽的 prompt()

## 文件管理增强（2026-05-07）

- [x] 文件树右键菜单：右键点击 .md 文件弹出上下文菜单
  - 复制文件路径：将绝对路径复制到系统剪贴板（跨平台，路径格式由操作系统决定）
  - 删除文件：确认后删除该文件，自动刷新文件树
- [x] Rust 后端新增 delete_file 命令（仅允许删除 .md 文件，防止误操作）

## 实时文件刷新竞态修复 & 发布 v0.1.7（2026-05-31）

- [x] 修复实时文件刷新的 stale-read 覆盖问题：每次 `read_file` 异步读取完成后，重新校验本地编辑状态与当前活动文件，避免读取窗口期内的按键或文件切换被陈旧的外部内容覆盖
- [x] 新增竞态回归测试（src/App.test.tsx）
- [x] 版本升级到 0.1.7（package.json / Cargo.toml / Cargo.lock / tauri.conf.json）
- [x] 提交并推送 main，打 tag v0.1.7 触发 Release workflow（macOS / Windows / Linux 三平台构建）

## 发布日志（changelog）补全（2026-05-31）

- 问题：Release workflow 的 `releaseBody` 是写死的通用下载说明，每个版本都没有变更记录
- [x] 新增 `CHANGELOG.md`，按版本（v0.1.5/v0.1.6/v0.1.7）记录中文变更日志
- [x] 用真实变更内容回填 GitHub Release v0.1.7 的说明（`gh release edit`）
- [x] 改造 `.github/workflows/release.yml`：新增 changelog 提取步骤，按 tag 版本从 `CHANGELOG.md` 抽取对应小节作为 releaseBody，后续发版自动带上当版变更日志
- 约定：以后发版前先在 `CHANGELOG.md` 增加 `## v<version>` 小节，CI 会自动提取
