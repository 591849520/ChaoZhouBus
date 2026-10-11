# 待办与开放风险唯一事实源（Todo）

- **最后更新**：2026-10-11

## 已完成切片
- [x] **[Phase 0]** 仓库治理文件、`REQUIREMENTS.md` 与 `D-001`~`D-004` 架构决策收敛
- [x] **[Phase 1]** SQLite WAL 事务锁座引擎、50 并发防超卖、300s 惰性过期、阶梯退票与按座签到服务
- [x] **[Phase 2]** 双 Sheet A4 检票名册导出（`exceljs`）与 Fastify 全量 13 个 REST API 路由及端到端测试
- [x] **[Phase 3]** 微信小程序端（`miniprogram/`）`shadcn/ui` 组件化实现（7 个复用组件 + 4 个业务页面 + 布局与退票预览自动化单测）
- [x] **[Phase 4]** 跨层代码审查与 `/api/v1` REST 契约修复、前后端端到端契约联调回归测试
- [x] **[Phase 5]** 服务端开发与联调实时彩色控制台日志、`server/server.log` 自动追加落盘系统
- [x] **[Phase 6]** UI 组件细节修复（`<ui-card>` 副标题、`<ui-badge>` 默认插槽、`<ui-tabs>` 下标透传），合并 `main` 推送远端
- [x] **[Phase 7]** 生产级部署体系与 SQLite 在线热灾备（`deploy/` 生产 Dockerfile、docker-compose、Nginx HTTPS 与限流配置、Linux crontab 备份脚本、PM2 单实例配置、探活 `GET /health` 与备份 `POST /api/v1/admin/backup`、`backup.test.ts` 单测），用户已批准推送远端

## 待用户确认事项
- [ ] 等待用户选定下一步演进方向并下达指令。
