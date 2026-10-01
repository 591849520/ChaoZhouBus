# Implementation Log（只追加历史记录）

## 2026-09-26T14:30:00+08:00 — 初始化 `logs/` 工程日志与盘点旧项目拷贝文档
- **触发依据**：用户确认决策 `[D-003] = A`，并指出当前工作区中的文档是从其他项目拷贝而来，需按本项目实际技术选型改造文档。
- **事实核查**：
  - 读取 `AGENTS.md`、`CONTRIBUTING.md`、`CODE_REVIEW_GUIDE.md`、`CHANGELOG.md`、`00-coding-agent-first-law.yaml`。
  - 识别出旧项目残留：Next.js 15、React 19、MongoDB (`MongoMemoryReplSet`)、Yarn 1、550 处 ESLint 历史告警、以及 `yongtu.ai/home` 的 2664 行历史变更记录。
- **执行动作**：
  - 创建 `logs/README.md`、`logs/Scope/current.md`、`logs/Standards/current.md`、`logs/State/current.md`、`logs/Links/current.md`、`logs/Todo/current.md`、`logs/done/.gitkeep`。
- **回退方式**：移除 `logs/` 目录。

## 2026-09-26T15:00:00+08:00 — 完成 D-001=A 技术栈锁定与全套项目规范文档重写
- **触发依据**：用户确认 `[D-001] = A`（微信原生小程序 TS + Node.js TS + Fastify + `better-sqlite3` WAL + 同步排他事务锁）、`[D-002] = A`、`[D-004] = A`。
- **异常与处理**：
  - 初次写入 `CONTRIBUTING.md`、`CODE_REVIEW_GUIDE.md`、`CHANGELOG.md` 时报错 `Access is denied`，排查发现拷贝文件带有 Windows 只读属性（`-ar---`）。
  - 执行 `Get-ChildItem -File | ForEach-Object { $_.IsReadOnly = $false }` 解除只读属性后成功写入。
- **已修改文件**：
  - `AGENTS.md`：写入轻量化技术栈、4 大业务不变性（50 并发同步事务锁、300s 双超时对齐、53 座固定车模、阶梯退票自愈）、目录约定与 `npm` 自检门禁。
  - `CONTRIBUTING.md`：移除旧项目 550 处 ESLint 告警等残留，更新为零外部数据库依赖的本地开发指南。
  - `CODE_REVIEW_GUIDE.md`：移除旧项目 `MongoMemoryReplSet` 模板，替换为基于 `better-sqlite3` `:memory:` 的 50 并发抢座、多座原子回滚、301 秒惰性过期重抢测试模板。
  - `CHANGELOG.md`：清理旧项目 2664 行无关记录，重置为 `ChaoZhouBus` 0.1.0 初始变更日志。
- **回退方式**：通过备份或 Git 恢复上述 4 个 Markdown 文件。

## 2026-09-26T15:10:00+08:00 — 落盘项目唯一需求与架构说明书 `REQUIREMENTS.md`
- **触发依据**：用户提出在开发前应先将整个项目的完整需求文档落盘，防止后续开发出现目标漂移或细节遗漏。
- **执行动作**：
  - 完整提取原始架构方案（`1dc41f6d-58f1-4971-ba73-4eabca45bde5`）中的全部业务细节，结合已敲定的轻量化技术架构（`D-001=A` SQLite WAL + 同步排他事务锁），编写并创建 [REQUIREMENTS.md](../../REQUIREMENTS.md)。
  - 在 `AGENTS.md` 与 `logs/Links/current.md` 中将 `REQUIREMENTS.md` 注册为业务与接口契约的唯一事实源（SSOT）。
- **回退方式**：删除 `REQUIREMENTS.md` 并还原 `AGENTS.md` 顶部链接。

## 2026-09-26T15:25:00+08:00 — 完成 Phase 1 (`feat/server-core`) SQLite WAL 50 并发锁座引擎与阶梯退票测试验证
- **触发依据**：用户已安装好微信开发者工具，确认采用 Git (`main` + 功能分支) 模式开始正式开发。
- **执行动作**：
  - 执行 `git init -b main` 并提交文档基线（`d3ba94c`），切出功能分支 `feat/server-core`。
  - 创建 `server/` 核心代码：`src/types/domain.ts`、`src/config/env.ts`、`src/db/schema.ts`、`src/services/seat-lock.ts`、`src/services/seat-lock.test.ts`、`run-all-tests.ts`。
- **外部验证证据**：
  - 初次执行 `npm run typecheck` 检出 `seat-lock.ts(171,13)` 泛型元组参数数量不匹配（`<[string]>` -> `<[number, string, number]>`），修复后重新执行 `npm run typecheck` 退出码 `0`（零错误）。
  - 执行 `npm test`（`tsx run-all-tests.ts`）：`[✓] src/services/seat-lock.test.ts (83ms)`，覆盖 53 座初始化与预留座拦截、50 并发同抢 03 号座（1 成功 / 49 拦截）、多座部分冲突整单回滚、单人 2 座配额拦截、301 秒惰性过期重抢、微信回调幂等与迟到支付自动原路退款、阶梯退票（>=48h 5% / 24-48h 20% / <24h 拦截）及席位自愈归还配额。
