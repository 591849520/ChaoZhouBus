import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { SeatStatus } from '../types/domain.js'
import { SeatLockService } from './seat-lock.js'

export interface CreateIntentionInput {
  openid: string
  studentName: string
  phone: string
  departureCampus: string
  destination: string
  travelDate: string
  nowMs?: number
}

export interface IntentionSummaryItem {
  departure_campus: string
  destination: string
  travel_date: string
  student_count: number
}

export interface ScheduleDashboardData {
  schedule_id: number
  route_name: string
  departure_time: number
  total_seats: number
  sold_count: number
  locked_count: number
  available_count: number
  reserved_count: number
  checked_in_count: number
  un_checked_in_count: number
  station_breakdown: Array<{
    pickup_station: string
    total_passengers: number
    checked_in_passengers: number
    un_checked_in_passengers: number
  }>
  passengers: Array<{
    seat_number: string
    name: string
    phone: string
    pickup_station: string
    dropoff_station: string
    order_id: string
    check_in_code: string
    checked_in: boolean
    checked_in_at: number | null
  }>
}

function formatTimeHHmm(timestampMs: number): string {
  const d = new Date(timestampMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export class RosterAndAdminService {
  private readonly db: Database.Database
  private readonly seatService: SeatLockService

  constructor(db: Database.Database, seatService: SeatLockService) {
    this.db = db
    this.seatService = seatService
  }

  /**
   * 学生提交返乡乘车意向（无需学号与行李数）
   */
  public submitIntention(input: CreateIntentionInput): { id: number } {
    const nowMs = input.nowMs ?? Date.now()
    const info = this.db
      .prepare(
        `INSERT INTO intentions (
          openid, student_name, phone, departure_campus, destination, travel_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.openid,
        input.studentName,
        input.phone,
        input.departureCampus,
        input.destination,
        input.travelDate,
        nowMs,
      )

    return { id: Number(info.lastInsertRowid) }
  }

  /**
   * 管理员查看返乡意向热力汇总（按出发校区 + 目的地 + 日期分组统计人数）
   */
  public getIntentionsSummary(): {
    total_intentions: number
    groups: IntentionSummaryItem[]
  } {
    const groups = this.db
      .prepare<[], IntentionSummaryItem>(
        `SELECT departure_campus, destination, travel_date, COUNT(*) AS student_count
         FROM intentions
         GROUP BY departure_campus, destination, travel_date
         ORDER BY student_count DESC, travel_date ASC`,
      )
      .all()

    const total = groups.reduce((acc, g) => acc + g.student_count, 0)
    return { total_intentions: total, groups }
  }

  /**
   * 管理端获取班次实时大盘与手机端现场检票点名列表
   * 支持按 pickupStation（校区）与 onlyUnchecked（只看未到）过滤
   */
  public getScheduleDashboard(
    scheduleId: number,
    filters?: {
      pickupStation?: string
      onlyUnchecked?: boolean
      nowMs?: number
    },
  ): ScheduleDashboardData {
    const nowMs = filters?.nowMs ?? Date.now()
    const seatMap = this.seatService.getSeatMap(scheduleId, nowMs)
    const allRollCall = this.seatService.getRollCallList(scheduleId)

    const soldCount = seatMap.seats.filter((s) => s.status === SeatStatus.SOLD).length
    const lockedCount = seatMap.seats.filter((s) => s.status === SeatStatus.LOCKED).length
    const availableCount = seatMap.seats.filter((s) => s.status === SeatStatus.AVAILABLE).length
    const reservedCount = seatMap.seats.filter((s) => s.status === SeatStatus.RESERVED).length

    const checkedInCount = allRollCall.filter((p) => p.checked_in_at !== null).length
    const unCheckedInCount = allRollCall.length - checkedInCount

    const stationBreakdown = seatMap.pickup_stations.map((station) => {
      const stationList = allRollCall.filter((p) => p.pickup_station === station)
      const stationChecked = stationList.filter((p) => p.checked_in_at !== null).length
      return {
        pickup_station: station,
        total_passengers: stationList.length,
        checked_in_passengers: stationChecked,
        un_checked_in_passengers: stationList.length - stationChecked,
      }
    })

    let filteredPassengers = allRollCall.map((p) => ({
      ...p,
      checked_in: p.checked_in_at !== null,
    }))

    if (filters?.pickupStation && filters.pickupStation !== 'ALL') {
      filteredPassengers = filteredPassengers.filter(
        (p) => p.pickup_station === filters.pickupStation,
      )
    }

    if (filters?.onlyUnchecked) {
      filteredPassengers = filteredPassengers.filter((p) => !p.checked_in)
    }

    return {
      schedule_id: seatMap.schedule_id,
      route_name: seatMap.route_name,
      departure_time: seatMap.departure_time,
      total_seats: seatMap.total_seats,
      sold_count: soldCount,
      locked_count: lockedCount,
      available_count: availableCount,
      reserved_count: reservedCount,
      checked_in_count: checkedInCount,
      un_checked_in_count: unCheckedInCount,
      station_breakdown: stationBreakdown,
      passengers: filteredPassengers,
    }
  }

  /**
   * 导出标准 A4 打印级双 Sheet Excel 检票名册
   * - Sheet 1: 按上车站点检票表（按 pickup_station 时序分块，块内按 seat_number ASC 升序）
   * - Sheet 2: 01-53全车座位总表（方便跟车领队走过道按座位号核对全车 53 座状态）
   * - 6 列标准字段：[座位号, 姓名, 手机号, 上车站点, 预选下车点, 签到状态/领队核验栏]
   */
  public async exportScheduleRosterExcel(
    scheduleId: number,
    nowMs = Date.now(),
  ): Promise<Buffer> {
    const seatMap = this.seatService.getSeatMap(scheduleId, nowMs)
    const rollCallList = this.seatService.getRollCallList(scheduleId)
    const rollCallBySeat = new Map(rollCallList.map((item) => [item.seat_number, item]))

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'ChaoZhouBus System'
    workbook.created = new Date(nowMs)

    // ═══════════════════════════════════════════════════════════════════════
    // Sheet 1: 按上车站点检票表（A4 纵向打印布局）
    // ═══════════════════════════════════════════════════════════════════════
    const sheet1 = workbook.addWorksheet('按上车站点检票表', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    })

    sheet1.columns = [
      { header: '座位号', key: 'seat_number', width: 10 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '手机号', key: 'phone', width: 16 },
      { header: '上车站点', key: 'pickup_station', width: 22 },
      { header: '预选下车点', key: 'dropoff_station', width: 18 },
      { header: '签到状态 / 领队核验栏', key: 'check_in_status', width: 22 },
    ]

    // 顶部大标题行
    const titleRow = sheet1.insertRow(1, [
      `【潮州同乡会返乡大巴检票名册】 ${seatMap.route_name} （已售 ${rollCallList.length}/${seatMap.total_seats} 座）`,
    ])
    sheet1.mergeCells('A1:F1')
    titleRow.font = { bold: true, size: 13 }
    titleRow.alignment = { vertical: 'middle', horizontal: 'center' }
    titleRow.height = 28

    // 第 2 行作为表头样式加粗
    const headerRow1 = sheet1.getRow(2)
    headerRow1.font = { bold: true, size: 11 }
    headerRow1.alignment = { vertical: 'middle', horizontal: 'center' }
    headerRow1.height = 22

    // 按上车站点时序分块写入
    const knownStations = [...seatMap.pickup_stations]
    for (const p of rollCallList) {
      if (!knownStations.includes(p.pickup_station)) {
        knownStations.push(p.pickup_station)
      }
    }

    for (const station of knownStations) {
      const stationPassengers = rollCallList
        .filter((p) => p.pickup_station === station)
        .sort((a, b) => a.seat_number.localeCompare(b.seat_number))

      const checkedCount = stationPassengers.filter((p) => p.checked_in_at !== null).length
      const groupRow = sheet1.addRow([
        `📍 上车站点：${station} （应上车 ${stationPassengers.length} 人，手机已签到 ${checkedCount} 人）`,
      ])
      sheet1.mergeCells(`A${groupRow.number}:F${groupRow.number}`)
      groupRow.font = { bold: true, size: 11 }
      groupRow.height = 22

      for (const p of stationPassengers) {
        const statusText =
          p.checked_in_at !== null
            ? `✅ 已签到 (${formatTimeHHmm(p.checked_in_at)})`
            : '□ 未签到'

        const row = sheet1.addRow({
          seat_number: `${p.seat_number}座`,
          name: p.name,
          phone: p.phone,
          pickup_station: p.pickup_station,
          dropoff_station: p.dropoff_station,
          check_in_status: statusText,
        })
        row.alignment = { vertical: 'middle', horizontal: 'center' }
        row.height = 20
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Sheet 2: 01-53全车座位总表（按 01~53 物理座位顺序）
    // ═══════════════════════════════════════════════════════════════════════
    const sheet2 = workbook.addWorksheet('01-53全车座位总表', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    })

    sheet2.columns = [
      { header: '座位号', key: 'seat_number', width: 10 },
      { header: '席位状态', key: 'seat_status', width: 14 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '手机号', key: 'phone', width: 16 },
      { header: '上车站点', key: 'pickup_station', width: 22 },
      { header: '预选下车点', key: 'dropoff_station', width: 18 },
      { header: '签到状态 / 领队核验栏', key: 'check_in_status', width: 22 },
    ]

    const headerRow2 = sheet2.getRow(1)
    headerRow2.font = { bold: true, size: 11 }
    headerRow2.alignment = { vertical: 'middle', horizontal: 'center' }
    headerRow2.height = 22

    for (const seat of seatMap.seats) {
      const passenger = rollCallBySeat.get(seat.seat_number)
      let statusLabel = '空闲可选'
      if (seat.status === SeatStatus.RESERVED) statusLabel = '领队预留'
      else if (seat.status === SeatStatus.SOLD) statusLabel = '已售出'
      else if (seat.status === SeatStatus.LOCKED) statusLabel = '锁定待付'

      const checkInText = passenger
        ? passenger.checked_in_at !== null
          ? `✅ 已签到 (${formatTimeHHmm(passenger.checked_in_at)})`
          : '□ 未签到'
        : '-'

      const row = sheet2.addRow({
        seat_number: `${seat.seat_number}座`,
        seat_status: statusLabel,
        name: passenger?.name ?? (seat.status === SeatStatus.RESERVED ? '【领队/安全员】' : '-'),
        phone: passenger?.phone ?? '-',
        pickup_station: passenger?.pickup_station ?? '-',
        dropoff_station: passenger?.dropoff_station ?? '-',
        check_in_status: checkInText,
      })
      row.alignment = { vertical: 'middle', horizontal: 'center' }
      row.height = 19
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(arrayBuffer)
  }
}
