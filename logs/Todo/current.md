# Current Todo — 待办与开放决策

## 1. 已关闭决策
- [x] **[D-001]** 确定 `ChaoZhouBus` 轻量化数据库、锁座机制与后端语言选型（已确认 A：Node.js + TS + `better-sqlite3` WAL + 同步排他事务锁）
- [x] **[D-002]** 确定仓库目录约定（已确认 A：`miniprogram/` + `server/` + `deploy/`）
- [x] **[D-003]** 初始化 `logs/` 工程日志体系（已确认 A）
- [x] **[D-004]** 完成 5 份规范文档去旧化改造（已确认 A 并执行完毕）

## 2. 下一阶段开发待办（待用户触发）
- [ ] **Phase 1**：初始化 `server/` 工程（`package.json`、`tsconfig.json`、SQLite WAL Schema 初始化与 53 座生成逻辑）
- [ ] **Phase 2**：实现核心选座排他事务服务（`SeatLockService`）及 50 并发抢座 + 300s 惰性超时释放单元测试
- [ ] **Phase 3**：实现阶梯退票席位自愈、微信支付 APIv3 对接与 Excel A4 检票名册导出
- [ ] **Phase 4**：初始化 `miniprogram/` 微信小程序前端页面（53 座网格选座、倒计时、电子凭单、管理后台）