- **回退方式**：`git checkout main` 或回退 `feat/server-core` 分支提交。

## 2026-09-26T16:07:00+08:00 — 完成 Phase 2 (`feat/api-and-export`) 现场点名、双 Sheet Excel 名册导出与全套 REST API
- **触发依据**：用户确认移除 `学号` 与 `行李件数`，认可按座位独立签到 (`checked_in_at`) + 6位核验码扫码检票 (`check_in_code`) + 双 Sheet Excel 名册导出方案，并指令“开始吧”。
- **执行动作**：
  - 切出 `feat/api-and-export` 分支，同步更新 `REQUIREMENTS.md`、`domain.ts`、`schema.ts`、`seat-lock.ts`。
  - 新增 `server/src/services/roster-export.ts`（基于 `exceljs` 生成 `按上车站点检票表` 与 `01-53全车座位总表` 双 Sheet 工作簿，支持手机签到状态自动回填至 Excel）及 `roster-export.test.ts`。
  - 新增 `server/src/app.ts`（13 个完整 REST API 端点，含 `zod` 入参校验与管理员鉴权）、`server/src/index.ts` 及 `server/src/app.test.ts`。
- **外部验证证据**：
  - `npm run typecheck`（`tsc --noEmit`）零错误。
  - `npm test`：`[✓] src/app.test.ts (729ms)`、`[✓] src/services/roster-export.test.ts (95ms)`、`[✓] src/services/seat-lock.test.ts (35ms)`，3 项测试套件 100% 通过（总耗时 `860ms`）。
- **回退方式**：`git reset --hard ff60d10`。

## 2026-09-26T20:54:00+08:00 — 完成 Phase 3 (`feat/miniprogram`) `shadcn/ui` 组件化微信小程序前端与自动化测试
- **触发依据**：用户指定参考 `https://ui.shadcn.com/` 构建高复用、组件化的小程序前端，并回复“批准”授权执行 Phase 3 方案。
- **执行动作**：
  - 在 `miniprogram/app.wxss` 建立 `shadcn/ui` Zinc + Teal 设计变量体系，并在 `miniprogram/app.json` 全局注册 7 个高复用组件。
  - 实现 6 个通用 UI 原语组件（`<ui-button>` 内置防抖与变体、`<ui-input>`、`<ui-card>`、`<ui-badge>`、`<ui-tabs>`、`<ui-alert>`）与 1 个领域组件（`<bus-seat-grid>` 53座双侧 2+2 及车尾 5 连座）。
  - 组合上述组件完成 4 个业务页面：`pages/index/index`（班次列表/账号切换/意向登记）、`pages/bus/seat-select/index`（53座选座/首位乘车人自动回填/1500ms防抖锁座）、`pages/order/detail/index`（300s本地零轮询倒计时/6位检票码+Canvas二维码/阶梯退票预览）、`pages/admin/dashboard/index`（实时大盘/按站点与未到过滤/一键拨号/扫码与输码核验/导出并打开双Sheet A4 Excel名册）。
  - 新增 `server/src/services/miniprogram-layout.test.ts`。
- **外部验证证据**：
  - 初测捕获 `seat-helper.js` 的 `cssClass` 与 ISO 日期兼容细节，修复后复测 `npm run typecheck` 零错误，`npm test` 4 个测试套件全部通过（`app.test.ts`、`miniprogram-layout.test.ts`、`roster-export.test.ts`、`seat-lock.test.ts`，总耗时 `843ms`）。
- **回退方式**：当前处于 `feat/miniprogram` 分支，遵循 `AGENTS.md` 铁律第 8 条未执行 `git commit` / `git push`，可通过 `git checkout main` 无损回退。

## 2026-09-26T22:47:00+08:00 — 完成跨层 Code Review 契约修复与前后端联调回归测试 (`fix/miniprogram-api-contract`)
- **触发依据**：用户指令“根据codereview审查目前的代码，看看是否存在问题”并在审阅报告后下达“修复”指令。
- **修复内容**：
  1. `miniprogram/utils/api.js`：自动解包后端 `{ code: 0, data }` 响应结构，并将 `downloadAndOpenRosterExcel` 封装为返回 `Promise`。
  2. `miniprogram/app.js`：统一 `studentProfiles`、`currentUser`、`getCurrentUser()` 与 `switchStudentProfile(openid)`，修复首页学友演示切换器。
  3. `miniprogram/pages/*` 全部 4 个页面控制器：统一对齐 `/api/v1/...` 路由前缀、锁座 Payload (`passengers: [{ seat_number, name, phone }]`)、数字状态枚举 `OrderStatus (0/1/2/3/4)`、毫秒级 `locked_until` 及管理大盘统计字段。
  4. `server/src/services/miniprogram-layout.test.ts`：新增小程序页面源码 `/api/v1/` 路径扫描断言及基于 `buildApp().app.inject()` 的前后端全链路契约联调回归测试。
