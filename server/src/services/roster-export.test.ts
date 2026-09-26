/**
 * RosterAndAdminService 单元测试（含意向统计、现场点名过滤与双 Sheet Excel 导出校验）
 * 运行：npx tsx src/services/roster-export.test.ts
 */
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { initSchema } from '../db/schema.js'
import { RosterAndAdminService } from './roster-export.js'
import { SeatLockService } from './seat-lock.js'

const BASE_NOW_MS = 1_760_000_000_000

export default async function run() {
  const db = new Database(':memory:')
  initSchema(db)
  const seatService = new SeatLockService(db)
  const rosterService = new RosterAndAdminService(db, seatService)

  try {
    // 1. 测试返乡乘车意向收集与热力汇总
    rosterService.submitIntention({
      openid: 'wx_stu_1',
      studentName: '陈潮州',
      phone: '13800000001',
      departureCampus: '大学城校区',
      destination: '潮州体育馆',
      travelDate: '2026-10-01',
      nowMs: BASE_NOW_MS,
    })
    rosterService.submitIntention({
      openid: 'wx_stu_2',
      studentName: '林韩江',
      phone: '13800000002',
      departureCampus: '大学城校区',
      destination: '潮州体育馆',
      travelDate: '2026-10-01',
      nowMs: BASE_NOW_MS,
    })

    const summary = rosterService.getIntentionsSummary()
    assert.equal(summary.total_intentions, 2)
    assert.equal(summary.groups[0]?.student_count, 2)

    // 2. 创建班次并模拟不同校区同学购票与现场点名
    const scheduleId = seatService.createSchedule({
      routeName: '大学城/本部 -> 潮州体育馆',
      departureTimeMs: BASE_NOW_MS + 48 * 3600 * 1000,
      openBookingTimeMs: BASE_NOW_MS - 10_000,
      priceInCents: 9500,
      pickupStations: ['大学城正门(08:00)', '本部东门(08:40)'],
      dropoffStations: ['潮州高速口', '潮州体育馆'],
      nowMs: BASE_NOW_MS,
    })

    // 本部东门上车（座位 08）
    const orderBenbu = seatService.lockSeatsAndCreateOrder({
      scheduleId,
      openid: 'wx_benbu',
      pickupStation: '本部东门(08:40)',
      dropoffStation: '潮州体育馆',
      passengers: [{ seat_number: '08', name: '王本部', phone: '13900000008' }],
      nowMs: BASE_NOW_MS,
    })
    seatService.confirmPaymentWebhook({
      orderId: orderBenbu.orderId,
      transactionId: 'TX_BENBU',
      nowMs: BASE_NOW_MS + 1000,
    })

    // 大学城正门上车（座位 05、03，故意乱序传入，验证导出按座位号升序）
    const orderDaxue = seatService.lockSeatsAndCreateOrder({
      scheduleId,
      openid: 'wx_daxue',
      pickupStation: '大学城正门(08:00)',
      dropoffStation: '潮州高速口',
      passengers: [
        { seat_number: '05', name: '李五座', phone: '13900000005' },
        { seat_number: '03', name: '张三座', phone: '13900000003' },
      ],
      nowMs: BASE_NOW_MS,
    })
    seatService.confirmPaymentWebhook({
      orderId: orderDaxue.orderId,
      transactionId: 'TX_DAXUE',
      nowMs: BASE_NOW_MS + 2000,
    })

    // 领队在手机上给 03 号座“张三座”点击签到，05 号与 08 号保持未签到
    seatService.checkInSeat({
      scheduleId,
      seatNumber: '03',
      checkedIn: true,
      nowMs: BASE_NOW_MS + 5000,
    })

    // 3. 验证手机端现场点名过滤（按校区 + 只看未到）
    const dashAll = rosterService.getScheduleDashboard(scheduleId, { nowMs: BASE_NOW_MS + 6000 })
    assert.equal(dashAll.sold_count, 3)
    assert.equal(dashAll.checked_in_count, 1)
    assert.equal(dashAll.un_checked_in_count, 2)

    const dashDaxueUnchecked = rosterService.getScheduleDashboard(scheduleId, {
      pickupStation: '大学城正门(08:00)',
      onlyUnchecked: true,
      nowMs: BASE_NOW_MS + 6000,
    })
    assert.equal(dashDaxueUnchecked.passengers.length, 1, '大学城未到人数应为 1 人（05座）')
    assert.equal(dashDaxueUnchecked.passengers[0]?.seat_number, '05')

    // 4. 验证双 Sheet Excel 导出内容
    const excelBuffer = await rosterService.exportScheduleRosterExcel(
      scheduleId,
      BASE_NOW_MS + 6000,
    )
    assert.ok(excelBuffer.byteLength > 1000, '导出的 Excel Buffer 应非空且包含完整工作簿')

    const wb = new ExcelJS.Workbook()
    const arrayBuf = excelBuffer.buffer.slice(
      excelBuffer.byteOffset,
      excelBuffer.byteOffset + excelBuffer.byteLength,
    ) as ArrayBuffer
    await wb.xlsx.load(arrayBuf)

    const sheet1 = wb.getWorksheet('按上车站点检票表')
    const sheet2 = wb.getWorksheet('01-53全车座位总表')
    assert.ok(sheet1, '必须包含 Sheet 1：按上车站点检票表')
    assert.ok(sheet2, '必须包含 Sheet 2：01-53全车座位总表')
    assert.equal(sheet2.rowCount, 54, 'Sheet 2 必须包含 1 行表头 + 53 行全车座位')

    // 检查 Sheet 1 中 03座 排在 05座 之前，且 03座 显示“✅ 已签到”，05座 显示“□ 未签到”
    const sheet1Values: string[] = []
    sheet1.eachRow((row) => {
      sheet1Values.push(row.values ? JSON.stringify(row.values) : '')
    })
    const idx03 = sheet1Values.findIndex((txt) => txt.includes('03座') && txt.includes('张三座'))
    const idx05 = sheet1Values.findIndex((txt) => txt.includes('05座') && txt.includes('李五座'))
    const idx08 = sheet1Values.findIndex((txt) => txt.includes('08座') && txt.includes('王本部'))

    assert.ok(idx03 > 0 && idx05 > idx03, '同一上车站点内 03座 必须排在 05座 之前')
    assert.ok(idx08 > idx05, '本部东门(08:40) 分块必须排在 大学城正门(08:00) 分块之后')
    assert.ok(sheet1Values[idx03]?.includes('已签到'), '手机已签到的 03座 在 Excel 中必须同步显示已签到')
    assert.ok(sheet1Values[idx05]?.includes('未签到'), '未签到的 05座 在 Excel 中必须显示未签到')
  } finally {
    db.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
