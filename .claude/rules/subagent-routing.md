# Subagent Routing

## 可用子代理

| 代理 | 职责 |
|------|------|
| planner | 任务分析、方案设计、步骤拆分 |
| executor | 代码实现、文件修改 |
| verifier | 代码审查、测试验证、质量检查 |

## 路由规则

1. **planner**: medium 及以上任务的规划阶段
2. **executor**: 明确方案后的实现阶段
3. **verifier**: 实现完成后的验证阶段

## 跳过条件

- trivial/small 任务可跳过 planner
- 用户明确指示直接执行时可跳过 planner
- 无测试环境时 verifier 仅做静态检查
