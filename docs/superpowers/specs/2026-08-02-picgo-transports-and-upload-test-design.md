# PicGo 传输方式与真实上传测试设计

## 目标

为图片导入增加 PicGo 的两种原生接入方式：PicGo Server HTTP API 与 PicGo CLI。两种方式均提供真实上传测试，使用当前未保存的设置上传一张 1x1 PNG，以确认图床配置、鉴权和上传链路均可用。

PicGo 桌面端通过 Server API 提供服务，因此不新增单独的“PicGo Desktop”模式；用户在 PicGo 桌面端开启 Server 后选择 Server 模式即可。

## 设置与配置

图片导入方式扩展为：

- `picgo-server`：PicGo Server HTTP API，默认地址为 `http://127.0.0.1:36677/upload`。
- `picgo-cli`：调用本机 PicGo CLI，默认命令为 `picgo`，可选指定 PicGo JSON 配置文件路径。

旧的 `picgo` 配置值继续视为 `picgo-server`，确保已有用户的设置无需手动迁移。切换方式后只显示对应字段：

- Server：服务地址与“测试上传”按钮。
- CLI：命令、可选配置文件路径与“测试上传”按钮。

测试结果展示成功或失败状态。成功时显示返回的图片链接；失败时显示可读原因。每个测试区域说明测试会在当前图床留下 1x1 PNG。

## 上传流程

### PicGo Server

继续以 `multipart/form-data` 向配置地址提交 `list` 字段，接受 PicGo 的 `success` 和 `result[0]` HTTP(S) URL。导入与测试复用同一个请求、响应解析和错误处理函数。

### PicGo CLI

后端将剪贴板图片或测试 PNG 写入受控的临时文件，执行：

```text
<picgo-command> [--config <config-path>] upload <temporary-image-path>
```

命令必须以成功状态退出，并从标准输出或错误输出中提取一个 HTTP(S) 图片 URL。找不到命令、进程启动失败、命令失败或未输出 URL 都是明确的失败状态。临时文件无论成功或失败都会删除。

## 测试行为

“测试上传”不会保存设置：它直接使用界面当前字段值，允许用户先验证再保存。

后端生成固定的最小有效 PNG，走与实际导入相同的传输路径。测试不会自动删除远端文件，因为 PicGo 上传器没有统一删除 API。界面在按钮附近告知该副作用。

## 模块边界

- `image_import`：保留 Server 上传实现，新增 CLI 执行、输出 URL 解析和临时测试图生成；两种传输方式共享结果验证。
- Tauri 命令：新增 `test_picgo_upload`，输入为尚未保存的方式与对应配置，返回上传 URL。
- `Settings`：维护测试中、结果状态和模式特定字段；保存逻辑继续通过现有 `update_config`。
- `Editor`：仅按保存后的图片导入方式调用后端，不承担 PicGo 传输细节。

## 错误处理

- Server 地址非 HTTP(S)：提示修正地址。
- Server 无法连接、HTTP 失败或响应格式错误：返回服务错误详情。
- CLI 未安装或命令不可执行：提示检查命令路径与 PicGo 安装。
- CLI 配置文件不存在或上传器未配置：保留 CLI 返回内容并提示检查 PicGo 配置。
- CLI 成功但没有 HTTP(S) URL：提示该 CLI 输出格式不受支持，并建议使用 Server 模式。

## 验证

- 旧 `picgo` 设置可加载为 Server 模式。
- Server 测试使用 multipart `list` 上传最小 PNG，成功时返回 URL，失败时展示错误。
- CLI 测试传入命令与可选配置文件，验证参数、URL 提取、异常退出和临时文件清理。
- 两种 PicGo 方式均能完成剪贴板图片导入并生成 Markdown。
- Settings 仅在对应模式显示字段和测试按钮；测试使用未保存的输入值。
- 运行前端测试、Rust 测试、生产构建、格式及差异检查。
