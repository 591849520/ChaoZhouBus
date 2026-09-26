/**
 * SeatLockService 核心单元测试与 50 并发防超卖压测断言
 * 运行：npx tsx src/services/seat-lock.test.ts
 */
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema.js'
import { BusDomainError, OrderStatus, SeatStatus } from '../types/domain.js'
import { SeatLockService } from './seat-lock.js'

const BASE_NOW_MS = 1_760_000_000_000 // 基准测试时间戳
const DEPARTURE_TIME_MS = BASE_NOW_MS + 72 * 3600 * 1000 // 默认距发车 72 小时

function createTestEnv() {
  const db = new Database(':memory:')
  initSchema(db)
  const service = new SeatLockService(db, {
    lockTtlMs: 300_000, // 300秒锁座超时
    maxSeatsPerUser: 2, // 单人限购 2 座
  })

  const scheduleId = service.createSchedule({
    routeName: '大学城校区/本部正门 -> 潮州体育馆',
    departureTimeMs: DEPARTURE_TIME_MS,
    openBookingTimeMs: BASE_NOW_MS - 60_000, // 已开票
    priceInCents: 10000, // 100.00 元/座
    pickupStations: ['大学城正门(08:00)', '本部东门(08:40)'],
    dropoffStations: ['潮州高速路口', '潮州体育馆'],
    nowMs: BASE_NOW_MS,
  })

  return { db, service, scheduleId }
}

