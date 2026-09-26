/**
 * Fastify REST API 端到端集成测试
 * 覆盖：意向填报 -> 管理员开线 -> 选座下单 -> 支付回调 -> 电子凭单查询 -> 手机端扫码/点击签到 -> Excel导出 -> 阶梯退票
 * 运行：npx tsx src/app.test.ts
 */
import assert from 'node:assert/strict'
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
        student_name: '陈晓潮',
        phone: '13812345678',
        departure_campus: '大学城校区',
        destination: '潮州体育馆',
        travel_date: '2026-10-01',
      },
    })
    assert.equal(intentRes.statusCode, 200)

    // 2. 非管理员访问管理端接口应被 401 拦截
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/intentions/summary',
    })
    assert.equal(unauthRes.statusCode, 401)

    // 3. 管理员创建 53 座新班次
    const now = Date.now()
    const createSchedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/schedules',
      headers: adminHeaders,
      payload: {
        route_name: '大学城/本部 -> 潮州体育馆',
        departure_time: now + 72 * 3600 * 1000,
        open_booking_time: now - 60_000,
        price_in_cents: 10000,
        pickup_stations: ['大学城正门(08:00)', '本部东门(08:40)'],
        dropoff_stations: ['潮州高速口', '潮州体育馆'],
      },
    })
    assert.equal(createSchedRes.statusCode, 200)
    const scheduleId = (createSchedRes.json() as { data: { schedule_id: number } }).data.schedule_id

    // 4. 学生选座下单 (05号座)
    const lockRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/lock-and-pay',
      headers: studentHeaders,
      payload: {
        schedule_id: scheduleId,
        pickup_station: '大学城正门(08:00)',
        dropoff_station: '潮州体育馆',
        passengers: [{ seat_number: '05', name: '陈晓潮', phone: '13812345678' }],
      },
    })
    assert.equal(lockRes.statusCode, 200)
    const orderId = (lockRes.json() as { data: { orderId: string } }).data.orderId

    // 5. 模拟微信支付异步回调确认出票
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/wx-notify',
      payload: { order_id: orderId, transaction_id: 'WX_E2E_TX_999' },
    })
    assert.equal(payRes.statusCode, 200)

    // 6. 学生查询电子乘车凭单详情，拿到 6 位检票核验码
    const orderDetailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}`,
      headers: studentHeaders,
    })
    assert.equal(orderDetailRes.statusCode, 200)
    const checkInCode = (
      orderDetailRes.json() as {
        data: { passengers: Array<{ check_in_code: string }> }
      }
    ).data.passengers[0]!.check_in_code
    assert.equal(checkInCode.length, 6)

    // 7. 领队在手机端通过扫码/核验码给 05 号座签到
    const checkInRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/schedules/${scheduleId}/check-in`,
      headers: adminHeaders,
      payload: { check_in_code: `CZBUS:${scheduleId}:${checkInCode}` },
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