- **外部验证证据**：
  - `npm run typecheck` 零错误；`npm test` 4 个测试套件全部通过（总耗时 `947ms`）。
- **回退方式**：当前修改位于 `fix/miniprogram-api-contract` 分支，等待用户指令再提交并合入 `main`。

## 2026-10-01T21:45:00+08:00 — 完成服务端直观实时彩色控制台日志与文件自动追加落盘 (`feat/server-logging`)
- **触发依据**：用户提问“启动后端之后在哪里看日志”，经批准后实现本地开发实时直观控制台日志及 `server.log` 落盘功能。
- **实现内容**：
  1. `server/src/app.ts`：在 `BuildAppOptions` 中增加 `enableLogging` 与 `logFilePath`；增加 `onRequest` 与 `onResponse` 生命周期钩子（带有时间戳、请求方式、路径、openid、状态码、响应毫秒耗时），在关键业务节点（锁座、支付回调、阶梯退票、检票核验、名册导出）打印中文业务摘要，并在 `setErrorHandler` 输出清晰的业务拦截与异常堆栈。
  2. `server/src/index.ts`：启动时启用 `enableLogging: true` 并传入 `server/server.log` 文件落盘路径，启动提示中显示日志文件位置。
  3. `.gitignore`：增加 `miniprogram/project.private.config.json` 忽略微信开发者工具私有配置。
  4. `server/src/app.test.ts`：增加第 10 步断言测试验证 `enableLogging: true` 时日志准确生成并记录。
- **外部验证证据**：
  - `npm run typecheck` 零错误；`npm test` 4 项测试套件全部通过（耗时 `1281ms`），并验证了临时测试日志文件的生成与内容。
- **回退方式**：当前分支为 `feat/server-logging`，未执行 `git commit` / `git push`，遵循 `AGENTS.md` 铁律第 8 条暂停等待用户批准。

## 2026-10-01T21:52:00+08:00 — 修复 `<ui-button>` 与 `<ui-input>` 自定义组件事件分发与参数透传 (`fix/component-event-dispatch`)
- **触发依据**：用户在微信开发者工具模拟器中点击“立即选座”无反应，排查发现 `<ui-button>` 内部只触发了 `'action'` 事件，而外部页面绑定的是 `bind:click`，导致点击未响应。
- **修复内容**：
  1. `miniprogram/components/ui/button/index.js`：点击时同时分发 `'click'` 与 `'action'`，并将 `this.dataset` 透传进 `e.detail`。
  2. `miniprogram/components/ui/input/index.js`：输入时同时分发 `'input'` 与 `'change'`，确保页面 `bind:input` 正常获取 `{ value }`。
  3. `miniprogram/pages/index/index.js` & `pages/admin/dashboard/index.js`：兼容从 `e.currentTarget.dataset`、`e.detail` 及保底数据中提取 `scheduleId`、`orderId`、`phone`、`seat`。
  4. `server/src/services/miniprogram-layout.test.ts`：增加第 4.1 步静态断言，强制保证 `ui-button` 必须分发 `click`/`action`，`ui-input` 必须分发 `input`/`change`。
- **外部验证证据**：
  - `npm run typecheck` 零错误；`npm test` 4 项测试套件全部通过（耗时 `938ms`）。
- **回退方式**：当前处于 `fix/component-event-dispatch` 分支，遵循 `AGENTS.md` 铁律第 8 条等待用户指令再执行提交与合并。

## 2026-10-01T22:18:00+08:00 — 修复 `<ui-card>` 副标题与 `<ui-badge>` 插槽文字渲染缺陷 (`fix/ui-component-slots-and-props`)
- **触发依据**：代码审查中发现 `<ui-card>` 缺少 `subtitle` 属性声明导致所有卡片副标题文字空白，以及 `<ui-badge>` 缺少 `<slot>` 导致页面插槽徽章文字未渲染。
- **修复内容**：
  1. `miniprogram/components/ui/card/index.js` & `index.wxml`：增加 `subtitle` 属性声明并在模板中渲染 `{{subtitle || description}}`。
  2. `miniprogram/components/ui/badge/index.wxml`：增加 `<slot wx:else></slot>` 支持默认插槽文字渲染。
  3. `miniprogram/components/ui/tabs/index.js`：分发 `change` 时自动合并 `this.dataset` 透传参数。
  4. `server/src/services/miniprogram-layout.test.ts`：增加第 4.2 步静态断言，强制保证 `ui-card` 声明 `subtitle`，`ui-badge` 声明 `<slot`，`ui-tabs` 声明 `this.dataset`。
- **外部验证证据**：
  - `npm run typecheck` 零错误；`npm test` 4 项测试套件全部通过（耗时 `1022ms`）。
- **回退方式**：当前处于 `fix/ui-component-slots-and-props` 分支，遵循 `AGENTS.md` 铁律第 8 条等待用户指令再执行提交与合并。


