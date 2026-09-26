# Current Standards — 实施约束与质量门禁

## 1. 技术栈与架构基准（已由 D-001=A, D-002=A 锁定）
- **客户端**：微信原生小程序（TypeScript/JS + WXML + WXSS）
- **服务端**：Node.js 20+ + TypeScript 5 (`strict: true`) + Fastify + `zod`
- **数据库与并发控制**：SQLite 3 (`better-sqlite3`，强制开启 `WAL` 模式与 `foreign_keys = ON`) + Node.js 单线程同步排他事务 (`db.transaction(...).immediate()`) + `locked_until` 时间戳惰性过期（300 秒双超时对齐）
- **目录结构**：`miniprogram/` + `server/` + `deploy/` + `logs/`

## 2. 执行与 Git 铁律（最高优先级人工控制门禁）
- **铁律 1（先审方案后执行）**：执行任务前，必须先将完整方案输出给用户审核，获得明确批准后才可以动手执行。
- **铁律 8（禁止自动提交与推送）**：严禁自动执行 `git commit`、`git merge` 或 `git push`，必须等待用户明确批准提交推送后才可执行。

## 2. 业务核心不变性（Domain Invariants）
- **50 并发原子排他锁**：选座锁在同一个 `db.transaction` 同步事务中完成配额检查、座位惰性过期判定与锁定落库，支持单人多座（最多 2 座）全成功或全失败，消除部分锁定。
- **双重超时对齐（Dual-Timeout Guard）**：座位锁 `locked_until`（`now + 300s`）与微信支付 `time_expire`（`now + 300s`）严格对齐。
- **固定车模**：53 座物理布局（前排 1-48 号 `2+2` 布局，后排 49-53 号 `5 连座`）。
- **席位自愈**：退票或超时未支付后，座位状态与配额必须准确回滚释放。
