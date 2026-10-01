import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export interface BackupResult {
  backupFile: string
  backupPath: string
  backupSize: number
  timestamp: number
  cleanedOldBackupsCount: number
}

function pad(num: number): string {
  return String(num).padStart(2, '0')
}

export function formatBackupFilename(d = new Date()): string {
  const yyyy = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  return `chaozhoubus_backup_${yyyy}${mo}${dd}_${hh}${mi}${ss}.db`
}

/**
 * 清理指定目录下超过 retentionDays 天的旧备份快照
 */
export function cleanOldBackups(backupDir: string, retentionDays = 7): number {
  if (!fs.existsSync(backupDir)) return 0
  const now = Date.now()
  const maxAgeMs = retentionDays * 24 * 3600 * 1000
  let cleanedCount = 0

  const files = fs.readdirSync(backupDir)
  for (const file of files) {
    if (file.startsWith('chaozhoubus_backup_') && file.endsWith('.db')) {
      const fullPath = path.join(backupDir, file)
      try {
        const stat = fs.statSync(fullPath)
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath)
          cleanedCount++
        }
      } catch (_err) {
        // 忽略单个文件状态读取异常
      }
    }
  }

  return cleanedCount
}

/**
 * 使用 better-sqlite3 原生在线热备份 API 导出完整的 .db 快照文件
 * 零停机、无锁备份，保证正在进行的事务一致性
 */
export async function createDatabaseBackup(
  db: Database.Database,
  targetDir: string,
  options?: {
    retentionDays?: number
    now?: Date
  },
): Promise<BackupResult> {
  const now = options?.now ?? new Date()
  const retentionDays = options?.retentionDays ?? 7

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const filename = formatBackupFilename(now)
  const backupPath = path.join(targetDir, filename)

  // 调用 better-sqlite3 原生非阻塞备份引擎
  await db.backup(backupPath)

  const stat = fs.statSync(backupPath)
  const cleanedOldBackupsCount = cleanOldBackups(targetDir, retentionDays)

  return {
    backupFile: filename,
    backupPath,
    backupSize: stat.size,
    timestamp: now.getTime(),
    cleanedOldBackupsCount,
  }
}