export default async function run() {
  // ═══════════════════════════════════════════════════════════════════════════
  // Test 1: 53 座固定车模初始化 & 01/02 号领队预留席位保护
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      const seatMap = service.getSeatMap(scheduleId, BASE_NOW_MS)
      assert.equal(seatMap.seats.length, 53, '班次必须固定生成 53 个座位')
      assert.equal(seatMap.seats[0]?.seat_number, '01')
      assert.equal(seatMap.seats[0]?.status, SeatStatus.RESERVED, '01 号座默认应为领队预留(3)')
      assert.equal(seatMap.seats[1]?.seat_number, '02')
      assert.equal(seatMap.seats[1]?.status, SeatStatus.RESERVED, '02 号座默认应为领队预留(3)')
      assert.equal(seatMap.seats[2]?.seat_number, '03')
      assert.equal(seatMap.seats[2]?.status, SeatStatus.AVAILABLE, '03 号座默认应为空闲可选(0)')
      assert.equal(seatMap.seats[52]?.seat_number, '53')
      assert.equal(seatMap.seats[52]?.status, SeatStatus.AVAILABLE, '53 号座默认应为空闲可选(0)')

      // 尝试抢 01 号领队预留座，必须抛出 SEAT_RESERVED
      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_01',
            pickupStation: '大学城正门(08:00)',
            dropoffStation: '潮州体育馆',
            passengers: [
              {
                seat_number: '01',
                name: '陈同学',
                phone: '13800138001',
                student_id: '20230001',
                luggage_count: 1,
              },
            ],
            nowMs: BASE_NOW_MS,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'SEAT_RESERVED',
        '尝试抢 01 号领队预留座必须被拦截',
      )
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 2: 50 人瞬时并发同抢 03 号座位（断言仅 1 人成功，49 人返回 SEAT_UNAVAILABLE）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      const tasks = Array.from({ length: 50 }, (_, index) =>
        Promise.resolve().then(() =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: `wx_concurrent_user_${index + 1}`,
            pickupStation: '大学城正门(08:00)',
            dropoffStation: '潮州体育馆',
            passengers: [
              {
                seat_number: '03',
                name: `乘客_${index + 1}`,
                phone: '13800138000',
                student_id: `2023${String(index + 1).padStart(4, '0')}`,
                luggage_count: 1,
              },
            ],
            nowMs: BASE_NOW_MS,
          }),
        ),
      )

      const results = await Promise.allSettled(tasks)
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<ReturnType<typeof service.lockSeatsAndCreateOrder>> =>
          r.status === 'fulfilled',
      )
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )

      assert.equal(fulfilled.length, 1, '50 并发抢 03 号座必须仅有 1 人成功')
      assert.equal(rejected.length, 49, '其余 49 人必须全部被拦截')
      for (const rej of rejected) {
        assert.ok(
          rej.reason instanceof BusDomainError && rej.reason.code === 'SEAT_UNAVAILABLE',
          '失败原因必须全部为 SEAT_UNAVAILABLE',
        )
      }

      // 校验数据库最终状态：03 号座处于 LOCKED(1)，归属唯一成功者
      const winner = fulfilled[0]!.value
      const seatMap = service.getSeatMap(scheduleId, BASE_NOW_MS)
      const seat03 = seatMap.seats.find((s) => s.seat_number === '03')!
      assert.equal(seat03.status, SeatStatus.LOCKED)
      assert.equal(seat03.order_id, winner.orderId)
      assert.equal(seat03.locked_by_openid, winner.openid)
      assert.equal(seat03.locked_until, BASE_NOW_MS + 300_000, '300s 锁座超时时间戳必须严格对齐')
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 3: 多座原子回滚断言（同抢 ["05", "06"] 且 "06" 已被占，断言 "05" 不被部分锁定）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      // 用户 A 先锁 06 号座
      service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_A',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '06',
            name: '林同学A',
            phone: '13900139001',
            student_id: '20230101',
            luggage_count: 1,
          },
        ],
        nowMs: BASE_NOW_MS,
      })

      // 用户 B 尝试同时锁 ["05", "06"]，应整单回滚
      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_B',
            pickupStation: '大学城正门(08:00)',
            dropoffStation: '潮州体育馆',
            passengers: [
              {
                seat_number: '05',
                name: '许同学B1',
                phone: '13900139002',
                student_id: '20230102',
                luggage_count: 1,
              },
              {
                seat_number: '06',
                name: '许同学B2',
                phone: '13900139003',
                student_id: '20230103',
                luggage_count: 1,
              },
            ],
            nowMs: BASE_NOW_MS,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'SEAT_UNAVAILABLE',
      )

      // 验证 05 号座位保持 AVAILABLE(0)，绝不发生部分锁定
      const seatMap = service.getSeatMap(scheduleId, BASE_NOW_MS)
      const seat05 = seatMap.seats.find((s) => s.seat_number === '05')!
      assert.equal(seat05.status, SeatStatus.AVAILABLE, '05 号座必须回滚保持空闲状态')
      assert.equal(seat05.locked_by_openid, null)
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 4: 单人单班次 2 座限购配额管控断言
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      // 用户 C 第一次锁定 ["07", "08"] 共 2 座，成功
      const res = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_C',
        pickupStation: '本部东门(08:40)',
        dropoffStation: '潮州高速路口',
        passengers: [
          {
            seat_number: '07',
            name: '郑同学1',
            phone: '13700137001',
            student_id: '20230201',
            luggage_count: 1,
          },
          {
            seat_number: '08',
            name: '郑同学2',
            phone: '13700137002',
            student_id: '20230202',
            luggage_count: 2,
          },
        ],
        nowMs: BASE_NOW_MS,
      })
      assert.equal(res.totalAmountCents, 20000)

      // 用户 C 再次尝试抢第 3 个座位 "09"，必须抛出 QUOTA_EXCEEDED
      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_C',
            pickupStation: '本部东门(08:40)',
            dropoffStation: '潮州高速路口',
            passengers: [
              {
                seat_number: '09',
                name: '郑同学3',
                phone: '13700137003',
                student_id: '20230203',
                luggage_count: 1,
              },
            ],
            nowMs: BASE_NOW_MS + 10_000,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'QUOTA_EXCEEDED',
        '超过单人 2 座限额必须抛出 QUOTA_EXCEEDED',
      )
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 5: 300 秒双超时对齐与惰性过期释放重抢断言
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      // 用户 D 在 BASE_NOW_MS 锁定 "04" 号座，但一直未支付
      service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_D',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '04',
            name: '黄同学D',
            phone: '13600136001',
            student_id: '20230301',
            luggage_count: 1,
          },
        ],
        nowMs: BASE_NOW_MS,
      })

      // 在第 299 秒（BASE_NOW_MS + 299_000ms），用户 E 尝试抢 "04" 必须失败
      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_E',
            pickupStation: '大学城正门(08:00)',
            dropoffStation: '潮州体育馆',
            passengers: [
              {
                seat_number: '04',
                name: '吴同学E',
                phone: '13600136002',
                student_id: '20230302',
                luggage_count: 1,
              },
            ],
            nowMs: BASE_NOW_MS + 299_000,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'SEAT_UNAVAILABLE',
      )

      // 在第 301 秒（BASE_NOW_MS + 301_000ms），无需外部定时任务，用户 E 直接抢 "04" 成功！
      const relockRes = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_E',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '04',
            name: '吴同学E',
            phone: '13600136002',
            student_id: '20230302',
            luggage_count: 1,
          },
        ],
        nowMs: BASE_NOW_MS + 301_000,
      })
      assert.equal(relockRes.openid, 'wx_user_E')
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 6: 微信支付回调幂等性 & 迟到支付卡单自动退款防超卖断言
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      // 场景 A: 正常支付 + 重复回调幂等
      const orderA = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_pay_user_1',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '10',
            name: '蔡同学1',
            phone: '13500135001',
            student_id: '20230401',
            luggage_count: 1,
          },
        ],
        nowMs: BASE_NOW_MS,
      })

      const pay1 = service.confirmPaymentWebhook({
        orderId: orderA.orderId,
        transactionId: 'WX_TX_001',
        nowMs: BASE_NOW_MS + 30_000,
      })
      assert.equal(pay1.status, OrderStatus.PAID)
      assert.equal(pay1.idempotent, false)

      // 微信重复回调同一订单，必须幂等返回成功
      const pay2 = service.confirmPaymentWebhook({
        orderId: orderA.orderId,
        transactionId: 'WX_TX_001',
        nowMs: BASE_NOW_MS + 35_000,
      })
      assert.equal(pay2.status, OrderStatus.PAID)
      assert.equal(pay2.idempotent, true)

      // 场景 B: 迟到支付卡单竞态保护
      // 用户 2 在 t0 锁 11 号座 -> 第 301 秒锁超时被用户 3 抢走并付款 -> 第 302 秒用户 2 迟到的微信支付回调到达
      const orderLate = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_pay_user_2',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '11',
            name: '迟到付款同学',
            phone: '13500135002',
            student_id: '20230402',
            luggage_count: 1,
          },
        ],
        nowMs: BASE_NOW_MS,
      })

      const orderNewOwner = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_pay_user_3',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '11',
            name: '新买家同学',
            phone: '13500135003',
            student_id: '20230403',
            luggage_count: 1,
          },
        ],
        nowMs: BASE_NOW_MS + 301_000,
      })
      service.confirmPaymentWebhook({
        orderId: orderNewOwner.orderId,
        transactionId: 'WX_TX_NEW_OWNER',
        nowMs: BASE_NOW_MS + 301_500,
      })

      // 此时迟到订单回调到达，系统必须触发自动退款保护（EXPIRED_REFUNDING），绝不覆盖 11 号座的新主人
      const latePayRes = service.confirmPaymentWebhook({
        orderId: orderLate.orderId,
        transactionId: 'WX_TX_LATE',
        nowMs: BASE_NOW_MS + 302_000,
      })
      assert.equal(latePayRes.status, OrderStatus.EXPIRED_REFUNDING)
      assert.equal(latePayRes.autoRefundTriggered, true)

      const seat11 = service
        .getSeatMap(scheduleId, BASE_NOW_MS + 303_000)
        .seats.find((s) => s.seat_number === '11')!
      assert.equal(seat11.status, SeatStatus.SOLD)
      assert.equal(seat11.order_id, orderNewOwner.orderId, '11 号座归属必须仍为新买家')
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 7: 阶梯退票（>=48h 扣5%、24~48h 扣20%、<24h 拦截）与席位自愈归还配额断言
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      // 锁定并支付 2 张票（["12", "13"]，总额 20000 分 = 200 元）
      const order = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_refund_user',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '12',
            name: '退票测试1',
            phone: '13400134001',
            student_id: '20230501',
            luggage_count: 1,
          },
          {
            seat_number: '13',
            name: '退票测试2',
            phone: '13400134002',
            student_id: '20230502',
            luggage_count: 1,
          },
        ],
        nowMs: BASE_NOW_MS,
      })
      service.confirmPaymentWebhook({
        orderId: order.orderId,
        transactionId: 'WX_TX_REF_TEST',
        nowMs: BASE_NOW_MS + 10_000,
      })

      // 1. 测试 < 24h（距发车仅剩 12 小时）退票，必须被 REFUND_WINDOW_CLOSED 拦截
      const twelveHoursBeforeDeparture = DEPARTURE_TIME_MS - 12 * 3600 * 1000
      assert.throws(
        () =>
          service.applyTieredRefund({
            orderId: order.orderId,
            openid: 'wx_refund_user',
            nowMs: twelveHoursBeforeDeparture,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'REFUND_WINDOW_CLOSED',
        '距发车不足 24 小时必须禁止线上退票',
      )

      // 2. 测试 24h ~ 48h 之间（距发车剩余 30 小时）退票：扣除 20% 手续费（4000分），实退 16000 分
      const thirtyHoursBeforeDeparture = DEPARTURE_TIME_MS - 30 * 3600 * 1000
      const refundRes = service.applyTieredRefund({
        orderId: order.orderId,
        openid: 'wx_refund_user',
        nowMs: thirtyHoursBeforeDeparture,
      })
      assert.equal(refundRes.feePct, 20)
      assert.equal(refundRes.refundFeeCents, 4000)
      assert.equal(refundRes.refundAmountCents, 16000)

      // 3. 验证席位自愈：12、13 号座立即恢复为 AVAILABLE (0)，且该用户配额已归还，可重新购票
      const seatMapAfterRefund = service.getSeatMap(scheduleId, thirtyHoursBeforeDeparture)
      const seat12 = seatMapAfterRefund.seats.find((s) => s.seat_number === '12')!
      const seat13 = seatMapAfterRefund.seats.find((s) => s.seat_number === '13')!
      assert.equal(seat12.status, SeatStatus.AVAILABLE, '退票后 12 号座必须自愈为空闲(0)')
      assert.equal(seat13.status, SeatStatus.AVAILABLE, '退票后 13 号座必须自愈为空闲(0)')

      // 4. 该用户重新购买 12 号座，并在距发车 50 小时（>= 48h）申请退票，验证扣除 5% 手续费（500分）
      const rebuyOrder = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_refund_user',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          {
            seat_number: '12',
            name: '重购测试',
            phone: '13400134001',
            student_id: '20230501',
            luggage_count: 1,
          },
        ],
        nowMs: DEPARTURE_TIME_MS - 55 * 3600 * 1000,
      })
      service.confirmPaymentWebhook({
        orderId: rebuyOrder.orderId,
        transactionId: 'WX_TX_REBUY',
        nowMs: DEPARTURE_TIME_MS - 55 * 3600 * 1000 + 5000,
      })

      const tier1Refund = service.applyTieredRefund({
        orderId: rebuyOrder.orderId,
        openid: 'wx_refund_user',
        nowMs: DEPARTURE_TIME_MS - 50 * 3600 * 1000, // 距发车 50 小时 (>= 48h)
      })
      assert.equal(tier1Refund.feePct, 5)
      assert.equal(tier1Refund.refundFeeCents, 500)
      assert.equal(tier1Refund.refundAmountCents, 9500)
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
