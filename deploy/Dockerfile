# ═════════════════════════════════════════════════════════════════════
# ChaoZhouBus (高校潮州同乡会大巴系统) 生产级极轻量 Dockerfile
# 采用 Alpine 多阶段构建，原生编译 better-sqlite3 C++ 扩展，最终镜像 < 150MB
# ═════════════════════════════════════════════════════════════════════

# Stage 1: 构建阶段（安装原生编译工具，编译 TS 为 JS）
FROM node:20-alpine AS builder

WORKDIR /app

# 安装 better-sqlite3 原生编译所需的工具链
RUN apk add --no-cache python3 make g++

COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci

COPY server/ ./
RUN npm run build && npm prune --omit=dev

# Stage 2: 生产运行阶段（纯净无编译依赖环境）
FROM node:20-alpine AS runner

WORKDIR /app/server

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV SQLITE_DB_PATH=data/chaozhoubus.db

# 拷贝构建好的 node_modules (含编译后的 better-sqlite3 .node 模块) 和编译输出 dist
COPY --from=builder /app/server/package*.json ./
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist

# 创建持久化数据库和备份目录
RUN mkdir -p data/backups

EXPOSE 3000

# 使用生产脚本启动已编译的 JS
CMD ["node", "dist/src/index.js"]
