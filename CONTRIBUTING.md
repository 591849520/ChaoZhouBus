# 贡献与本地开发指南（CONTRIBUTING）

> 面向 `ChaoZhouBus`（高校同乡会大巴智能选座购票小程序系统）的开发协作单一入口。
> AI 生成代码约束见 [AGENTS.md](AGENTS.md)；单元测试与 50 并发防超卖测试写法见 [CODE_REVIEW_GUIDE.md](CODE_REVIEW_GUIDE.md)。

## 一、环境准备（零外部数据库依赖）

本项目采用 **Node.js + TypeScript + SQLite 3 (WAL 高并发模式)** 极简全栈架构，**本地开发无需安装 MySQL 或 Redis**：

```bash
# 1. 进入服务端目录并安装依赖
cd server
npm install

# 2. 复制本地环境变量配置
cp .env.example .env

# 3. 启动本地开发服务器（自动初始化 SQLite WAL 数据库与 53 座测试班次）
npm run dev
```

小程序端开发准备：
1. 打开 **微信开发者工具**，导入仓库下的 `miniprogram/` 目录。
2. 在微信开发者工具“详情 → 本地设置”中勾选 **“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”**，即可直接连接本地 `http://localhost:3000` 服务端接口进行选座与购票联调。

## 二、完整开发流程

```text
拉分支 → 写代码(+同目录 .test.ts 测试) → 本地自查(lint/typecheck/test) → 更新 logs/ 证据链 → 提交(规范信息) → 合并入 main
```

**核心原则：没有测试的代码不允许合入 `main`。任何涉及座位锁、订单状态、退票释放的改动必须通过并发与边界测试断言。**

## 三、分支命名

- `feat/简述`：新功能，如 `feat/seat-lock-transaction`、`feat/roster-excel-export`
- `fix/简述`：缺陷修复，如 `fix/refund-quota-restore`
- `chore/简述` / `docs/简述` / `refactor/简述`：构建、文档或重构

## 四、提交信息（Conventional Commits）

格式 `type(scope): 描述`：

| type                                       | 含义       | 常用 scope 示例                                       |
| ------------------------------------------ | ---------- | ----------------------------------------------------- |
| `feat`                                     | 新功能     | `seat` `order` `pay` `refund` `admin` `export`        |
| `fix`                                      | 缺陷修复   | `seat` `order` `pay` `refund`                         |
| `perf`                                     | 性能优化   | `db` `seat`                                           |
| `refactor`                                 | 重构       | `server` `miniprogram`                                |
| `docs` `test` `chore` `ci` `build` `style` | 工程与测试 | `docs` `test` `deploy`                                |

- ✅ `feat(seat): 实现基于 SQLite WAL 排他事务的 50 并发双座原子锁`
- ✅ `feat(export): 支持按上车站点时序分块导出 A4 检票名册 Excel`
- ❌ `WIP：xxx`、`update`、`fix bug`、`临时提交`

## 五、提交前本地自查

```bash
npm run lint         # ESLint 代码规范检查（零 error、禁止 any）
npm run typecheck    # TypeScript 严格类型检查（tsc --noEmit）
npm run format       # Prettier 格式化
npm test             # 运行全部单元测试与 50 并发抢座断言
```

## 六、零技术债与生产安全门禁

本项目从零构建，严格执行**零技术债门禁**：

1. **零 `any` 容忍**：入参统一使用 `zod` 校验并推导 TypeScript 类型。
2. **事务边界强制闭合**：所有涉及 `schedule_seats`（座位状态）与 `orders`（订单状态）的修改，必须包裹在 `better-sqlite3` 的 `db.transaction(...).immediate()` 中，严禁在事务中穿插异步 I/O。
3. **数据备份极简规范**：生产环境 SQLite 数据库文件位于 `server/data/chaozhou_bus.db`，发车售票期通过 `deploy/backup-sqlite.sh`（基于 SQLite Online Backup API `.backup`）定时快照备份。

## 七、快速参考

| 操作                 | 命令                                          |
| -------------------- | --------------------------------------------- |
| 安装服务端依赖       | `cd server && npm install`                    |
| 启动本地服务端       | `cd server && npm run dev`                    |
| 全量质量自检         | `cd server && npm run lint && npm run typecheck && npm test` |
| 运行单个模块测试     | `cd server && npx tsx src/services/seat-lock.test.ts` |
| 运行全部测试与压测   | `cd server && npm test`                       |
