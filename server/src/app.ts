import cors from '@fastify/cors'
import Database from 'better-sqlite3'
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AppConfig, appConfig } from './config/env.js'
import { initSchema } from './db/schema.js'
import { RosterAndAdminService } from './services/roster-export.js'
import { SeatLockService } from './services/seat-lock.js'
import { BusDomainError } from './types/domain.js'

export interface BuildAppOptions {
  db?: Database.Database
  config?: AppConfig
}

const intentionBodySchema = z.object({
  student_name: z.string().trim().min(1, '姓名不能为空'),
  phone: z.string().regex(/^1\d{10}$/, '请输入11位有效手机号'),
  departure_campus: z.string().trim().min(1, '出发校区不能为空'),
  destination: z.string().trim().min(1, '目的地不能为空'),
  travel_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD'),
})

const lockAndPayBodySchema = z.object({
  schedule_id: z.number().int().positive(),
  pickup_station: z.string().trim().min(1),
  dropoff_station: z.string().trim().min(1),
  passengers: z
    .array(
      z.object({
        seat_number: z.string().regex(/^\d{2}$/, '座位号需为两位数字，如 03'),
        name: z.string().trim().min(1, '乘车人姓名不能为空'),
        phone: z.string().regex(/^1\d{10}$/, '乘车人手机号需为11位数字'),
      }),
    )
    .min(1)
    .max(2),
})

const wxNotifyBodySchema = z.object({
  order_id: z.string().min(1),
  transaction_id: z.string().min(1).default('WX_SIMULATED_TX'),
})

const createScheduleBodySchema = z.object({
  route_name: z.string().trim().min(2),
  departure_time: z.number().int().positive(),
  open_booking_time: z.number().int().positive(),
  price_in_cents: z.number().int().positive(),
  pickup_stations: z.array(z.string().trim().min(1)).min(1),
  dropoff_stations: z.array(z.string().trim().min(1)).min(1),
  reserved_seat_numbers: z.array(z.string().regex(/^\d{2}$/)).optional(),
  refund_rules: z
    .object({
      tier1_hours: z.number().positive(),
      tier1_fee_pct: z.number().min(0).max(100),
      tier2_hours: z.number().positive(),
      tier2_fee_pct: z.number().min(0).max(100),
    })
    .optional(),
})

const toggleSeatBodySchema = z.object({
  seat_number: z.string().regex(/^\d{2}$/),
  reserved: z.boolean(),
})

const checkInBodySchema = z
  .object({
    seat_number: z.string().regex(/^\d{2}$/).optional(),
    check_in_code: z.string().trim().min(4).optional(),
    checked_in: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.seat_number || data.check_in_code), {
    message: '必须提供 seat_number 或 check_in_code 其中之一',
  })

function resolveOpenid(req: FastifyRequest): string {
  const headerVal = req.headers['x-wx-openid']
  if (typeof headerVal === 'string' && headerVal.trim().length > 0) {
    return headerVal.trim()
  }
  const queryObj = req.query as Record<string, unknown> | undefined
  if (queryObj && typeof queryObj.openid === 'string' && queryObj.openid.trim().length > 0) {
    return queryObj.openid.trim()
  }
  return 'wx_dev_default_student'
}

function assertAdminAuth(req: FastifyRequest, cfg: AppConfig): void {
  const token = req.headers['x-admin-token']
  const queryObj = req.query as Record<string, unknown> | undefined
  const queryToken = queryObj && typeof queryObj.admin_token === 'string' ? queryObj.admin_token : undefined
  if (token !== cfg.adminSecretToken && queryToken !== cfg.adminSecretToken) {
    throw new BusDomainError('ADMIN_UNAUTHORIZED', '管理员凭证无效或未提供', 401)
  }
}

