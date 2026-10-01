import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { buildApp } from './app.js'
import { appConfig } from './config/env.js'

async function startServer() {
  const dbFullPath = path.resolve(process.cwd(), appConfig.sqliteDbPath)
  const dbDir = path.dirname(dbFullPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const logFilePath = path.resolve(process.cwd(), 'server.log')
  const db = new Database(dbFullPath)
  const { app, seatService } = buildApp({
    db,
    config: appConfig,
    enableLogging: true,
    logFilePath,
  })

  // 若本地数据库中尚无班次，自动创建一个默认的潮州返乡测试班次（53 座）方便微信开发者工具直接联调
  const existing = seatService.listSchedules()
  if (existing.length === 0) {
    const now = Date.now()
    const scheduleId = seatService.createSchedule({
      routeName: '大学城/本部校区 -> 潮州体育馆（国庆返乡1号车）',
      departureTimeMs: now + 72 * 3600 * 1000,
      openBookingTimeMs: now - 60_000,
      priceInCents: 9800,
      pickupStations: ['大学城正门(08:00)', '本部东门(08:40)'],
      dropoffStations: ['潮州高速口', '潮州体育馆', '潮州客运总站'],
    })
    console.log(`[Seed] 已自动初始化默认测试班次 ID=${scheduleId}（共 53 座，01/02 为领队预留座）`)
  }

  await app.listen({ port: appConfig.port, host: appConfig.host })
  console.log(`🚌 ChaoZhouBus 服务端已启动: http://localhost:${appConfig.port}`)
  console.log(`📋 实时请求日志与业务记录同步输出至终端控制台，并保存于: ${logFilePath}`)
}

startServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
