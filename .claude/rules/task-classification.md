# Task Classification

## 任务分级

| 级别 | 描述 | 处理方式 |
|------|------|----------|
| trivial | 单行修改、变量重命名 | 直接执行 |
| small | 单文件修改、简单 bug 修复 | 直接执行，可选 review |
| medium | 多文件修改、新功能模块 | 使用 planner → executor → verifier |
| large | 架构变更、跨模块重构 | 完整子代理流程 + 用户确认 |

## 升级条件

- 涉及 3 个以上文件 → 至少 medium
- 修改公开 API → 至少 medium
- 涉及安全/认证 → 至少 medium