export function buildApp(options?: BuildAppOptions): {
  app: FastifyInstance
  db: Database.Database
  seatService: SeatLockService
  rosterService: RosterAndAdminService
} {
  const cfg = options?.config ?? appConfig
  const db = options?.db ?? new Database(':memory:')
  initSchema(db)

  const seatService = new SeatLockService(db, {
    lockTtlMs: cfg.lockTtlMs,
    maxSeatsPerUser: cfg.maxSeatsPerUser,
  })
  const rosterService = new RosterAndAdminService(db, seatService)

  const app = Fastify({ logger: false })
  void app.register(cors, { origin: true })

  // 统一错误拦截器
  app.setErrorHandler((error, _req, reply: FastifyReply) => {
    if (error instanceof BusDomainError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
      })
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: error.issues.map((i) => i.message).join('; '),
      })
    }
    const errMessage = error instanceof Error ? error.message : 'Internal Server Error'
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: errMessage,
    })
  })

  // 1. POST /api/v1/intentions (学生提交返乡乘车意向)
  app.post('/api/v1/intentions', async (req) => {
    const openid = resolveOpenid(req)
    const body = intentionBodySchema.parse(req.body)
    const res = rosterService.submitIntention({
      openid,
      studentName: body.student_name,
      phone: body.phone,
      departureCampus: body.departure_campus,
      destination: body.destination,
      travelDate: body.travel_date,
    })
    return { code: 0, data: res }
  })

  // 2. GET /api/v1/schedules (获取班次列表及实时余票数)
  app.get('/api/v1/schedules', async () => {
    const list = seatService.listSchedules()
    return {
      code: 0,
      data: {
        server_time_ms: Date.now(),
        schedules: list,
      },
    }
  })

  // 3. GET /api/v1/schedules/:id/seat-map (获取 53 座实时状态图)
  app.get('/api/v1/schedules/:id/seat-map', async (req) => {
    const { id } = req.params as { id: string }
    const scheduleId = Number.parseInt(id, 10)
    const data = seatService.getSeatMap(scheduleId)
    return { code: 0, data }
  })

  // 4. POST /api/v1/orders/lock-and-pay (50 并发抢座与调起微信支付)
  app.post('/api/v1/orders/lock-and-pay', async (req) => {
    const openid = resolveOpenid(req)
    const body = lockAndPayBodySchema.parse(req.body)
    const result = seatService.lockSeatsAndCreateOrder({
      scheduleId: body.schedule_id,
      openid,
      pickupStation: body.pickup_station,
      dropoffStation: body.dropoff_station,
      passengers: body.passengers,
    })
    return { code: 0, data: result }
  })

  // 5. POST /api/v1/pay/wx-notify (微信支付异步回调 Webhook / 本地模拟支付确认)
  app.post('/api/v1/pay/wx-notify', async (req) => {
    const body = wxNotifyBodySchema.parse(req.body)
    const result = seatService.confirmPaymentWebhook({
      orderId: body.order_id,
      transactionId: body.transaction_id,
    })
    return { code: 0, data: result }
  })

  // 6. GET /api/v1/orders & GET /api/v1/orders/:id (查询个人订单列表与电子乘车凭单)
  app.get('/api/v1/orders', async (req) => {
    const openid = resolveOpenid(req)
    const orders = seatService.getUserOrders(openid)
    return { code: 0, data: { orders } }
  })

  app.get('/api/v1/orders/:id', async (req) => {
    const openid = resolveOpenid(req)
    const { id } = req.params as { id: string }
    const detail = seatService.getOrderDetail(id, openid)
    return { code: 0, data: detail }
  })

  // 7. POST /api/v1/orders/:id/refund (阶梯退票与席位自愈)
  app.post('/api/v1/orders/:id/refund', async (req) => {
    const openid = resolveOpenid(req)
    const { id } = req.params as { id: string }
    const res = seatService.applyTieredRefund({ orderId: id, openid })
    return { code: 0, data: res }
  })

  // 8. GET /api/v1/admin/intentions/summary (管理端查看意向统计)
  app.get('/api/v1/admin/intentions/summary', async (req) => {
    assertAdminAuth(req, cfg)
    return { code: 0, data: rosterService.getIntentionsSummary() }
  })

  // 9. POST /api/v1/admin/schedules (管理端发布新班次)
  app.post('/api/v1/admin/schedules', async (req) => {
    assertAdminAuth(req, cfg)
    const body = createScheduleBodySchema.parse(req.body)
    const scheduleId = seatService.createSchedule({
      routeName: body.route_name,
      departureTimeMs: body.departure_time,
      openBookingTimeMs: body.open_booking_time,
      priceInCents: body.price_in_cents,
      pickupStations: body.pickup_stations,
      dropoffStations: body.dropoff_stations,
      reservedSeatNumbers: body.reserved_seat_numbers,
      refundRules: body.refund_rules,
    })
    return { code: 0, data: { schedule_id: scheduleId } }
  })

  // 10. PATCH /api/v1/admin/schedules/:id/seats (管理员手动调整预留座)
  app.patch('/api/v1/admin/schedules/:id/seats', async (req) => {
    assertAdminAuth(req, cfg)
    const { id } = req.params as { id: string }
    const body = toggleSeatBodySchema.parse(req.body)
    const seat = seatService.toggleReservedSeat(
      Number.parseInt(id, 10),
      body.seat_number,
      body.reserved,
    )
    return { code: 0, data: seat }
  })

  // 11. GET /api/v1/admin/schedules/:id/dashboard (管理端实时售票大盘与手机点名列表)
  app.get('/api/v1/admin/schedules/:id/dashboard', async (req) => {
    assertAdminAuth(req, cfg)
    const { id } = req.params as { id: string }
    const query = req.query as { pickup_station?: string; only_unchecked?: string }
    const data = rosterService.getScheduleDashboard(Number.parseInt(id, 10), {
      pickupStation: query.pickup_station,
      onlyUnchecked: query.only_unchecked === 'true',
    })
    return { code: 0, data }
  })

  // 12. POST /api/v1/admin/schedules/:id/check-in (手机端现场点击签到 / 扫电子凭单码核销)
  app.post('/api/v1/admin/schedules/:id/check-in', async (req) => {
    assertAdminAuth(req, cfg)
    const { id } = req.params as { id: string }
    const body = checkInBodySchema.parse(req.body)
    const res = seatService.checkInSeat({
      scheduleId: Number.parseInt(id, 10),
      seatNumber: body.seat_number,
      checkInCode: body.check_in_code,
      checkedIn: body.checked_in,
    })
    return { code: 0, data: res }
  })

  // 13. GET /api/v1/admin/schedules/:id/export (导出双 Sheet A4 检票名册 Excel)
  app.get('/api/v1/admin/schedules/:id/export', async (req, reply) => {
    assertAdminAuth(req, cfg)
    const { id } = req.params as { id: string }
    const scheduleId = Number.parseInt(id, 10)
    const buffer = await rosterService.exportScheduleRosterExcel(scheduleId)
    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header(
        'Content-Disposition',
        `attachment; filename="chaozhou_bus_schedule_${scheduleId}_roster.xlsx"`,
      )
    return reply.send(buffer)
  })

  return { app, db, seatService, rosterService }
}
