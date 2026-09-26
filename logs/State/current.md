# Current State — 工作区与执行状态

## 1. 基线状态
- 更新时间：`2026-09-26T16:07:00+08:00`
- 当前已完成分支：`feat/server-core`、`feat/api-and-export`（均已合入 `main` 并同步至 GitHub）

## 2. 已完成切片
- [x] **Slice 1**：工程日志体系 `logs/`、项目需求唯一事实源 [REQUIREMENTS.md](../../REQUIREMENTS.md) 与规范文档初始化。
- [x] **Slice 2（Phase 1：`feat/server-core`）**：SQLite 3 (WAL) 数据表与 50 并发同步排他事务锁座、300s 惰性过期释放、阶梯退票席位自愈核心引擎。
- [x] **Slice 3（Phase 2：`feat/api-and-export`）**：
  - 按用户决策精简字段（移除 `student_id` 学号与 `luggage_count` 行李件数）。
  - 实现按座位独立现场签到 (`checked_in_at`) 与 6 位电子凭单码扫码核销 (`check_in_code`)。
  - 基于 `exceljs` 实现双 Sheet A4 检票名册导出 (`Sheet 1 按上车站点检票表` + `Sheet 2 01-53全车座位总表`)。
  - 实现 Fastify 全部 REST API 路由 (`server/src/app.ts`) 与本地服务入口 (`server/src/index.ts`)。
  - 验证证据：`npm run typecheck` 零错误；`npm test` 3 大测试套件全部通过（总耗时 `860ms`）。

## 3. 下一阶段计划（Phase 3：微信小程序前端 `feat/miniprogram`）
- 切出 `feat/miniprogram` 分支，构建微信小程序端 `miniprogram/` 目录（可直接用微信开发者工具打开预览联调）：
  1. `/pages/index/index`：返乡乘车意向登记 + 班次卡片列表与本地开票倒计时；
  2. `/pages/bus/seat-select/index`：53 座（1~12 排 `2+2` 过道 + 第 13 排 `5 连座`）可视化选座、上车/下车站点选择、姓名+手机号极简录入与 1.5s 防抖下单；
  3. `/pages/order/detail/index`：300s 待支付本地倒计时、模拟微信支付一键出票、带 6 位核验码与二维码的电子乘车凭单、阶梯退票申请；
  4. `/pages/admin/dashboard/index`：同乡会领队管理后台（开线发布、按校区/未到人员过滤的手机现场点名、一键拨打未到同学电话 `wx.makePhoneCall`、扫码检票 `wx.scanCode`、一键打开/转发 Excel 检票名册 `wx.openDocument`）。
