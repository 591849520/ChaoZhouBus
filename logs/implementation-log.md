# Implementation Log（只追加历史记录）

## 2026-09-26T14:30:00+08:00 — 初始化 `logs/` 工程日志与盘点旧项目拷贝文档
- **触发依据**：用户确认决策 `[D-003] = A`，并指出当前工作区中的文档是从其他项目拷贝而来，需按本项目实际技术选型改造文档。
- **事实核查**：
  - 读取 `AGENTS.md`、`CONTRIBUTING.md`、`CODE_REVIEW_GUIDE.md`、`CHANGELOG.md`、`00-coding-agent-first-law.yaml`。
  - 识别出旧项目残留：Next.js 15、React 19、MongoDB (`MongoMemoryReplSet`)、Yarn 1、550 处 ESLint 历史告警、以及 `yongtu.ai/home` 的 2664 行历史变更记录。
- **执行动作**：
  - 创建 `logs/README.md`、`logs/Scope/current.md`、`logs/Standards/current.md`、`logs/State/current.md`、`logs/Links/current.md`、`logs/Todo/current.md`、`logs/done/.gitkeep`。
- **回退方式**：移除 `logs/` 目录。

## 2026-09-26T15:00:00+08:00 — 完成 D-001=A 技术栈锁定与全套项目规范文档重写
- **触发依据**：用户确认 `[D-001] = A`（微信原生小程序 TS + Node.js TS + Fastify + `better-sqlite3` WAL + 同步排他事务锁）、`[D-002] = A`、`[D-004] = A`。
- **异常与处理**：
  - 初次写入 `CONTRIBUTING.md`、`CODE_REVIEW_GUIDE.md`、`CHANGELOG.md` 时报错 `Access is denied`，排查发现拷贝文件带有 Windows 只读属性（`-ar---`）。
  - 执行 `Get-ChildItem -File | ForEach-Object { $_.IsReadOnly = $false }` 解除只读属性后成功写入。
- **已修改文件**：
  - `AGENTS.md`：写入轻量化技术栈、4 大业务不变性（50 并发同步事务锁、300s 双超时对齐、53 座固定车模、阶梯退票自愈）、目录约定与 `npm` 自检门禁。
  - `CONTRIBUTING.md`：移除旧项目 550 处 ESLint 告警等残留，更新为零外部数据库依赖的本地开发指南。
  - `CODE_REVIEW_GUIDE.md`：移除旧项目 `MongoMemoryReplSet` 模板，替换为基于 `better-sqlite3` `:memory:` 的 50 并发抢座、多座原子回滚、301 秒惰性过期重抢测试模板。
  - `CHANGELOG.md`：清理旧项目 2664 行无关记录，重置为 `ChaoZhouBus` 0.1.0 初始变更日志。
- **回退方式**：通过备份或 Git 恢复上述 4 个 Markdown 文件。

## 2026-09-26T15:10:00+08:00 — 落盘项目唯一需求与架构说明书 `REQUIREMENTS.md`
- **触发依据**：用户提出在开发前应先将整个项目的完整需求文档落盘，防止后续开发出现目标漂移或细节遗漏。
- **执行动作**：
  - 完整提取原始架构方案（`1dc41f6d-58f1-4971-ba73-4eabca45bde5`）中的全部业务细节，结合已敲定的轻量化技术架构（`D-001=A` SQLite WAL + 同步排他事务锁），编写并创建 [REQUIREMENTS.md](../../REQUIREMENTS.md)。
  - 在 `AGENTS.md` 与 `logs/Links/current.md` 中将 `REQUIREMENTS.md` 注册为业务与接口契约的唯一事实源（SSOT）。
- **回退方式**：删除 `REQUIREMENTS.md` 并还原 `AGENTS.md` 顶部链接。
