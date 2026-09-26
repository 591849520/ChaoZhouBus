# Current Scope — Phase 1：服务端核心数据库与 50 并发排他锁座引擎 (`feat/server-core`)

## 1. Intent（目标结果）
在 `feat/server-core` 分支上完成 `server/` 工程初始化、SQLite 3 (WAL) 数据表 Schema 初始化（`intentions`、`schedules`、`schedule_seats`、`orders`），以及核心选座排他事务与阶梯退票自愈服务（`SeatLockService`），并通过全量自动化测试验证。

## 2. Boundary（边界：不改什么）
- 本阶段聚焦核心数据层与领域事务层（`src/types`、`src/config`、`src/db`、`src/services/seat-lock.ts`），暂不编写 HTTP 路由与小程序页面（归属后续分支）。
- 严格零外部服务依赖（使用 `better-sqlite3`，测试使用 `:memory:` 内存数据库）。

## 3. 验收标准 → 风险路径 → 测试文件/用例矩阵

| 验收标准 (Acceptance Criteria) | 风险路径 (Risk Path) | 测试文件与用例 (`server/src/services/seat-lock.test.ts`) |
| :--- | :--- | :--- |
| **AC-1：53 座固定车模初始化** | `01`/`02` 未设为领队预留（`status=3`）或座位号格式未补零 | `test_01_schedule_init_53_seats_and_reserved_guard`：验证生成 53 座，`01`/`02` 为 `3`，抢 `01` 号座抛 `SEAT_RESERVED` |
| **AC-2：50 并发同抢 1 座零超卖** | 并发请求穿插导致多人同时锁中 `03` 号座或产生脏订单 | `test_02_50_concurrent_requests_single_seat`：50 个并发请求同抢 `03` 号座，断言恰好 1 人成功、49 人报 `SEAT_UNAVAILABLE` |
| **AC-3：多座原子性（防部分锁定）** | 用户同时选 `["05", "06"]` 时 `06` 已被占，导致 `05` 被孤立锁定 | `test_03_multi_seat_atomic_rollback`：断言整单抛错回滚，且 `05` 号座状态仍为 `0 (AVAILABLE)` |
| **AC-4：单人 2 座限购配额管控** | 同一 `openid` 分两次或单次抢超过 2 个座位绕过限购 | `test_04_user_quota_max_2_seats`：已锁 2 座后再抢第 3 座抛 `QUOTA_EXCEEDED`；超时或退票后配额自动恢复 |
| **AC-5：300s 双超时对齐与惰性释放** | 锁座满 300s 后未运行定时任务导致第 301s 仍无法选座 | `test_05_300s_lazy_expiration_and_relock`：`t0` 锁 `04` 号座，`t0 + 299s` 不可抢，`t0 + 301s` 座位图显示 `0` 且他人可直接抢下 |
| **AC-6：支付回调幂等与迟到支付防超卖** | 微信重复回调导致报错；或第 301s 座位被他人抢走后前序订单迟到回调覆盖新主人座位 | `test_06_payment_webhook_idempotency_and_late_pay_guard`：验证重复回调幂等返回；验证迟到支付触发自动原路退款保护 |
| **AC-7：阶梯退票费率计算与席位自愈** | `<24h` 未拦截、`24~48h` (20%) / `>=48h` (5%) 手续费计算错误、退票后座位未变白或配额未退还 | `test_07_tiered_refund_and_seat_self_healing`：验证三档时间窗口退票、手续费分值计算、座位恢复 `0` 及重新购票成功 |

## 4. Done Criteria（完成标准）
- [x] `server/` 依赖安装完成，`npm run typecheck`（`tsc --noEmit`）零错误。
- [x] `npm test`（`npx tsx run-all-tests.ts`）7 大核心测试套件 100% 通过（耗时 83ms）。
