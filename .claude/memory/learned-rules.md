# Learned Rules

## 发版日志约定（2026-05-03）

- 新版本的 GitHub Release 正文用**有序列表**（`1.` `2.` `3.` …）书写变更条目，不用 `-` / `*` 无序列表。
- 正文结构：变更条目在前，`---` 分割线之后是 Assets 下载说明；`extractChangelogItems` 只解析分割线之前的列表项。
- `src/components/UpdateDialog/UpdateDialog.tsx` 的解析器同时兼容有序与无序标记，旧版本 Release（历史上用 `-`）仍能正确解析；该约定只约束新版本的书写方式。
