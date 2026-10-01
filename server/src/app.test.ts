/**
 * Fastify REST API 端到端集成测试
 * 覆盖：意向填报 -> 管理员开线 -> 选座下单 -> 支付回调 -> 电子凭单查询 -> 手机端扫码/点击签到 -> Excel导出 -> 阶梯退票 -> 日志记录
 * 运行：npx tsx src/app.test.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { buildApp } from './app.js'
import { appConfig } from './config/env.js'

export default async function run() {
  const { app, db } = buildApp()
  const adminHeaders = { 'x-admin-token': appConfig.adminSecretToken }
  const studentHeaders = { 'x-wx-openid': 'wx_e2e_student_001' }

  try {
    // 1. 学生提交返乡乘车意向
    const intentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/intentions',
      headers: studentHeaders,
      payload: {
        student_name: '陈同学',
        phone: '13800138000',
        departure_campus: '大学城校区',
        destination: '潮州人民广场',
        travel_date: '2026-10-01',
      },
    })
    assert.equal(intentRes.statusCode, 200)

    // 2. 管理员开通国庆返乡专线班次（53座）
    const scheduleRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/schedules',
      headers: adminHeaders,
      payload: {
        route_name: '广州大学城 -> 潮州体育馆（国庆返乡1号车）',
        departure_time: Date.now() + 72 * 3600 * 1000,
        open_booking_time: Date.now() - 60_000,
        price_in_cents: 10000,
        pickup_stations: ['大学城正门(08:00)', '本部东门(08:40)'],
        dropoff_stations: ['潮州高速口', '潮州体育馆', '潮州客运总站'],
        reserved_seat_numbers: ['01', '02'],
      },
    })
    assert.equal(scheduleRes.statusCode, 200)
    const scheduleId = (scheduleRes.json() as { data: { schedule_id: number } }).data.schedule_id

    // 3. 学生查询 53 座座位图
    const mapRes = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules/${scheduleId}/seat-map`,
      headers: studentHeaders,
    })
    assert.equal(mapRes.statusCode, 200)

    // 4. 学生锁座并生成待支付订单（抢 03 号座）
    const lockRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/lock-and-pay',
      headers: studentHeaders,
      payload: {
        schedule_id: scheduleId,
        pickup_station: '大学城正门(08:00)',
        dropoff_station: '潮州体育馆',
        passengers: [
          {
            seat_number: '03',
            name: '陈同学',
            phone: '13800138000',
          },
        ],
      },
    })
    assert.equal(lockRes.statusCode, 200)
    const orderId = (lockRes.json() as { data: { orderId: string } }).data.orderId

    // 5. 微信支付成功 Webhook 回调（本地模拟支付出票）
    const payNotifyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/wx-notify',
      payload: {
        order_id: orderId,
        transaction_id: 'WX_PAY_TX_20261001_001',
      },
    })
    assert.equal(payNotifyRes.statusCode, 200)

    // 6. 学生查询订单电子乘车凭单详情（验证 6 位检票码已生成）
    const orderRes = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}`,
      headers: studentHeaders,
    })
    assert.equal(orderRes.statusCode, 200)
    const orderData = (
      orderRes.json() as {
        data: {
          status: number
          passengers: Array<{ seat_number: string; check_in_code: string }>
        }
      }
    ).data
    assert.equal(orderData.status, 1)
    const checkInCode = orderData.passengers[0]?.check_in_code
    assert.ok(checkInCode && checkInCode.length === 6)

    // 7. 手机端现场点击签到
    const checkInRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/schedules/${scheduleId}/check-in`,
      headers: adminHeaders,
      payload: {
        seat_number: '03',
        checked_in: true,
      },
    })
    assert.equal(checkInRes.statusCode, 200)
    assert.equal((checkInRes.json() as { data: { checkedIn: boolean } }).data.checkedIn, true)

    // 8. 领队导出双 Sheet A4 检票名册 Excel
    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/schedules/${scheduleId}/export`,
      headers: adminHeaders,
    })
    assert.equal(exportRes.statusCode, 200)
    assert.ok(
      exportRes.headers['content-type']?.includes(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    )
    assert.ok(exportRes.rawPayload.byteLength > 1000)

    // 9. 学生在距发车 72h 申请阶梯退票（扣 5% 手续费，席位恢复空闲）
    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/refund`,
      headers: studentHeaders,
    })
    assert.equal(refundRes.statusCode, 200)
    assert.equal(
      (refundRes.json() as { data: { refundAmountCents: number } }).data.refundAmountCents,
      9500,
    )

    // 10. 验证 enableLogging=true 时请求与拦截日志正确写入文件
    const tmpLogPath = path.resolve(process.cwd(), 'test-temp-app.log')
    try {
      const logDb = new Database(':memory:')
      const loggedApp = buildApp({
        db: logDb,
        config: appConfig,
        enableLogging: true,
        logFilePath: tmpLogPath,
      }).app
      const testRes = await loggedApp.inject({
        method: 'GET',
        url: '/api/v1/schedules',
      })
      assert.equal(testRes.statusCode, 200)
      await loggedApp.close()
      logDb.close()
      assert.ok(fs.existsSync(tmpLogPath), 'Log file should be created when enableLogging=true')
      const logContent = fs.readFileSync(tmpLogPath, 'utf8')
      assert.ok(logContent.includes('GET /api/v1/schedules'), 'Log file should record request method and path')
    } finally {
      if (fs.existsSync(tmpLogPath)) {
        fs.unlinkSync(tmpLogPath)
      }
    }
  } finally {
    await app.close()
    db.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
