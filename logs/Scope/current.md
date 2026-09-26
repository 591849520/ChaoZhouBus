# Current Scope — Phase 2：现场点名签到、A4双Sheet名册导出与12个REST API全集 (`feat/api-and-export`)

## 1. Intent（目标结果）
1. 根据用户最新确认的需求细节，移除 `student_id`（学号）与 `luggage_count`（行李件数），并在 `schedule_seats` 中新增 `checked_in_at`（签到时间戳）与 `check_in_code`（6位检票码）。
2. 实现 **现场点名/扫码签到服务** 与 **双 Sheet A4 检票名册 Excel 导出服务 (`RosterExportService`)**。
3. 实现 **Fastify 12 个完整 REST API 路由 (`server/src/app.ts`)** 及本地启动入口 (`server/src/index.ts`)，并通过全量单元测试与接口集成测试。

## 2. 验收标准 → 风险路径 → 测试文件/用例矩阵

| 验收标准 (Acceptance Criteria) | 风险路径 (Risk Path) | 测试文件与用例 |
| :--- | :--- | :--- |
| **AC-1：精简字段与座位独立签到/退票清零** | 同一订单2个座位无法独立签到，或退票后未清除 `checked_in_at` / `check_in_code` | `seat-lock.test.ts`：验证出票生成 6 位 `check_in_code`、单座独立点名/撤销、扫码核销及退票后自动重置 |
| **AC-2：双 Sheet A4 检票名册导出 (`exceljs`)** | Sheet 1 未按上车站点时序分块或未按座位号升序；手机已签到的乘客未在 Excel 中同步显示“已签到” | `roster-export.test.ts`：解析生成的 `.xlsx` Buffer，断言包含 `按上车站点检票表` 与 `01-53全车座位总表` 两个 Sheet，校验 6 列数据、分块排序与签到状态回填 |
| **AC-3：12 个 REST API 端到端闭环** | 入参未用 `zod` 校验、非管理员访问后台接口未拦截、意向统计与选座购票全链路状态不一致 | `api.test.ts`：通过 `app.inject()` 测试意向提交、班次列表、选座支付、Webhook、现场点名、Excel 导出与退票全链路 |

## 3. Done Criteria（完成标准）
- [x] `npm run typecheck`（`tsc --noEmit`）零错误。
- [x] `npm test`（包含 `seat-lock.test.ts`、`roster-export.test.ts`、`app.test.ts`）100% 通过（总耗时 860ms）。
- [x] 合入 `main` 并推送至远端 GitHub（`origin/main`）。
