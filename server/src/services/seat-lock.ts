import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { appConfig } from '../config/env.js'
import { formatSeatNumber } from '../db/schema.js'
import {
  BusDomainError,
  OrderStatus,
  PassengerItem,
  RefundRulesConfig,
  ScheduleSeatMapData,
  ScheduleStatus,
  SeatStatus,
  SeatViewItem,
} from '../types/domain.js'

export interface CreateScheduleInput {
  routeName: string
  departureTimeMs: number
  openBookingTimeMs: number
  priceInCents: number
  totalSeats?: number
  reservedSeatNumbers?: string[]
  pickupStations: string[]
  dropoffStations: string[]
  refundRules?: RefundRulesConfig
  status?: ScheduleStatus
  nowMs?: number
}

export interface LockSeatsInput {
  scheduleId: number
  openid: string
  pickupStation: string
  dropoffStation: string
  passengers: PassengerItem[]
  nowMs?: number
}

export interface LockSeatsResult {
  orderId: string
  scheduleId: number
  openid: string
  seatNumbers: string[]
  totalAmountCents: number
  lockedUntilMs: number
  timeExpireIso: string
  wxPayParams: {
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  }
}

export interface ConfirmPaymentInput {
  orderId: string
  transactionId: string
  nowMs?: number
}

export interface ConfirmPaymentResult {
  orderId: string
  status: OrderStatus
  idempotent: boolean
  autoRefundTriggered: boolean
}

export interface ApplyRefundInput {
  orderId: string
  openid: string
  nowMs?: number
}

export interface ApplyRefundResult {
  orderId: string
  refundId: string
  totalAmountCents: number
  refundFeeCents: number
  refundAmountCents: number
  feePct: number
  releasedSeatNumbers: string[]
}

interface ScheduleRow {
  id: number
  route_name: string
  departure_time: number
  open_booking_time: number
  price_in_cents: number
  total_seats: number
  pickup_stations: string
  dropoff_stations: string
  refund_rules: string
  status: number
}

interface SeatRow {
  id: number
  schedule_id: number
  seat_number: string
  status: number
  locked_by_openid: string | null
  locked_until: number | null
  order_id: string | null
}

interface OrderRow {
  id: string
  schedule_id: number
  openid: string
  pickup_station: string
  dropoff_station: string
  total_amount: number
  refund_amount: number
  refund_fee: number
  transaction_id: string | null
  refund_id: string | null
  status: number
  passenger_info: string
  locked_until: number
  paid_at: number | null
  refunded_at: number | null
  created_at: number
}

export class SeatLockService {
  private readonly db: Database.Database
  private readonly lockTtlMs: number
  private readonly maxSeatsPerUser: number

  constructor(
    db: Database.Database,
    options?: {
      lockTtlMs?: number
      maxSeatsPerUser?: number
    },
  ) {
    this.db = db
    this.lockTtlMs = options?.lockTtlMs ?? appConfig.lockTtlMs
    this.maxSeatsPerUser = options?.maxSeatsPerUser ?? appConfig.maxSeatsPerUser
  }

  /**
   * 惰性清理指定班次下已过期的锁座与超时订单（须在事务内或读取前同步调用）
   */
  public releaseExpiredLocks(scheduleId: number, nowMs: number): number {
    const cleanTx = this.db.transaction((sid: number, currentMs: number): number => {
      const expiredSeats = this.db
        .prepare<[number, number], { order_id: string | null }>(
          `SELECT DISTINCT order_id FROM schedule_seats
           WHERE schedule_id = ? AND status = 1 AND locked_until IS NOT NULL AND locked_until <= ?`,
        )
        .all(sid, currentMs)

      const seatRes = this.db
        .prepare<[number, number]>(
          `UPDATE schedule_seats
           SET status = 0, locked_by_openid = NULL, locked_until = NULL, order_id = NULL
           WHERE schedule_id = ? AND status = 1 AND locked_until IS NOT NULL AND locked_until <= ?`,
        )
        .run(sid, currentMs)

      const cancelOrderStmt = this.db.prepare<[number, string, number]>(
        `UPDATE orders SET status = ? WHERE id = ? AND status = ?`,
      )
      for (const item of expiredSeats) {
        if (item.order_id) {
          cancelOrderStmt.run(
            OrderStatus.CANCELLED,
            item.order_id,
            OrderStatus.PENDING_PAY,
          )
        }
      }

      return seatRes.changes
    })

    return cleanTx.immediate(scheduleId, nowMs)
  }

