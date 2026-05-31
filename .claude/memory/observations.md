# Observations

## 2026-05-09 — Tauri 自动更新签名私钥位置

- MDBridge 每次发布/自动更新清单签名使用的本地私钥文件位于：`~/.tauri/mdbridge-updater.key`
- 当前机器绝对路径：`/Users/gfish/.tauri/mdbridge-updater.key`
- 该路径只用于本地构建时读取私钥，例如通过 `TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/mdbridge-updater.key")"` 注入环境变量。
- 不要把私钥内容写入仓库、日志、记忆文件或聊天回复；GitHub Actions 发布使用仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
