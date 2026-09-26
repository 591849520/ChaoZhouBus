# Current Scope — Phase 3：基于 `shadcn/ui` 设计体系的小程序组件化前端 (`feat/miniprogram`)

## 1. Intent（目标结果）
在 `feat/miniprogram` 分支上完成微信小程序前端（`miniprogram/`）开发：
1. 建立全局 `shadcn/ui` 设计令牌（Zinc + Teal CSS 变量）与 6 个通用基础组件（`<ui-button>`、`<ui-input>`、`<ui-card>`、`<ui-badge>`、`<ui-tabs>`、`<ui-alert>`）及 1 个 53 座大巴车厢领域组件（`<bus-seat-grid>`）。
2. 基于上述组件声明式组装四大核心页面（`/pages/index/index`、`/pages/bus/seat-select/index`、`/pages/order/detail/index`、`/pages/admin/dashboard/index`），消除散乱的原生按钮与输入框重复代码。
3. 编写同构算法单测 `server/src/services/miniprogram-layout.test.ts` 并通过 `npm run typecheck` 与 `npm test` 验证（验证后严格遵循铁律 8：不自动 commit/push，等待用户批准）。

## 2. 验收标准 → 风险路径 → 测试文件/用例矩阵

| 验收标准 (Acceptance Criteria) | 风险路径 (Risk Path) | 测试文件与用例 (`server/src/services/miniprogram-layout.test.ts`) |
| :--- | :--- | :--- |
| **AC-1：53 座车厢物理排布矩阵转换** | 前 12 排 `2+2` 双侧过道（01~48）或第 13 排车尾 `5 连座`（49~53）座号错位 | `test_01_build_53_seat_bus_rows_layout`：断言生成 12 排 `2+2`（左2 + 右2）+ 1 排车尾 `5 连座`，且 `01`/`02` 状态正确映射为 `RESERVED` |
| **AC-2：300s 倒计时与阶梯退票预览计算** | 负数秒未归零、分秒补零格式错误、退票阶梯（>=48h 5% / 24~48h 20% / <24h 拦截）前端提示与后端不一致 | `test_02_countdown_and_refund_preview_helper`：断言 `298s -> "04:58"`、`0s -> "00:00"` 及三档退票预估金额 |
| **AC-3：`<ui-button>` 1500ms 防抖守卫** | 高频连点触发多次下单请求 | `test_03_button_debounce_guard`：断言 1500ms 窗口内连续点击 10 次仅触发 1 次回调，窗口过后恢复可点 |

## 3. Done Criteria（完成标准）
- [ ] 7 个 `shadcn/ui` 小程序组件与 4 个业务页面创建完毕，全局 `app.json` 注册 `usingComponents`。
- [ ] `npm run typecheck` 零错误，`npm test` 全量通过。
- [ ] 展示修改与测试结果，等待用户指令后再执行 Git 提交与推送。
