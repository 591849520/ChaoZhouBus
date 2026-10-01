# Current Scope — Phase 7：生产级极轻量部署、探活监控与 SQLite 原生热备份灾备体系 (`feat/production-deploy`)

## 1. Intent（目标结果）
在 `feat/production-deploy` 分支上完成生产级部署配置与冷热灾备能力建设：
1. **服务探活与健康监控**：新增 `GET /health` 端点（返回系统版本、运行秒数、SQLite 数据库连接健康状态、服务器时戳），支持云负载均衡与监控系统高频探活。
2. **SQLite 原生非阻塞热备份与 7 天自动轮转清理**：利用 `better-sqlite3` 原生 `.backup()` API 实现在线热快照，编写 `server/src/db/backup.ts` 与 `server/src/db/backup.test.ts`，支持按保留天数（默认 7 天）自动清理过期备份。
3. **管理端在线热备份 API**：新增 `POST /api/v1/admin/backup`，支持管理员或定时脚本安全触发即时快照。
4. **全套生产部署配置交付 (`deploy/`)**：
   - `deploy/Dockerfile`：Node.js 20 Alpine 多阶段构建，原生编译 better-sqlite3 C++ 扩展，最终精简镜像 < 150MB。
   - `deploy/docker-compose.yml`：开箱即用，支持数据目录与日志持久化挂载，自带健康探活巡检。
   - `deploy/nginx/chaozhoubus.conf`：强制 HTTPS 301 重定向、Certbot ACME 证书自动化、反向代理、真实 IP 穿透、抢票接口限流（20r/s，突发 40r/s）与 `/health` 探活免限流。
   - `deploy/backup-sqlite.sh`：Linux crontab 每日凌晨 02:00 自动执行脚本，支持 Docker 与宿主机双环境，7 天过期自动清理。
   - `deploy/ecosystem.config.cjs`：PM2 单实例（instances: 1）进程守护配置，避免跨进程文件锁竞争。
   - `deploy/.env.production.example`：生产环境变量完整模板。
   - `deploy/README.md`：10 分钟快速上线、SSL 申请与 30 秒极速灾备恢复手册。

## 2. 验收标准 → 风险路径 → 测试用例矩阵

| 验收标准 (Acceptance Criteria) | 风险路径 (Risk Path) | 测试文件与用例 |
| :--- | :--- | :--- |
| **AC-1：服务探活端点 `GET /health`** | 数据库断连未被捕获或探活失败 | `server/src/app.test.ts`：断言 HTTP 200，`status: 'ok'`，`db_status: 'connected'`，`uptime_seconds >= 0` |
| **AC-2：SQLite 原生在线热备份与数据一致性** | 备份过程中损坏、表结构或数据缺失 | `server/src/db/backup.test.ts`：使用内存数据库建表并插入数据，执行热备份，重新打开备份文件断言数据无损还原 |
| **AC-3：备份快照 7 天自动生命周期清理** | 过期备份堆积撑爆服务器磁盘，或误删有效备份 | `server/src/db/backup.test.ts`：模拟 15 天前旧文件与当前新鲜文件，断言准确清理 1 份过期文件，保留最新文件 |
| **AC-4：管理端触发热备份 API** | 未鉴权访问或备份后无法落盘 | `server/src/app.test.ts`：使用 `x-admin-token` 请求 `POST /api/v1/admin/backup`，断言返回文件名、路径且文件真实存在 |

## 3. Done Criteria（完成标准）
- [x] `server/src/db/backup.ts` 与 `server/src/db/backup.test.ts` 编写完成。
- [x] `server/src/app.ts` 注册 `GET /health` 与 `POST /api/v1/admin/backup`，集成测试覆盖。
- [x] `deploy/` 下 7 个生产级配置文件与完整运维文档就绪。
- [x] `npm run typecheck` 0 错误，`npm test` 5 个套件全部通过。
- [x] 严格遵循铁律 8：严禁自动提交/推送，等待用户最终明确指令。
