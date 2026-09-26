/**
 * 自动扫描并运行 server/src 下全部 *.test.ts 单元测试
 * 运行方式：npm test 或 npx tsx run-all-tests.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function findTestFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(fullPath)
    }
  }
  return results.sort()
}

async function main() {
  const srcDir = path.join(__dirname, 'src')
  const testFiles = findTestFiles(srcDir)

  if (testFiles.length === 0) {
    console.error('[✗] 未发现任何 *.test.ts 测试文件')
    process.exit(1)
  }

  let passedCount = 0
  let failedCount = 0
  const startTotal = performance.now()

  for (const file of testFiles) {
    const relPath = path.relative(__dirname, file).replace(/\\/g, '/')
    const start = performance.now()
    try {
      const mod = (await import(pathToFileURL(file).href)) as {
        default?: () => Promise<void> | void
      }
      if (typeof mod.default === 'function') {
        await mod.default()
      }
      const elapsed = Math.round(performance.now() - start)
      console.log(`[✓] ${relPath} (${elapsed}ms)`)
      passedCount++
    } catch (err) {
      const elapsed = Math.round(performance.now() - start)
      console.error(`[✗] ${relPath} (${elapsed}ms)`)
      console.error(err)
      failedCount++
    }
  }

  const totalElapsed = Math.round(performance.now() - startTotal)
  console.log('\n═══════════════════════════════════════')
  console.log(`  测试完成: ${passedCount} 通过, ${failedCount} 失败`)
  console.log(`  总耗时: ${totalElapsed}ms`)
  console.log('═══════════════════════════════════════')

  if (failedCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
