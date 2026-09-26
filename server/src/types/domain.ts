/**
 * ChaoZhouBus 核心领域模型与共享类型定义
 * 严格对齐 REQUIREMENTS.md 四、五章节契约，禁止使用 any
 */

/** 座位状态枚举：0-空闲可选，1-锁定待付，2-已售出，3-领队预留 */
export enum SeatStatus {
  AVAILABLE = 0,
  LOCKED = 1,
  SOLD = 2,
  RESERVED = 3,
}

/** 班次状态枚举：0-未开售，1-售票中，2-已售罄，3-已发车 */
export enum ScheduleStatus {
  UPCOMING = 0,
  SELLING = 1,
  SOLD_OUT = 2,
  DEPARTED = 3,
}

/** 订单状态枚举：0-待支付，1-已出票，2-已退款，3-已超时取消，4-超时迟到支付自动退款中 */
export enum OrderStatus {
  PENDING_PAY = 0,
  PAID = 1,
  REFUNDED = 2,
  CANCELLED = 3,
  EXPIRED_REFUNDING = 4,
}

/** 阶梯退款规则配置 */
export interface RefundRulesConfig {
  /** 第一阶梯小时阈值（默认 48 小时：距发车 >= 48h 扣 tier1_fee_pct%） */
  tier1_hours: number
  /** 第一阶梯手续费百分比（默认 5%） */
  tier1_fee_pct: number
  /** 第二阶梯小时阈值（默认 24 小时：24h <= 距发车 < 48h 扣 tier2_fee_pct%；< 24h 禁止线上退款） */
  tier2_hours: number
  /** 第二阶梯违约金百分比（默认 20%） */
  tier2_fee_pct: number
}

/** 乘车人实名明细（已精简学号与行李数，仅保留座位号、姓名、手机号） */
export interface PassengerItem {
  seat_number: string
  name: string
  phone: string
}

/** 座位图单个座位视图结构 */
export interface SeatViewItem {
  seat_number: string
  status: SeatStatus
  locked_by_openid: string | null
  locked_until: number | null
  order_id: string | null
  checked_in_at: number | null
}

/** 班次详情与 53 座视图响应结构 */
export interface ScheduleSeatMapData {
  schedule_id: number
  route_name: string
  departure_time: number
  open_booking_time: number
  price_in_cents: number
  total_seats: number
  pickup_stations: string[]
  dropoff_stations: string[]
  refund_rules: RefundRulesConfig
  status: ScheduleStatus
  server_time_ms: number
  seats: SeatViewItem[]
}

/** 现场检票/点名单个席位详情 */
export interface RollCallPassengerItem {
  seat_number: string
  name: string
  phone: string
  pickup_station: string
  dropoff_station: string
  order_id: string
  check_in_code: string
  checked_in_at: number | null
}

/** 业务异常错误码 */
export type DomainErrorCode =
  | 'SCHEDULE_NOT_FOUND'
  | 'BOOKING_NOT_OPEN'
  | 'INVALID_STATION'
  | 'QUOTA_EXCEEDED'
  | 'SEAT_RESERVED'
  | 'SEAT_UNAVAILABLE'
  | 'INVALID_SEAT_NUMBER'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_FORBIDDEN'
  | 'ORDER_INVALID_STATE'
  | 'REFUND_WINDOW_CLOSED'
  | 'CHECK_IN_INVALID'
  | 'ADMIN_UNAUTHORIZED'

/** 结构化业务错误 */
export class BusDomainError extends Error {
  public readonly code: DomainErrorCode
  public readonly statusCode: number

  constructor(code: DomainErrorCode, message: string, statusCode = 400) {
    super(`[${code}] ${message}`)
    this.name = 'BusDomainError'
    this.code = code
    this.statusCode = statusCode
  }
}
