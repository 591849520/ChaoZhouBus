# Current Links — 证据与引用索引

## 1. 关联会话与需求来源
- 原始架构方案会话：`conversation://1dc41f6d-58f1-4971-ba73-4eabca45bde5`
- 当前实施会话：`conversation://24d0a6f5-2a65-4ea7-8b10-78dd2e76b5f7`

## 2. 决策账本（全部已锁定）
- **[D-001] 轻量化全栈技术选型**：`用户已决定` → 选择 **A（微信原生小程序 TS + Node.js TS + Fastify + `better-sqlite3` WAL 模式 + 同步事务排他锁，零外部 MySQL/Redis 依赖）**（2026-09-26）。
- **[D-002] 仓库目录结构约定**：`用户已决定` → 选择 **A（`miniprogram/` + `server/` + `deploy/` + `logs/`）**（2026-09-26）。
- **[D-003] 是否初始化 `logs/` 本地工程日志目录**：`用户已决定` → 选择 **A（立即初始化 `logs/` 标准结构）**（2026-09-26）。
- **[D-004] 存量规范文档改造方案**：`用户已决定` → 选择 **A（全面清理旧项目残留并适配新项目）**（2026-09-26）。

## 3. 核心规范文件引用
- [REQUIREMENTS.md](../../REQUIREMENTS.md)（项目需求、数据库 DDL 与接口契约唯一事实源）
- [AGENTS.md](../../AGENTS.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [CODE_REVIEW_GUIDE.md](../../CODE_REVIEW_GUIDE.md)
- [CHANGELOG.md](../../CHANGELOG.md)
- [00-coding-agent-first-law.yaml](../../00-coding-agent-first-law.yaml)
