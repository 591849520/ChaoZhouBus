# 代码审查与测试指南（CODE_REVIEW_GUIDE）

> 目标：确保 `ChaoZhouBus` 每次代码变更都经过 **内存库单测 + 50 并发防超卖验证 → 审查 → 合入**，确保返乡开票零事故。
> 协作流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；AI 生成代码约束见 [AGENTS.md](AGENTS.md)。

---

## 一、总体流程

```text
明确验收矩阵 → 写业务代码 → 写同目录 .test.ts 测试 → 本地跑通(npm run lint/typecheck/test) → AI 代码审查 → 合入
```

**核心原则：没有自动化测试的代码不允许合入。涉及抢座、支付回调、阶梯退票的改动必须包含并发与幂等测试。**

---

## 二、开发与测试提示词模板

### 2.1 开始写代码前的 System Prompt

```text
你是思路严谨的全栈工程师，正在开发“高校同乡会大巴智能选座购票小程序系统（ChaoZhouBus）”，请严格遵循 AGENTS.md：

1. 更改多文件或数据结构前先讲思路，经确认后再修改代码。
2. 服务端使用 Node.js + TypeScript (strict: true) + Fastify + better-sqlite3 (WAL 模式)，禁止使用 any。
3. 核心并发锁采用 better-sqlite3 的 db.transaction(...).immediate() 同步排他事务 + locked_until 时间戳惰性过期（300 秒双超时对齐），无需外部 Redis。
4. 写完逻辑后必须编写同目录 `<name>.test.ts` 测试，使用 `new Database(':memory:')` 独立内存库，覆盖正常路径、边界条件、异常拦截与并发冲突。
```

### 2.2 写测试时的提示词

```text
请为以下代码编写自动化测试，要求：

1. 使用 Node.js 内置的 `node:assert/strict`，通过 `npx tsx <测试文件路径>` 直接运行。
2. 数据库测试使用 `better-sqlite3` 的 `new Database(':memory:')`，每个测试用例独立初始化 Schema，测试结束后 `db.close()`。
3. 必须覆盖：
   - 正常路径（如正常锁座、支付确认、按站点导出名册）
   - 边界条件（单人刚好 2 座上限、锁座满 300 秒后的第 301 秒惰性释放重抢、距发车恰好 24 小时退票边界）
   - 异常处理（超额购买第 3 座、抢领队预留座、距发车 < 24 小时退票拦截、多座中 1 座被占整单回滚）
   - 并发与幂等（50 个并发请求同时抢 03 号座位，仅 1 人成功、49 人返回冲突；微信支付/退款 Webhook 重复回调幂等处理）
```

---

## 三、单元测试与并发测试怎么写

### 3.1 测试框架与内存 SQLite 隔离模式

本项目使用 Node.js 内置的 `node:assert/strict` + `tsx` 运行器，配合 `better-sqlite3` 的 `:memory:` 模式，**无需启动任何外部数据库容器即可在数毫秒内完成完整 ACID 事务与 50 并发压测**。

### 3.2 核心模板：50 并发抢座 & 300s 惰性超时 & 多座原子回滚测试

