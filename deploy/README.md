# ChaoZhouBus (高校潮州同乡会大巴智能系统) 生产部署与灾备运维手册

本手册指导如何将 **ChaoZhouBus** 快速、高可用地部署到生产环境（如腾讯云、阿里云轻量应用服务器或 VPS），并配置 Nginx 反向代理、HTTPS 证书、探活监控及 SQLite 自动化冷热双灾备。

---

## 架构概览与优势

- **零外部中间件依赖**：无需部署臃肿的 MySQL、Redis 集群，采用 **Node.js 20+ + Fastify + SQLite 3 (`better-sqlite3`, WAL 模式)**。
- **微秒级串行防超卖**：利用 Node.js 单线程事件循环与 `better-sqlite3` 的同步排他事务（`db.transaction(...).immediate()`），彻底杜绝跨网络通信带来的竞态条件与分布式锁死锁。
- **超轻资源占用**：整套系统在 **1核 1G** 或 **2核 2G** 的入门级云服务器上即可平稳运行，内存消耗通常低于 120MB，从容应对千人级并发抢票。

---

## 方案 A：Docker Compose 一键容器化部署（推荐）

适合希望环境隔离、开箱即用、一键启停的运维场景。

### 1. 环境准备
确保目标服务器已安装：
- Docker 20.10+
- Docker Compose v2+

### 2. 准备配置与目录
```bash
# 1. 克隆代码仓库至服务器
git clone https://github.com/591849520/ChaoZhouBus.git /opt/chaozhoubus
cd /opt/chaozhoubus

# 2. 复制生产环境变量模板
cp deploy/.env.production.example deploy/.env.production

# 3. 编辑配置并填入生产密钥与商户号
vim deploy/.env.production

# 4. 创建持久化数据与日志目录（确保权限）
mkdir -p deploy/data/backups deploy/logs
chmod -R 755 deploy/data deploy/logs
```

### 3. 一键构建并启动
```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

### 4. 检查服务运行状态与探活
```bash
# 查看容器状态
docker compose -f deploy/docker-compose.yml ps

# 查看服务实时业务日志
docker compose -f deploy/docker-compose.yml logs -f

# 验证健康探活接口 (返回 status: "ok", db_status: "connected")
curl -s http://127.0.0.1:3000/health
```

---

## 方案 B：PM2 裸机原生部署（极致性能）

适合低配小内存 VPS，避免 Docker 额外虚拟化开销。

### 1. 环境准备
```bash
# 安装 Node.js 20 LTS (推荐使用 nvm 或 NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs gcc g++ make

# 全局安装 PM2 进程守护工具
npm install -g pm2
```

### 2. 构建项目
```bash
cd /opt/chaozhoubus/server
npm ci
npm run build
```

### 3. 启动 PM2 守护进程
```bash
cd /opt/chaozhoubus
# 启动进程（注意：严格单实例 instances: 1，保障微秒级内存排他锁）
pm2 start deploy/ecosystem.config.cjs --env production

# 保存开机自启
pm2 save
pm2 startup
```

---

## 接入 Nginx 反向代理与 SSL (HTTPS) 证书

微信小程序强制要求后端 API 必须通过权威机构签发的 **HTTPS (TLS 1.2+)** 访问。

### 1. 安装 Nginx 与 Certbot
```bash
apt update
apt install -y nginx certbot python3-certbot-nginx
```

### 2. 导入 Nginx 站点配置
```bash
# 复制配置文件
cp /opt/chaozhoubus/deploy/nginx/chaozhoubus.conf /etc/nginx/conf.d/chaozhoubus.conf

# 编辑域名，将 bus.yourdomain.com 替换为您的实际业务域名
vim /etc/nginx/conf.d/chaozhoubus.conf
```

### 3. 申请免费 Let's Encrypt 证书
```bash
# 使用 Certbot 自动签发并配置 Nginx
certbot --nginx -d bus.yourdomain.com
```

### 4. 测试并重载 Nginx
```bash
nginx -t
systemctl reload nginx
```
此时通过浏览器或手机访问 `https://bus.yourdomain.com/health`，即可看到绿色的安全锁与健康状态 JSON。

---

## 自动化定时备份与灾难恢复（7 天快照轮转）

系统内置 SQLite 原生**在线热备份（Online Hot Backup）**能力，备份过程**零停机、无锁阻塞**，即使正在有用户抢票，也不会造成请求挂起或数据不一致。

### 1. 配置每日自动定时备份（Linux Crontab）
```bash
# 赋予备份脚本可执行权限
chmod +x /opt/chaozhoubus/deploy/backup-sqlite.sh

# 打开当前用户的 crontab 编辑器
crontab -e
```
添加以下一行（设定每天凌晨 02:00 自动执行热备份，并清理 7 天以前的历史快照）：
```cron
0 2 * * * /opt/chaozhoubus/deploy/backup-sqlite.sh >> /var/log/chaozhoubus-backup.log 2>&1
```

### 2. 手动触发即时备份
在班次发车或重大抢票活动前，可通过以下任一方式执行快照：
- **方式一（命令行）**：
  ```bash
  /opt/chaozhoubus/deploy/backup-sqlite.sh
  ```
- **方式二（管理端 REST API）**：
  ```bash
  curl -X POST http://127.0.0.1:3000/api/v1/admin/backup \
       -H "x-admin-token: chaozhou_admin_prod_secret_token_2026"
  ```
生成的备份文件将保存于 `deploy/data/backups/chaozhoubus_backup_YYYYMMDD_HHMMSS.db`。

### 3. 极速灾难恢复手册（30 秒内恢复数据）
假设发生宿主机磁盘异常、误删数据或需要版本回滚：

1. **暂停后端服务**：
   ```bash
   # Docker 环境
   docker compose -f /opt/chaozhoubus/deploy/docker-compose.yml down
   # 或 PM2 环境
   pm2 stop chaozhoubus-server
   ```
2. **用目标备份覆盖当前数据库**：
   ```bash
   # 选取一个健康的快照文件
   cp /opt/chaozhoubus/deploy/data/backups/chaozhoubus_backup_20261001_020000.db \
      /opt/chaozhoubus/deploy/data/chaozhoubus.db
   
   # 清理旧的 WAL 和 SHM 临时缓存文件
   rm -f /opt/chaozhoubus/deploy/data/chaozhoubus.db-wal \
         /opt/chaozhoubus/deploy/data/chaozhoubus.db-shm
   ```
3. **重新启动服务**：
   ```bash
   # Docker 环境
   docker compose -f /opt/chaozhoubus/deploy/docker-compose.yml up -d
   # 或 PM2 环境
   pm2 start chaozhoubus-server
   ```
4. **验证恢复**：
   ```bash
   curl -s http://127.0.0.1:3000/health
   ```

---

## 常用运维维护指令速查

| 操作 | Docker Compose 方式 | PM2 方式 |
| :--- | :--- | :--- |
| **启动服务** | `docker compose up -d` | `pm2 start deploy/ecosystem.config.cjs` |
| **停止服务** | `docker compose down` | `pm2 stop chaozhoubus-server` |
| **重启服务** | `docker compose restart` | `pm2 restart chaozhoubus-server` |
| **查看实时日志** | `docker compose logs -f --tail=100` | `pm2 logs chaozhoubus-server` |
| **检查系统资源** | `docker stats chaozhou-bus-server` | `pm2 monit` |
| **检查数据库健康** | `curl -s http://127.0.0.1:3000/health` | `curl -s http://127.0.0.1:3000/health` |
