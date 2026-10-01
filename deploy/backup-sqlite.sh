#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════
# ChaoZhouBus (高校潮州同乡会大巴智能系统)
# SQLite 数据库热备份与 7 天生命周期自动归档清理脚本
# 
# 适用场景：
# 1. Linux Crontab 定时任务（建议每日凌晨 02:00 或 04:00 执行）
# 2. 班次发车前或重大活动前的管理员手动触发备份
# 3. 支持 Docker 容器化环境与裸机/宿主机部署环境
# ═════════════════════════════════════════════════════════════════════

set -euo pipefail

# 1. 基础环境与路径配置（可根据实际部署路径调整）
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$BASE_DIR/deploy/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
BACKUP_FILENAME="chaozhoubus_backup_${TIMESTAMP}.db"
TARGET_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"
ADMIN_TOKEN="${ADMIN_SECRET_TOKEN:-chaozhou_admin_prod_secret_token_2026}"
PORT="${PORT:-3000}"

echo "=========================================================="
echo "🕒 [$(date '+%Y-%m-%d %H:%M:%S')] 开始执行 ChaoZhouBus 数据库热备份..."
echo "📂 备份存储目录: ${BACKUP_DIR}"
echo "⏳ 数据保留周期: ${RETENTION_DAYS} 天"
echo "=========================================================="

mkdir -p "${BACKUP_DIR}"

# 2. 尝试方式一：通过在线 REST API 触发（零锁、在线、WAL 内存事务安全刷盘）
HTTP_STATUS=$(curl -s -o /tmp/chaozhou_backup_res.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:${PORT}/api/v1/admin/backup" \
  -H "x-admin-token: ${ADMIN_TOKEN}" || echo "000")

if [ "${HTTP_STATUS}" = "200" ]; then
  echo "✅ [通过 API 触发热备份成功]"
  cat /tmp/chaozhou_backup_res.json
  echo ""
  rm -f /tmp/chaozhou_backup_res.json
else
  echo "⚠️ API 备份未响应 (HTTP 状态码: ${HTTP_STATUS})，尝试方式二：检查 Docker 容器或本地 SQLite..."

  # 方式二：Docker 容器内部直接备份
  if command -v docker &> /dev/null && docker ps | grep -q "chaozhou-bus-server"; then
    echo "🐳 检测到 Docker 容器运行中，在容器内执行热备份..."
    docker exec chaozhou-bus-server sh -c "mkdir -p data/backups && sqlite3 data/chaozhoubus.db \".backup 'data/backups/${BACKUP_FILENAME}'\""
    echo "✅ 容器内备份成功: ${BACKUP_FILENAME}"
  
  # 方式三：宿主机 sqlite3 命令直备
  elif command -v sqlite3 &> /dev/null; then
    DB_FILE="${BASE_DIR}/deploy/data/chaozhoubus.db"
    if [ ! -f "${DB_FILE}" ]; then
      DB_FILE="${BASE_DIR}/server/chaozhoubus.db"
    fi

    if [ -f "${DB_FILE}" ]; then
      echo "📦 正在使用宿主机 sqlite3 .backup 引擎备份: ${DB_FILE} -> ${TARGET_PATH}"
      sqlite3 "${DB_FILE}" ".backup '${TARGET_PATH}'"
      BACKUP_SIZE=$(ls -lh "${TARGET_PATH}" | awk '{print $5}')
      echo "✅ 宿主机备份完成! 文件大小: ${BACKUP_SIZE}"
    else
      echo "❌ 未找到活动的数据库文件，请确认 DB 路径！"
      exit 1
    fi
  else
    echo "❌ 无法执行热备份：服务未运行且宿主机未安装 sqlite3 CLI 工具。"
    exit 1
  fi
fi

# 3. 自动扫描并清理超过保留天数的历史备份快照
echo "🧹 正在清理超过 ${RETENTION_DAYS} 天的历史旧备份..."
CLEANED_COUNT=0
if [ -d "${BACKUP_DIR}" ]; then
  OLD_FILES=$(find "${BACKUP_DIR}" -name "chaozhoubus_backup_*.db" -type f -mtime +"${RETENTION_DAYS}")
  for f in ${OLD_FILES}; do
    echo "🗑️ 清理过期备份: $f"
    rm -f "$f"
    CLEANED_COUNT=$((CLEANED_COUNT + 1))
  done
fi

echo "=========================================================="
echo "🎉 [$(date '+%Y-%m-%d %H:%M:%S')] 数据库热备份全流程执行完毕！"
echo "📦 当前剩余备份份数: $(find "${BACKUP_DIR}" -name "chaozhoubus_backup_*.db" -type f | wc -l)"
echo "🧹 本次已清理过期快照: ${CLEANED_COUNT} 份"
echo "=========================================================="