```typescript
/**
 * 选座与排他锁服务单元测试
 * 运行：npx tsx server/src/services/seat-lock.test.ts
 */
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema'
import { SeatLockService } from './seat-lock'

function createTestContext() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  const service = new SeatLockService(db)
  return { db, service }
}

export default async function run() {
  // ═══════════════════════════════════════════════════
  // 1. 50 并发同时抢同一座位（03号）：断言仅 1 人成功，49 人失败
  // ═══════════════════════════════════════════════════
  {
    const { db, service } = createTestContext()
    try {
      const scheduleId = service.seedTestSchedule({ totalSeats: 53 })
      const nowMs = 1_700_000_000_000

      const tasks = Array.from({ length: 50 }, (_, idx) =>
        Promise.resolve().then(() =>
          service.lockSeats({
            scheduleId,
            userId: `user_${idx + 1}`,
            seatNumbers: ['03'],
            pickupStation: '大学城校区',
            dropoffStation: '潮州体育馆',
            nowMs,
          }),
        ),
      )

      const results = await Promise.allSettled(tasks)
      const succeeded = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')

      assert.equal(succeeded.length, 1, '50 并发抢 03 号座必须仅有 1 人成功')
      assert.equal(rejected.length, 49, '其余 49 人必须全部被原子拦截')
      console.log('[seat-lock] 50-concurrency single-seat assertion passed')
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════
  // 2. 多座原子性：同抢 ["05", "06"]，其中 "06" 已被占，断言 "05" 不发生部分锁定
  // ═══════════════════════════════════════════════════
  {
    const { db, service } = createTestContext()
    try {
      const scheduleId = service.seedTestSchedule({ totalSeats: 53 })
      const nowMs = 1_700_000_000_000

      // 用户 A 先锁定 06 号座
      service.lockSeats({
        scheduleId,
        userId: 'user_A',
        seatNumbers: ['06'],
        pickupStation: '本部校区',
        dropoffStation: '潮州客运站',
        nowMs,
      })

      // 用户 B 尝试同时锁定 ["05", "06"]，应整单抛错回滚
      assert.throws(
        () =>
          service.lockSeats({
            scheduleId,
            userId: 'user_B',
            seatNumbers: ['05', '06'],
            pickupStation: '本部校区',
            dropoffStation: '潮州客运站',
            nowMs,
          }),
        /SEAT_UNAVAILABLE/,
        '部分座位被占用时必须整单抛错回滚',
      )

      // 验证 05 号座位依然处于空闲状态（未被部分锁定）
      const seat05 = service.getSeatStatus(scheduleId, '05', nowMs)
      assert.equal(seat05.status, 0, '05 号座必须保持 AVAILABLE (0) 状态')
      console.log('[seat-lock] multi-seat atomic rollback passed')
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════
  // 3. 300 秒双超时惰性释放：第 301 秒新用户可直接抢下超时未付座位
  // ═══════════════════════════════════════════════════
  {
    const { db, service } = createTestContext()
    try {
      const scheduleId = service.seedTestSchedule({ totalSeats: 53 })
      const t0 = 1_700_000_000_000

      // 用户 A 在 t0 锁定 04 号座（有效期至 t0 + 300_000ms）
      service.lockSeats({
        scheduleId,
        userId: 'user_A',
        seatNumbers: ['04'],
        pickupStation: '本部校区',
        dropoffStation: '潮州体育馆',
        nowMs: t0,
      })

      // 301 秒后（t0 + 301_000ms），用户 B 抢 04 号座应直接成功（惰性释放）
      const lockRes = service.lockSeats({
        scheduleId,
        userId: 'user_B',
        seatNumbers: ['04'],
        pickupStation: '本部校区',
        dropoffStation: '潮州体育馆',
        nowMs: t0 + 301_000,
      })
      assert.equal(lockRes.lockedBy, 'user_B', '超时 300s 后座位应自动释放并允许用户 B 锁定')
      console.log('[seat-lock] 301s lazy expiration & re-lock passed')
    } finally {
      db.close()
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

---

## 四、测试必须覆盖的业务风险矩阵

| 业务模块     | 必须覆盖的风险路径                                                                 | 优先级 |
| ------------ | ---------------------------------------------------------------------------------- | ------ |
| **选座与锁座** | 50 并发同抢 1 座、单人 2 座配额上限、多座部分冲突整单回滚、抢占领队预留座（`status=3`）拦截 | 必须   |
| **超时对齐** | 锁座内（< 300s）他人不可抢、满 300s 后（≥ 301s）无需外部定时任务即可惰性释放重抢   | 必须   |
| **支付与回调** | 正常回调出票、微信 Webhook 重复通知幂等处理、超时后迟到支付自动标记异常/触发退款    | 必须   |
| **阶梯退票** | 距发车 ≥ 48h / 24h~48h 阶梯费率计算、`< 24h` 强拦截、退款成功后席位恢复 `0` 且退还配额 | 必须   |
| **名册导出** | 按 `pickup_station` 分块、按 `seat_number ASC` 升序排列、空班次与特殊字符转义边界  | 必须   |

---

## 五、AI 代码审查清单（Code Review Checklist）

提交前使用以下清单自查：

1. **事务原子性**：所有选座、出票、退票逻辑是否在同一个 `db.transaction(...).immediate()` 同步块内完成？内部是否混入了异步 `await`？
2. **惰性过期一致性**：`GET /seat-map` 查询座位图与 `POST /lock-and-pay` 抢座时，是否都统一使用了 `nowMs` 判断 `locked_until < nowMs`？
3. **测试覆盖度**：是否包含正常、边界、异常和并发冲突测试？
4. **零硬编码与零 `any`**：是否有未收敛的 `any` 类型或写死的票价/站点常量？
5. **敏感信息保护**：微信支付商户私钥、APIv3 密钥是否全部从环境变量读取？