  /**
   * 创建班次并自动初始化 53 个座位（01, 02 默认设为 status=3 领队预留）
   */
  public createSchedule(input: CreateScheduleInput): number {
    const nowMs = input.nowMs ?? Date.now()
    const totalSeats = input.totalSeats ?? appConfig.defaultTotalSeats
    const reservedSet = new Set(input.reservedSeatNumbers ?? appConfig.defaultReservedSeats)
    const refundRules = input.refundRules ?? appConfig.defaultRefundRules
    const status = input.status ?? ScheduleStatus.SELLING

    const tx = this.db.transaction((): number => {
      const insertSchedule = this.db.prepare(`
        INSERT INTO schedules (
          route_name, departure_time, open_booking_time, price_in_cents,
          total_seats, pickup_stations, dropoff_stations, refund_rules, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const info = insertSchedule.run(
        input.routeName,
        input.departureTimeMs,
        input.openBookingTimeMs,
        input.priceInCents,
        totalSeats,
        JSON.stringify(input.pickupStations),
        JSON.stringify(input.dropoffStations),
        JSON.stringify(refundRules),
        status,
        nowMs,
      )

      const scheduleId = Number(info.lastInsertRowid)
      const insertSeat = this.db.prepare(`
        INSERT INTO schedule_seats (schedule_id, seat_number, status)
        VALUES (?, ?, ?)
      `)

      for (let i = 1; i <= totalSeats; i++) {
        const seatNo = formatSeatNumber(i)
        const initialStatus = reservedSet.has(seatNo)
          ? SeatStatus.RESERVED
          : SeatStatus.AVAILABLE
        insertSeat.run(scheduleId, seatNo, initialStatus)
      }

      return scheduleId
    })

    return tx.immediate()
  }

  /**
   * 获取班次 53 座实时座位图（自动执行 300s 惰性过期映射）
   */
  public getSeatMap(scheduleId: number, nowMs = Date.now()): ScheduleSeatMapData {
    this.releaseExpiredLocks(scheduleId, nowMs)

    const schedule = this.db
      .prepare<[number], ScheduleRow>(`SELECT * FROM schedules WHERE id = ?`)
      .get(scheduleId)

    if (!schedule) {
      throw new BusDomainError('SCHEDULE_NOT_FOUND', `班次 ${scheduleId} 不存在`, 404)
    }

    const seatRows = this.db
      .prepare<[number], SeatRow>(
        `SELECT * FROM schedule_seats WHERE schedule_id = ? ORDER BY seat_number ASC`,
      )
      .all(scheduleId)

    const seats: SeatViewItem[] = seatRows.map((row) => ({
      seat_number: row.seat_number,
      status: row.status as SeatStatus,
      locked_by_openid: row.locked_by_openid,
      locked_until: row.locked_until,
      order_id: row.order_id,
    }))

    return {
      schedule_id: schedule.id,
      route_name: schedule.route_name,
      departure_time: schedule.departure_time,
      open_booking_time: schedule.open_booking_time,
      price_in_cents: schedule.price_in_cents,
      total_seats: schedule.total_seats,
      pickup_stations: JSON.parse(schedule.pickup_stations) as string[],
      dropoff_stations: JSON.parse(schedule.dropoff_stations) as string[],
      refund_rules: JSON.parse(schedule.refund_rules) as RefundRulesConfig,
      status: schedule.status as ScheduleStatus,
      server_time_ms: nowMs,
      seats,
    }
  }

  /**
   * 核心：50 并发原子排他锁座与创建待付订单
   * 在单个 SQLite BEGIN IMMEDIATE 同步事务内完成：
   * 1. 惰性释放超时锁 -> 2. 班次与站点校验 -> 3. 单人2座配额校验 -> 4. 多座全空闲预检 -> 5. 锁座与建单
   */
  public lockSeatsAndCreateOrder(input: LockSeatsInput): LockSeatsResult {
    const nowMs = input.nowMs ?? Date.now()

    if (input.passengers.length === 0 || input.passengers.length > this.maxSeatsPerUser) {
      throw new BusDomainError(
        'QUOTA_EXCEEDED',
        `单次选座数量必须在 1 ~ ${this.maxSeatsPerUser} 座之间`,
      )
    }

    const seatNumbers = input.passengers.map((p) => p.seat_number)
    const uniqueSeats = new Set(seatNumbers)
    if (uniqueSeats.size !== seatNumbers.length) {
      throw new BusDomainError('INVALID_SEAT_NUMBER', '不能重复选择同一个座位号')
    }

    const tx = this.db.transaction((): LockSeatsResult => {
      // Step 1: 先清理该班次所有已过期的锁座（惰性释放）
      this.releaseExpiredLocks(input.scheduleId, nowMs)

      // Step 2: 校验班次与开票时间、上下车站点
      const schedule = this.db
        .prepare<[number], ScheduleRow>(`SELECT * FROM schedules WHERE id = ?`)
        .get(input.scheduleId)

      if (!schedule) {
        throw new BusDomainError('SCHEDULE_NOT_FOUND', `班次 ${input.scheduleId} 不存在`, 404)
      }

      if (nowMs < schedule.open_booking_time || schedule.status !== ScheduleStatus.SELLING) {
        throw new BusDomainError('BOOKING_NOT_OPEN', '当前班次尚未开票或已停止售票')
      }

      const pickupList = JSON.parse(schedule.pickup_stations) as string[]
      const dropoffList = JSON.parse(schedule.dropoff_stations) as string[]
      if (!pickupList.includes(input.pickupStation) || !dropoffList.includes(input.dropoffStation)) {
        throw new BusDomainError('INVALID_STATION', '所选上车点或下车点不属于当前班次')
      }

      // Step 3: 校验用户在该班次的有效占用座位数（锁定中 + 已购买）
      const quotaRow = this.db
        .prepare<[number, string, number], { cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM schedule_seats
           WHERE schedule_id = ?
             AND locked_by_openid = ?
             AND (status = 2 OR (status = 1 AND locked_until > ?))`,
        )
        .get(input.scheduleId, input.openid, nowMs)

      const activeQuota = quotaRow?.cnt ?? 0
      if (activeQuota + seatNumbers.length > this.maxSeatsPerUser) {
        throw new BusDomainError(
          'QUOTA_EXCEEDED',
          `单人单班次限购 ${this.maxSeatsPerUser} 座（当前已占 ${activeQuota} 座，本次请求 ${seatNumbers.length} 座）`,
        )
      }

      // Step 4: 预检全部所选座位是否均处于 AVAILABLE (0) 状态（任一冲突整单抛错回滚）
      const seatSelectStmt = this.db.prepare<[number, string], SeatRow>(
        `SELECT * FROM schedule_seats WHERE schedule_id = ? AND seat_number = ?`,
      )

      for (const seatNo of seatNumbers) {
        const seat = seatSelectStmt.get(input.scheduleId, seatNo)
        if (!seat) {
          throw new BusDomainError('INVALID_SEAT_NUMBER', `座位号 ${seatNo} 不存在`)
        }
        if (seat.status === SeatStatus.RESERVED) {
          throw new BusDomainError('SEAT_RESERVED', `座位 ${seatNo} 为领队预留席位，不可选择`)
        }
        if (seat.status !== SeatStatus.AVAILABLE) {
          throw new BusDomainError('SEAT_UNAVAILABLE', `手慢了，座位 ${seatNo} 已被其他同学抢占`)
        }
      }

      // Step 5: 原子锁定全部所选座位并生成待支付订单（300s 双超时严格对齐）
      const lockedUntilMs = nowMs + this.lockTtlMs
      const orderId = `ORD${nowMs}${crypto.randomBytes(3).toString('hex').toUpperCase()}`
      const totalAmountCents = schedule.price_in_cents * seatNumbers.length

      const updateSeatStmt = this.db.prepare<[ string, number, string, number, string ]>(
        `UPDATE schedule_seats
         SET status = 1, locked_by_openid = ?, locked_until = ?, order_id = ?
         WHERE schedule_id = ? AND seat_number = ? AND status = 0`,
      )

      for (const seatNo of seatNumbers) {
        const res = updateSeatStmt.run(
          input.openid,
          lockedUntilMs,
          orderId,
          input.scheduleId,
          seatNo,
        )
        if (res.changes !== 1) {
          throw new BusDomainError('SEAT_UNAVAILABLE', `座位 ${seatNo} 状态并发变更，锁座失败`)
        }
      }

      this.db
        .prepare(
          `INSERT INTO orders (
            id, schedule_id, openid, pickup_station, dropoff_station,
            total_amount, status, passenger_info, locked_until, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          orderId,
          input.scheduleId,
          input.openid,
          input.pickupStation,
          input.dropoffStation,
          totalAmountCents,
          OrderStatus.PENDING_PAY,
          JSON.stringify(input.passengers),
          lockedUntilMs,
          nowMs,
        )

      const timeExpireIso = new Date(lockedUntilMs).toISOString()
      const nonceStr = crypto.randomBytes(8).toString('hex')

      return {
        orderId,
        scheduleId: input.scheduleId,
        openid: input.openid,
        seatNumbers,
        totalAmountCents,
        lockedUntilMs,
        timeExpireIso,
        wxPayParams: {
          timeStamp: String(Math.floor(nowMs / 1000)),
          nonceStr,
          package: `prepay_id=wx_${orderId}`,
          signType: 'RSA',
          paySign: `SIGN_${orderId}_${nonceStr}`,
        },
      }
    })

    return tx.immediate()
  }

  /**
   * 微信支付异步回调 Webhook 处理（含幂等防护 + 迟到支付卡单自动原路退款防超卖）
   */
  public confirmPaymentWebhook(input: ConfirmPaymentInput): ConfirmPaymentResult {
    const nowMs = input.nowMs ?? Date.now()

    const tx = this.db.transaction((): ConfirmPaymentResult => {
      const order = this.db
        .prepare<[string], OrderRow>(`SELECT * FROM orders WHERE id = ?`)
        .get(input.orderId)

      if (!order) {
        throw new BusDomainError('ORDER_NOT_FOUND', `订单 ${input.orderId} 不存在`, 404)
      }

      // 幂等检查：已出票或已转入迟到自动退款状态，直接返回成功
      if (order.status === OrderStatus.PAID || order.status === OrderStatus.EXPIRED_REFUNDING) {
        return {
          orderId: order.id,
          status: order.status as OrderStatus,
          idempotent: true,
          autoRefundTriggered: order.status === OrderStatus.EXPIRED_REFUNDING,
        }
      }

      const passengers = JSON.parse(order.passenger_info) as PassengerItem[]
      const seatSelectStmt = this.db.prepare<[number, string], SeatRow>(
        `SELECT * FROM schedule_seats WHERE schedule_id = ? AND seat_number = ?`,
      )

      // 检查是否存在“锁超时后被其他同学抢走”的卡单竞态冲突
      let hasSeatConflict = false
      for (const p of passengers) {
        const seat = seatSelectStmt.get(order.schedule_id, p.seat_number)
        if (!seat) {
          hasSeatConflict = true
          break
        }
        const stillOwnedByThisOrder = seat.order_id === order.id
        const isCurrentlyFree =
          seat.status === SeatStatus.AVAILABLE ||
          (seat.status === SeatStatus.LOCKED &&
            seat.locked_until !== null &&
            seat.locked_until <= nowMs)

        if (!stillOwnedByThisOrder && !isCurrentlyFree) {
          hasSeatConflict = true
          break
        }
      }

      if (hasSeatConflict) {
        // 触发迟到支付防超卖保护：绝不覆盖新买家的座位，将该单置为 EXPIRED_REFUNDING 并全额原路退款
        const refundId = `AUTO_REF_${order.id}`
        this.db
          .prepare(
            `UPDATE orders
             SET status = ?, transaction_id = ?, refund_id = ?, refund_amount = total_amount, refunded_at = ?
             WHERE id = ?`,
          )
          .run(OrderStatus.EXPIRED_REFUNDING, input.transactionId, refundId, nowMs, order.id)

        // 若还有残留的部分本单锁，顺手释放
        this.db
          .prepare(
            `UPDATE schedule_seats
             SET status = 0, locked_by_openid = NULL, locked_until = NULL, order_id = NULL
             WHERE schedule_id = ? AND order_id = ?`,
          )
          .run(order.schedule_id, order.id)

        return {
          orderId: order.id,
          status: OrderStatus.EXPIRED_REFUNDING,
          idempotent: false,
          autoRefundTriggered: true,
        }
      }

      // 正常出票：将座位更新为 SOLD (2)，订单更新为 PAID (1)
      const markSoldStmt = this.db.prepare(
        `UPDATE schedule_seats
         SET status = 2, locked_by_openid = ?, locked_until = NULL, order_id = ?
         WHERE schedule_id = ? AND seat_number = ?`,
      )

      for (const p of passengers) {
        markSoldStmt.run(order.openid, order.id, order.schedule_id, p.seat_number)
      }

      this.db
        .prepare(
          `UPDATE orders
           SET status = ?, transaction_id = ?, paid_at = ?
           WHERE id = ?`,
        )
        .run(OrderStatus.PAID, input.transactionId, nowMs, order.id)

      return {
        orderId: order.id,
        status: OrderStatus.PAID,
        idempotent: false,
        autoRefundTriggered: false,
      }
    })

    return tx.immediate()
  }

  /**
   * 阶梯退票与席位自愈（Tiered Refund & Seat Self-Healing）
   * - 距发车 >= 48h：扣 5% 手续费
   * - 24h <= 距发车 < 48h：扣 20% 违约金
   * - 距发车 < 24h：抛出 REFUND_WINDOW_CLOSED 拦截
   * - 退款成功后同一事务将座位重置为 0 (AVAILABLE)，自动归还用户购票配额
   */
  public applyTieredRefund(input: ApplyRefundInput): ApplyRefundResult {
    const nowMs = input.nowMs ?? Date.now()

    const tx = this.db.transaction((): ApplyRefundResult => {
      const order = this.db
        .prepare<[string], OrderRow>(`SELECT * FROM orders WHERE id = ?`)
        .get(input.orderId)

      if (!order) {
        throw new BusDomainError('ORDER_NOT_FOUND', `订单 ${input.orderId} 不存在`, 404)
      }

      if (order.openid !== input.openid) {
        throw new BusDomainError('ORDER_FORBIDDEN', '无权操作他人订单', 403)
      }

      if (order.status !== OrderStatus.PAID) {
        throw new BusDomainError('ORDER_INVALID_STATE', '仅已出票（PAID）状态的订单可申请退票')
      }

      const schedule = this.db
        .prepare<[number], ScheduleRow>(`SELECT * FROM schedules WHERE id = ?`)
        .get(order.schedule_id)

      if (!schedule) {
        throw new BusDomainError('SCHEDULE_NOT_FOUND', '关联班次不存在', 404)
      }

      const rules = JSON.parse(schedule.refund_rules) as RefundRulesConfig
      const hoursLeft = (schedule.departure_time - nowMs) / (1000 * 3600)

      if (hoursLeft < rules.tier2_hours) {
        throw new BusDomainError(
          'REFUND_WINDOW_CLOSED',
          `距离发车不足 ${rules.tier2_hours} 小时（当前剩余 ${hoursLeft.toFixed(1)} 小时），已关闭线上退票通道，请线下转让`,
        )
      }

      const feePct = hoursLeft >= rules.tier1_hours ? rules.tier1_fee_pct : rules.tier2_fee_pct
      const refundFeeCents = Math.round((order.total_amount * feePct) / 100)
      const refundAmountCents = order.total_amount - refundFeeCents
      const refundId = `REF_${order.id}`

      const passengers = JSON.parse(order.passenger_info) as PassengerItem[]
      const releasedSeatNumbers = passengers.map((p) => p.seat_number)

      // 1. 更新订单为 REFUNDED (2)
      this.db
        .prepare(
          `UPDATE orders
           SET status = ?, refund_amount = ?, refund_fee = ?, refund_id = ?, refunded_at = ?
           WHERE id = ?`,
        )
        .run(
          OrderStatus.REFUNDED,
          refundAmountCents,
          refundFeeCents,
          refundId,
          nowMs,
          order.id,
        )

      // 2. 席位自愈：释放所有关联座位回 AVAILABLE (0)，清空占用人与订单关联，归还用户限购配额
      this.db
        .prepare(
          `UPDATE schedule_seats
           SET status = 0, locked_by_openid = NULL, locked_until = NULL, order_id = NULL
           WHERE schedule_id = ? AND order_id = ?`,
        )
        .run(order.schedule_id, order.id)

      return {
        orderId: order.id,
        refundId,
        totalAmountCents: order.total_amount,
        refundFeeCents,
        refundAmountCents,
        feePct,
        releasedSeatNumbers,
      }
    })

    return tx.immediate()
  }
}
