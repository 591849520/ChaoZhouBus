/**
 * SQLite 热备份与过期快照清理单元测试
 * 运行：npx tsx src/db/backup.test.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { cleanOldBackups, createDatabaseBackup, formatBackupFilename } from './backup.js'

export default async function run() {
  const tempDir = path.resolve(process.cwd(), 'temp-test-backups')
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
  fs.mkdirSync(tempDir, { recursive: true })

  try {
    // 1. 验证备份文件名格式化
    const mockDate = new Date('2026-10-01T08:30:15Z')
    const filename = formatBackupFilename(mockDate)
    assert.ok(
      filename.startsWith('chaozhoubus_backup_'),
      'Backup filename should start with prefix',
    )
    assert.ok(filename.endsWith('.db'), 'Backup filename should have .db extension')

    // 2. 验证创建在线数据库热备份
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE test_data (id INTEGER PRIMARY KEY, content TEXT);
      INSERT INTO test_data (content) VALUES ('hello backup world');
    `)

    const result = await createDatabaseBackup(db, tempDir, {
      retentionDays: 7,
      now: mockDate,
    })

    assert.ok(fs.existsSync(result.backupPath), 'Backup file must exist on disk')
    assert.ok(result.backupSize > 0, 'Backup file size must be greater than 0')
    assert.equal(result.backupFile, filename)

    // 打开备份后的数据库，验证数据一致性
    const backupDb = new Database(result.backupPath)
    const row = backupDb.prepare('SELECT content FROM test_data WHERE id = 1').get() as {
      content: string
    }
    assert.equal(row.content, 'hello backup world', 'Restored backup must contain original data')
    backupDb.close()
    db.close()

    // 3. 验证过期快照清理逻辑
    const oldFile = path.join(tempDir, 'chaozhoubus_backup_20260901_000000.db')
    fs.writeFileSync(oldFile, 'fake db content')
    // 将该文件的修改时间修改为 15 天前
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 3600 * 1000)
    fs.utimesSync(oldFile, fifteenDaysAgo, fifteenDaysAgo)

    const freshFile = path.join(tempDir, 'chaozhoubus_backup_20261002_000000.db')
    fs.writeFileSync(freshFile, 'fresh fake db content')

    // 执行 7 天保留策略清理
    const cleaned = cleanOldBackups(tempDir, 7)
    assert.equal(cleaned, 1, 'Should clean exactly 1 expired backup file')
    assert.ok(!fs.existsSync(oldFile), 'Old backup file should be removed')
    assert.ok(fs.existsSync(freshFile), 'Recent backup file should be kept')
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
