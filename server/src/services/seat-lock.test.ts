/**
 * SeatLockService 核心单元测试、50 并发防超卖与现场检票签到测试套件
 * 运行：npx tsx src/services/seat-lock.test.ts
 */
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initSchema } from '../db/schema.js'
import { BusDomainError, OrderStatus, SeatStatus } from '../types/domain.js'
import { SeatLockService } from './seat-lock.js'

const BASE_NOW_MS = 1_760_000_000_000
const DEPARTURE_TIME_MS = BASE_NOW_MS + 72 * 3600 * 1000

function createTestEnv() {
  const db = new Database(':memory:')
  initSchema(db)
  const service = new SeatLockService(db, {
    lockTtlMs: 300_000,
    maxSeatsPerUser: 2,
  })

  const scheduleId = service.createSchedule({
    routeName: '大学城校区/本部正门 -> 潮州体育馆',
    departureTimeMs: DEPARTURE_TIME_MS,
    openBookingTimeMs: BASE_NOW_MS - 60_000,
    priceInCents: 10000,
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
      assert.equal(seatMap.seats[0]?.status, SeatStatus.RESERVED)
      assert.equal(seatMap.seats[1]?.seat_number, '02')
      assert.equal(seatMap.seats[1]?.status, SeatStatus.RESERVED)
      assert.equal(seatMap.seats[2]?.seat_number, '03')
      assert.equal(seatMap.seats[2]?.status, SeatStatus.AVAILABLE)

      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_01',
            pickupStation: '大学城正门(08:00)',
            dropoffStation: '潮州体育馆',
            passengers: [{ seat_number: '01', name: '陈同学', phone: '13800138001' }],
            nowMs: BASE_NOW_MS,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'SEAT_RESERVED',
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
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

      assert.equal(fulfilled.length, 1, '50 并发抢 03 号座必须仅有 1 人成功')
      assert.equal(rejected.length, 49, '其余 49 人必须全部被拦截')
      for (const rej of rejected) {
        assert.ok(rej.reason instanceof BusDomainError && rej.reason.code === 'SEAT_UNAVAILABLE')
      }

      const winner = fulfilled[0]!.value
      const seatMap = service.getSeatMap(scheduleId, BASE_NOW_MS)
      const seat03 = seatMap.seats.find((s) => s.seat_number === '03')!
      assert.equal(seat03.status, SeatStatus.LOCKED)
      assert.equal(seat03.order_id, winner.orderId)
      assert.equal(seat03.locked_until, BASE_NOW_MS + 300_000)
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
      service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_A',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [{ seat_number: '06', name: '林同学A', phone: '13900139001' }],
        nowMs: BASE_NOW_MS,
      })

      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_B',
            pickupStation: '大学城正门(08:00)',
            dropoffStation: '潮州体育馆',
            passengers: [
              { seat_number: '05', name: '许同学B1', phone: '13900139002' },
              { seat_number: '06', name: '许同学B2', phone: '13900139003' },
            ],
            nowMs: BASE_NOW_MS,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'SEAT_UNAVAILABLE',
      )

      const seat05 = service
        .getSeatMap(scheduleId, BASE_NOW_MS)
        .seats.find((s) => s.seat_number === '05')!
      assert.equal(seat05.status, SeatStatus.AVAILABLE)
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
      service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_C',
        pickupStation: '本部东门(08:40)',
        dropoffStation: '潮州高速路口',
        passengers: [
          { seat_number: '07', name: '郑同学1', phone: '13700137001' },
          { seat_number: '08', name: '郑同学2', phone: '13700137002' },
        ],
        nowMs: BASE_NOW_MS,
      })

      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_C',
            pickupStation: '本部东门(08:40)',
            dropoffStation: '潮州高速路口',
            passengers: [{ seat_number: '09', name: '郑同学3', phone: '13700137003' }],
            nowMs: BASE_NOW_MS + 10_000,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'QUOTA_EXCEEDED',
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
      service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_D',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [{ seat_number: '04', name: '黄同学D', phone: '13600136001' }],
        nowMs: BASE_NOW_MS,
      })

      assert.throws(
        () =>
          service.lockSeatsAndCreateOrder({
            scheduleId,
            openid: 'wx_user_E',
            pickupStation: '大学城正门(08:00)',
            dropoffStation: '潮州体育馆',
            passengers: [{ seat_number: '04', name: '吴同学E', phone: '13600136002' }],
            nowMs: BASE_NOW_MS + 299_000,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'SEAT_UNAVAILABLE',
      )

      const relockRes = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_user_E',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [{ seat_number: '04', name: '吴同学E', phone: '13600136002' }],
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
      const orderA = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_pay_user_1',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [{ seat_number: '10', name: '蔡同学1', phone: '13500135001' }],
        nowMs: BASE_NOW_MS,
      })

      const pay1 = service.confirmPaymentWebhook({
        orderId: orderA.orderId,
        transactionId: 'WX_TX_001',
        nowMs: BASE_NOW_MS + 30_000,
      })
      assert.equal(pay1.status, OrderStatus.PAID)
      assert.equal(pay1.idempotent, false)

      const pay2 = service.confirmPaymentWebhook({
        orderId: orderA.orderId,
        transactionId: 'WX_TX_001',
        nowMs: BASE_NOW_MS + 35_000,
      })
      assert.equal(pay2.status, OrderStatus.PAID)
      assert.equal(pay2.idempotent, true)

      const orderLate = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_pay_user_2',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [{ seat_number: '11', name: '迟到付款同学', phone: '13500135002' }],
        nowMs: BASE_NOW_MS,
      })

      const orderNewOwner = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_pay_user_3',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [{ seat_number: '11', name: '新买家同学', phone: '13500135003' }],
        nowMs: BASE_NOW_MS + 301_000,
      })
      service.confirmPaymentWebhook({
        orderId: orderNewOwner.orderId,
        transactionId: 'WX_TX_NEW_OWNER',
        nowMs: BASE_NOW_MS + 301_500,
      })

      const latePayRes = service.confirmPaymentWebhook({
        orderId: orderLate.orderId,
        transactionId: 'WX_TX_LATE',
        nowMs: BASE_NOW_MS + 302_000,
      })
      assert.equal(latePayRes.status, OrderStatus.EXPIRED_REFUNDING)
      assert.equal(latePayRes.autoRefundTriggered, true)
    } finally {
      db.close()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 7: 现场按座位独立点名签到、扫凭单码核销 & 阶梯退票席位自愈
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const { db, service, scheduleId } = createTestEnv()
    try {
      const order = service.lockSeatsAndCreateOrder({
        scheduleId,
        openid: 'wx_refund_user',
        pickupStation: '大学城正门(08:00)',
        dropoffStation: '潮州体育馆',
        passengers: [
          { seat_number: '12', name: '林先到', phone: '13400134001' },
          { seat_number: '13', name: '陈后到', phone: '13400134002' },
        ],
        nowMs: BASE_NOW_MS,
      })
      service.confirmPaymentWebhook({
        orderId: order.orderId,
        transactionId: 'WX_TX_REF_TEST',
        nowMs: BASE_NOW_MS + 10_000,
      })

      // 1. 验证出票后每个座位均生成了 6 位检票核验码
      const detail = service.getOrderDetail(order.orderId, 'wx_refund_user', BASE_NOW_MS + 15_000)
      assert.equal(detail.passengers.length, 2)
      assert.ok(detail.passengers[0]?.check_in_code?.length === 6, '12号座应生成6位检票码')
      assert.ok(detail.passengers[1]?.check_in_code?.length === 6, '13号座应生成6位检票码')

      // 2. 领队在手机上给 12 号座“林先到”手动点击签到，13 号座保持未到
      const checkIn12 = service.checkInSeat({
        scheduleId,
        seatNumber: '12',
        checkedIn: true,
        nowMs: BASE_NOW_MS + 20_000,
      })
      assert.equal(checkIn12.checkedIn, true)
      assert.equal(checkIn12.name, '林先到')

      const rollCall = service.getRollCallList(scheduleId)
      const p12 = rollCall.find((p) => p.seat_number === '12')!
      const p13 = rollCall.find((p) => p.seat_number === '13')!
      assert.equal(p12.checked_in_at, BASE_NOW_MS + 20_000, '12号座应为已签到状态')
      assert.equal(p13.checked_in_at, null, '13号座应仍为未到状态')

      // 3. 领队用扫码检票扫 13 号座的二维码 ("CZBUS:1:<code13>")
      const scan13 = service.checkInSeat({
        scheduleId,
        checkInCode: `CZBUS:${scheduleId}:${p13.check_in_code}`,
        nowMs: BASE_NOW_MS + 25_000,
      })
      assert.equal(scan13.seatNumber, '13')
      assert.equal(scan13.checkedIn, true)

      // 4. 校验 < 24h 禁止退票，30h (20% 扣费) 退票后座位自愈并清空签到态与核验码
      assert.throws(
        () =>
          service.applyTieredRefund({
            orderId: order.orderId,
            openid: 'wx_refund_user',
            nowMs: DEPARTURE_TIME_MS - 12 * 3600 * 1000,
          }),
        (err: unknown) => err instanceof BusDomainError && err.code === 'REFUND_WINDOW_CLOSED',
      )

      const refundRes = service.applyTieredRefund({
        orderId: order.orderId,
        openid: 'wx_refund_user',
        nowMs: DEPARTURE_TIME_MS - 30 * 3600 * 1000,
      })
      assert.equal(refundRes.feePct, 20)
      assert.equal(refundRes.refundAmountCents, 16000)

      const seatMapAfter = service.getSeatMap(scheduleId, DEPARTURE_TIME_MS - 30 * 3600 * 1000)
      const s12 = seatMapAfter.seats.find((s) => s.seat_number === '12')!
      assert.equal(s12.status, SeatStatus.AVAILABLE)
      assert.equal(s12.checked_in_at, null, '退票后座位签到时间戳必须自动清零')
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
