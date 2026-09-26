import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { appConfig } from '../config/env.js'
import { formatSeatNumber } from '../db/schema.js'
import {
  BusDomainError,
  OrderStatus,
  PassengerItem,
  RefundRulesConfig,
  RollCallPassengerItem,
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

export interface CheckInSeatInput {
  scheduleId: number
  /** 按座位号手动点名（与 checkInCode 二选一） */
  seatNumber?: string
  /** 扫乘客电子乘车凭单二维码/核验码（与 seatNumber 二选一） */
  checkInCode?: string
  /** 显式设置签到状态（true: 已上车, false: 撤销为未到；若不传则自动设为 true） */
  checkedIn?: boolean
  nowMs?: number
}

export interface CheckInSeatResult {
  scheduleId: number
  seatNumber: string
  name: string
  phone: string
  pickupStation: string
  dropoffStation: string
  checkedIn: boolean
  checkedInAt: number | null
  checkInCode: string
}

export interface OrderDetailView {
  id: string
  schedule_id: number
  route_name: string
  departure_time: number
  openid: string
  pickup_station: string
  dropoff_station: string
  total_amount: number
  refund_amount: number
  refund_fee: number
  status: OrderStatus
  locked_until: number
  remaining_pay_seconds: number
  paid_at: number | null
  refunded_at: number | null
  created_at: number
  passengers: Array<{
    seat_number: string
    name: string
    phone: string
    check_in_code: string | null
    checked_in_at: number | null
  }>
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
  created_at: number
}

interface SeatRow {
  id: number
  schedule_id: number
  seat_number: string
  status: number
  locked_by_openid: string | null
  locked_until: number | null
  order_id: string | null
  checked_in_at: number | null
  check_in_code: string | null
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
   * 惰性清理指定班次下已过期的锁座与超时订单
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
           SET status = 0, locked_by_openid = NULL, locked_until = NULL, order_id = NULL,
               checked_in_at = NULL, check_in_code = NULL
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
   * 获取全部班次列表及实时余票统计
   */
  public listSchedules(nowMs = Date.now()): Array<{
    id: number
    route_name: string
    departure_time: number
    open_booking_time: number
    price_in_cents: number
    total_seats: number
    available_seats: number
    sold_seats: number
    locked_seats: number
    reserved_seats: number
    pickup_stations: string[]
    dropoff_stations: string[]
    status: ScheduleStatus
    server_time_ms: number
  }> {
    const schedules = this.db
      .prepare<[], ScheduleRow>(`SELECT * FROM schedules ORDER BY departure_time ASC`)
      .all()

    return schedules.map((s) => {
      this.releaseExpiredLocks(s.id, nowMs)
      const seats = this.db
        .prepare<[number], SeatRow>(`SELECT status FROM schedule_seats WHERE schedule_id = ?`)
        .all(s.id)

      const availableSeats = seats.filter((x) => x.status === SeatStatus.AVAILABLE).length
      const soldSeats = seats.filter((x) => x.status === SeatStatus.SOLD).length
      const lockedSeats = seats.filter((x) => x.status === SeatStatus.LOCKED).length
      const reservedSeats = seats.filter((x) => x.status === SeatStatus.RESERVED).length

      return {
        id: s.id,
        route_name: s.route_name,
        departure_time: s.departure_time,
        open_booking_time: s.open_booking_time,
        price_in_cents: s.price_in_cents,
        total_seats: s.total_seats,
        available_seats: availableSeats,
        sold_seats: soldSeats,
        locked_seats: lockedSeats,
        reserved_seats: reservedSeats,
        pickup_stations: JSON.parse(s.pickup_stations) as string[],
        dropoff_stations: JSON.parse(s.dropoff_stations) as string[],
        status: s.status as ScheduleStatus,
        server_time_ms: nowMs,
      }
    })
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
      checked_in_at: row.checked_in_at,
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
      this.releaseExpiredLocks(input.scheduleId, nowMs)

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

      const lockedUntilMs = nowMs + this.lockTtlMs
      const orderId = `ORD${nowMs}${crypto.randomBytes(3).toString('hex').toUpperCase()}`
      const totalAmountCents = schedule.price_in_cents * seatNumbers.length

      const updateSeatStmt = this.db.prepare<[string, number, string, number, string]>(
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
   * 微信支付异步回调 Webhook 处理（自动生成每个座位的 6 位电子检票码 check_in_code）
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
        const refundId = `AUTO_REF_${order.id}`
        this.db
          .prepare(
            `UPDATE orders
             SET status = ?, transaction_id = ?, refund_id = ?, refund_amount = total_amount, refunded_at = ?
             WHERE id = ?`,
          )
          .run(OrderStatus.EXPIRED_REFUNDING, input.transactionId, refundId, nowMs, order.id)

        this.db
          .prepare(
            `UPDATE schedule_seats
             SET status = 0, locked_by_openid = NULL, locked_until = NULL, order_id = NULL,
                 checked_in_at = NULL, check_in_code = NULL
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

      // 正常出票：将座位更新为 SOLD (2)，生成 6 位数字检票码 check_in_code
      const markSoldStmt = this.db.prepare(
        `UPDATE schedule_seats
         SET status = 2, locked_by_openid = ?, locked_until = NULL, order_id = ?,
             checked_in_at = NULL, check_in_code = ?
         WHERE schedule_id = ? AND seat_number = ?`,
      )

      for (const p of passengers) {
        // 生成含座位号特征的唯一 6 位数字检票码，例如 "03" + 4位随机数字 -> "038492"
        const randomFour = String(crypto.randomInt(1000, 9999))
        const checkInCode = `${p.seat_number}${randomFour}`
        markSoldStmt.run(order.openid, order.id, checkInCode, order.schedule_id, p.seat_number)
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
   * 手机端现场点名签到 / 扫电子凭单码核销
   * 支持：
   * 1. 领队在名单点击某座位签到或撤销（传 scheduleId + seatNumber + checkedIn）
   * 2. 领队用微信扫一扫识别乘客 6 位检票码或二维码内容（传 scheduleId + checkInCode）
   */
  public checkInSeat(input: CheckInSeatInput): CheckInSeatResult {
    const nowMs = input.nowMs ?? Date.now()

    const tx = this.db.transaction((): CheckInSeatResult => {
      let seat: SeatRow | undefined

      if (input.checkInCode) {
        // 支持扫码内容形如 "CZBUS:1:038492" 或纯 6 位码 "038492"
        const rawCode = input.checkInCode.includes(':')
          ? input.checkInCode.split(':').pop()!.trim()
          : input.checkInCode.trim()

        seat = this.db
          .prepare<[number, string], SeatRow>(
            `SELECT * FROM schedule_seats WHERE schedule_id = ? AND check_in_code = ?`,
          )
          .get(input.scheduleId, rawCode)
      } else if (input.seatNumber) {
        seat = this.db
          .prepare<[number, string], SeatRow>(
            `SELECT * FROM schedule_seats WHERE schedule_id = ? AND seat_number = ?`,
          )
          .get(input.scheduleId, input.seatNumber)
      }

      if (!seat || seat.status !== SeatStatus.SOLD || !seat.order_id) {
        throw new BusDomainError(
          'CHECK_IN_INVALID',
          '未找到对应的已售出有效座位或核验码无效',
          400,
        )
      }

      const order = this.db
        .prepare<[string], OrderRow>(`SELECT * FROM orders WHERE id = ?`)
        .get(seat.order_id)

      if (!order || order.status !== OrderStatus.PAID) {
        throw new BusDomainError('CHECK_IN_INVALID', '关联订单未处于已出票有效状态', 400)
      }

      const passengers = JSON.parse(order.passenger_info) as PassengerItem[]
      const passenger = passengers.find((p) => p.seat_number === seat.seat_number)
      if (!passenger) {
        throw new BusDomainError('CHECK_IN_INVALID', '未找到座位对应的乘车人记录', 400)
      }

      const targetChecked = input.checkedIn !== undefined ? input.checkedIn : true
      const newCheckedInAt = targetChecked ? nowMs : null

      this.db
        .prepare(`UPDATE schedule_seats SET checked_in_at = ? WHERE id = ?`)
        .run(newCheckedInAt, seat.id)

      return {
        scheduleId: input.scheduleId,
        seatNumber: seat.seat_number,
        name: passenger.name,
        phone: passenger.phone,
        pickupStation: order.pickup_station,
        dropoffStation: order.dropoff_station,
        checkedIn: targetChecked,
        checkedInAt: newCheckedInAt,
        checkInCode: seat.check_in_code ?? '',
      }
    })

    return tx.immediate()
  }

  /**
   * 获取指定班次的全部已售出乘客点名列表（按座位号升序）
   */
  public getRollCallList(scheduleId: number): RollCallPassengerItem[] {
    const soldSeats = this.db
      .prepare<[number], SeatRow>(
        `SELECT * FROM schedule_seats WHERE schedule_id = ? AND status = 2 ORDER BY seat_number ASC`,
      )
      .all(scheduleId)

    const orderStmt = this.db.prepare<[string], OrderRow>(`SELECT * FROM orders WHERE id = ?`)
    const result: RollCallPassengerItem[] = []

    for (const seat of soldSeats) {
      if (!seat.order_id) continue
      const order = orderStmt.get(seat.order_id)
      if (!order || order.status !== OrderStatus.PAID) continue

      const passengers = JSON.parse(order.passenger_info) as PassengerItem[]
      const matched = passengers.find((p) => p.seat_number === seat.seat_number)
      if (!matched) continue

      result.push({
        seat_number: seat.seat_number,
        name: matched.name,
        phone: matched.phone,
        pickup_station: order.pickup_station,
        dropoff_station: order.dropoff_station,
        order_id: order.id,
        check_in_code: seat.check_in_code ?? '',
        checked_in_at: seat.checked_in_at,
      })
    }

    return result
  }

  /**
   * 管理员动态切换预留席位（在 0 AVAILABLE 与 3 RESERVED 之间切换）
   */
  public toggleReservedSeat(
    scheduleId: number,
    seatNumber: string,
    reserved: boolean,
    nowMs = Date.now(),
  ): SeatViewItem {
    this.releaseExpiredLocks(scheduleId, nowMs)

    const tx = this.db.transaction((): SeatViewItem => {
      const seat = this.db
        .prepare<[number, string], SeatRow>(
          `SELECT * FROM schedule_seats WHERE schedule_id = ? AND seat_number = ?`,
        )
        .get(scheduleId, seatNumber)

      if (!seat) {
        throw new BusDomainError('INVALID_SEAT_NUMBER', `座位 ${seatNumber} 不存在`, 404)
      }

      if (seat.status === SeatStatus.LOCKED || seat.status === SeatStatus.SOLD) {
        throw new BusDomainError(
          'SEAT_UNAVAILABLE',
          `座位 ${seatNumber} 已被锁定或已售出，无法修改预留状态`,
        )
      }

      const nextStatus = reserved ? SeatStatus.RESERVED : SeatStatus.AVAILABLE
      this.db
        .prepare(`UPDATE schedule_seats SET status = ? WHERE id = ?`)
        .run(nextStatus, seat.id)

      return {
        seat_number: seat.seat_number,
        status: nextStatus,
        locked_by_openid: null,
        locked_until: null,
        order_id: null,
        checked_in_at: null,
      }
    })

    return tx.immediate()
  }

  /**
   * 查询单个订单详情（含电子乘车凭单所需的核验码与签到状态）
   */
  public getOrderDetail(orderId: string, openid?: string, nowMs = Date.now()): OrderDetailView {
    const order = this.db
      .prepare<[string], OrderRow>(`SELECT * FROM orders WHERE id = ?`)
      .get(orderId)

    if (!order) {
      throw new BusDomainError('ORDER_NOT_FOUND', `订单 ${orderId} 不存在`, 404)
    }

    this.releaseExpiredLocks(order.schedule_id, nowMs)

    const refreshedOrder = this.db
      .prepare<[string], OrderRow>(`SELECT * FROM orders WHERE id = ?`)
      .get(orderId)!

    if (openid && refreshedOrder.openid !== openid) {
      throw new BusDomainError('ORDER_FORBIDDEN', '无权查看他人订单', 403)
    }

    const schedule = this.db
      .prepare<[number], ScheduleRow>(`SELECT * FROM schedules WHERE id = ?`)
      .get(refreshedOrder.schedule_id)!

    const rawPassengers = JSON.parse(refreshedOrder.passenger_info) as PassengerItem[]
    const seatStmt = this.db.prepare<[number, string], SeatRow>(
      `SELECT * FROM schedule_seats WHERE schedule_id = ? AND seat_number = ?`,
    )

    const passengersWithCheckIn = rawPassengers.map((p) => {
      const seat = seatStmt.get(refreshedOrder.schedule_id, p.seat_number)
      const belongsToOrder = seat && seat.order_id === refreshedOrder.id
      return {
        seat_number: p.seat_number,
        name: p.name,
        phone: p.phone,
        check_in_code: belongsToOrder ? seat.check_in_code : null,
        checked_in_at: belongsToOrder ? seat.checked_in_at : null,
      }
    })

    const remainingPaySeconds =
      refreshedOrder.status === OrderStatus.PENDING_PAY
        ? Math.max(0, Math.ceil((refreshedOrder.locked_until - nowMs) / 1000))
        : 0

    return {
      id: refreshedOrder.id,
      schedule_id: refreshedOrder.schedule_id,
      route_name: schedule.route_name,
      departure_time: schedule.departure_time,
      openid: refreshedOrder.openid,
      pickup_station: refreshedOrder.pickup_station,
      dropoff_station: refreshedOrder.dropoff_station,
      total_amount: refreshedOrder.total_amount,
      refund_amount: refreshedOrder.refund_amount,
      refund_fee: refreshedOrder.refund_fee,
      status: refreshedOrder.status as OrderStatus,
      locked_until: refreshedOrder.locked_until,
      remaining_pay_seconds: remainingPaySeconds,
      paid_at: refreshedOrder.paid_at,
      refunded_at: refreshedOrder.refunded_at,
      created_at: refreshedOrder.created_at,
      passengers: passengersWithCheckIn,
    }
  }

  /**
   * 查询指定微信用户的全部订单列表
   */
  public getUserOrders(openid: string, nowMs = Date.now()): OrderDetailView[] {
    const rows = this.db
      .prepare<[string], { id: string }>(
        `SELECT id FROM orders WHERE openid = ? ORDER BY created_at DESC`,
      )
      .all(openid)

    return rows.map((r) => this.getOrderDetail(r.id, openid, nowMs))
  }

  /**
   * 阶梯退票与席位自愈（重置座位为 0 AVAILABLE，清空签到态与核验码，归还用户购票配额）
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

      this.db
        .prepare(
          `UPDATE schedule_seats
           SET status = 0, locked_by_openid = NULL, locked_until = NULL, order_id = NULL,
               checked_in_at = NULL, check_in_code = NULL
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
