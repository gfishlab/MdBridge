# Project Progress

## 已完成

- [x] 项目骨架初始化
- [x] 需求分析与设计文档
- [x] 实现计划编写
- [x] Task 1: Tauri 2.x + React 18 项目脚手架
- [x] Task 2: 项目结构（前端组件目录）
- [x] Task 2.5: 测试基础设施（Vitest + Rust 测试工具）
- [x] Task 3: AST 解析器（comrak: parse_markdown, walk_nodes, extract_image_urls）
- [x] Task 4: PlatformConverter trait + 7 个平台桩模块
- [x] Task 5: 基础 HTML 生成器（ast_to_html）
- [x] Task 6: 微信公众号转换器（自定义 HTML，表格转文本）
- [x] Task 7: 剩余 6 个平台转换器（bilibili, csdn, douyin, twitter, zhihu, juejin）
- [x] Task 8: 图片磁盘缓存（LRU 淘汰 + SHA256 哈希）
- [x] Task 9: 剪贴板管理器（纯文本、HTML、富文本）
- [x] Task 10: 配置模块（AppConfig 加载/保存）

## 测试状态

- Rust: 49 tests passing
- Frontend: 1 test passing
- 分支: feat/mdbridge-mvp

## 待办

- [ ] Task 11: Tauri Commands（连接后端所有功能）
- [ ] Task 12: 前端编辑器组件（@uiw/react-md-editor 集成）
- [ ] Task 13: 前端平台栏 + 复制流程
- [ ] Task 14: 文件管理（单文件 + 文件夹 + 文件树）
- [ ] Task 15: 系统托盘（关闭窗口最小化到托盘）
- [ ] Task 16: 自动更新（tauri-plugin-updater）
- [ ] Task 17: 设置页面
- [ ] Task 19-22: CI/CD、发布流程、代码质量、PR 模板
