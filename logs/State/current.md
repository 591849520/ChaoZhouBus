# Current State — 工作区与执行状态

## 1. 基线状态
- 更新时间：`2026-09-26T15:25:00+08:00`
- 当前分支：`feat/server-core`（基于 `main` 提交 `d3ba94c` 切出）

## 2. 已完成切片
- [x] **Slice 1**：完成 `logs/` 工程日志目录初始化与规范文档去旧化重写，落盘唯一事实源 [REQUIREMENTS.md](../../REQUIREMENTS.md)，并提交至 `main` 基线（`d3ba94c`）。
- [x] **Slice 2（Phase 1 核心服务端与 50 并发排他事务引擎）**：
  - 创建 `server/package.json`、`server/tsconfig.json`、`server/.env.example`、`server/run-all-tests.ts`
  - 实现领域类型 [domain.ts](../../server/src/types/domain.ts) 与配置 [env.ts](../../server/src/config/env.ts)
  - 实现 SQLite 3 (WAL) 表结构初始化 [schema.ts](../../server/src/db/schema.ts)
  - 实现核心选座排他事务与阶梯退票自愈服务 [seat-lock.ts](../../server/src/services/seat-lock.ts)
  - 实现并跑通 7 大核心不变性测试套件 [seat-lock.test.ts](../../server/src/services/seat-lock.test.ts)
  - 验证证据：`npm run typecheck` 零错误；`npm test` 全部通过（`83ms`）。

## 3. 下一阶段计划（Phase 2）
- 在合并 `feat/server-core` 入 `main` 后，切出 `feat/api-and-export` 分支，实现：
  1. 管理员 A4 检票名册 Excel 导出服务（`RosterExportService` + `roster-export.test.ts`）与返乡意向统计服务；
  2. Fastify REST API 路由层（完整实现 `REQUIREMENTS.md` 第五章全部 11 个 API 接口）与本地启动入口 `server/src/index.ts`。
