# ChaoZhouBus — 项目需求与系统架构说明书（Single Source of Truth）

> **文档定位**：本文档是“**高校同乡会大巴智能选座购票小程序系统（ChaoZhouBus）**”的唯一需求与架构事实源（SSOT）。
> 融合了初始工程方案（会话 `1dc41f6d-58f1-4971-ba73-4eabca45bde5`）与已锁定的**极致轻量化架构决策（`D-001=A` ~ `D-004=A`）**。后续所有后端接口、数据库表、小程序页面与自动化测试均以此文档为基准，严禁需求漂移。

---

## 一、 项目背景与核心目标

专为**高校潮州同乡会/校友会寒暑假及节假日包车返乡**场景设计。解决传统群接龙/问卷收款导致的“选座冲突、人工对账繁琐、退票改签混乱、发车检票效率低”四大痛点。

### 5 大刚性交付目标
1. **50 人瞬时并发选座零超卖**：支持定时开票，50+ 人同时抢同一座位时 100% 串行排他，零超卖、零部分锁定。
2. **固定 53 座大巴车模与配额管控**：还原真实大巴物理排布（`01`、`02` 默认预留，对外发售 `03~53` 共 51 座），单人单班次限购 2 座（须实名绑定姓名、手机号、学号）。
3. **多校区上车点与多下车点联动**：支持按时序选择上车校区（如：大学城校区 08:00、本部正门 08:40）与返乡下车站点（如：潮州体育馆、潮州客运总站）。
4. **300 秒双超时对齐 + 阶梯退票席位自愈**：未支付满 300 秒自动释放座位；发车前支持按阶梯费率自动退票，退票成功后座位毫秒级变白回流售票池。
5. **标准 A4 打印级检票名册导出**：管理员可一键导出按**上车站点分块、座位号升序**排列的 Excel 检票签到表。

---

## 二、 极致轻量化系统架构（已锁定 `D-001=A`）

摒弃传统笨重的 `MySQL 8.0 + Redis 7.0` 双服务架构，采用**单进程 Node.js + SQLite 3 (WAL 模式) 同步排他事务**实现零外部中间件依赖：

| 层级 | 技术选型 | 架构职责与替换原由 |
| :--- | :--- | :--- |
| **客户端（C 端 + 管理端）** | 微信原生小程序（TypeScript + WXML + WXSS） | 提供 53 座可视化网格选座、本地时间戳倒计时、电子乘车凭单、管理员开线与名册导出 |
| **服务端框架** | Node.js 20+ + TypeScript 5 (`strict: true`) + Fastify + `zod` | 轻量高吞吐 REST API，前后端共用一套 TypeScript 类型定义 |
| **持久化数据库** | **SQLite 3 (`better-sqlite3`，开启 `WAL` 模式)** | 替代 MySQL 8.0。单文件存储（`server/data/chaozhou_bus.db`），内存占用 `< 50MB`，支持完整 ACID 事务与外键约束 |
| **并发排他锁与 TTL 释放** | **`db.transaction(...).immediate()` + `locked_until` 惰性过期** | 替代 Redis 7.0 Lua。利用 Node 单线程 + `better-sqlite3` 同步事务（单次耗时 `~0.1ms`）天然串行处理并发抢座；通过 `locked_until < nowMs` 时间戳比对实现 300 秒零延迟释放，服务重启不丢锁 |
| **支付与报表** | 微信支付 APIv3（含本地沙箱/模拟支付模式）+ `exceljs` | 支持真实 JSAPI 微信支付/退款，同时内置开发态一键模拟支付闭环；`exceljs` 生成 A4 打印名册 |

---

## 三、 核心业务规则与系统不变性（Invariants）

### 1. 50 并发原子排他锁与批量一致性
- **多座原子性（填补原方案单座 Lua 漏洞）**：单微信用户（`openid`）单班次最多购买 **2 座**。当用户同时选 2 个座位（如 `["03", "04"]`）时，必须在同一个 `db.transaction(...).immediate()` 同步事务内完成：
  1. 统计该用户在该班次已锁定（未过期）+ 已购座位数 `current_quota`；若 `current_quota + seat_numbers.length > 2`，整单拒绝（错误码：`QUOTA_EXCEEDED`）。
  2. 检查所选全部座位是否均满足 `status = 0 OR (status = 1 AND locked_until < :nowMs)`；**只要有任意 1 个座位被他人锁定或已售出，整单立即回滚**（错误码：`SEAT_UNAVAILABLE`），绝不产生部分锁定。
  3. 将所选座位状态统一更新为 `1 (LOCKED)`，写入 `locked_by_openid`、`order_id` 及 `locked_until = nowMs + 300_000`。
  4. 插入 `orders` 待支付订单记录（`status = 0`）。

### 2. 双重超时对齐与迟到支付防资损（Dual-Timeout Guard）
- **双 300 秒对齐**：座位锁有效期 `locked_until` 严格设为 `now + 300s`（5 分钟）；调用微信支付统一下单接口传入的 `time_expire` 严格设为 `now + 300s`。
- **惰性过期释放**：查询座位图（`GET /seat-map`）和抢座（`POST /lock-and-pay`）时，凡是 `status = 1 AND locked_until < nowMs` 的座位，一律在 SQL 层直接视为空闲可选（`status = 0`），并由后台轻量定时器顺手清理超时未付订单为 `3 (CANCELLED)`。
- **卡单边界竞态保护**：若极端情况下微信支付成功回调（Webhook）在第 301 秒到达，且该座位已被另一名同学抢走支付，系统检测到座位当前归属冲突后，自动将该笔迟到订单标记为 `EXPIRED_REFUNDING` 并触发全额原路退款，严防一女二嫁。

### 3. 固定 53 座大巴车模规范
- **物理排布**：
  - 第 1~12 排（`01` ~ `48` 号）：标准 `2 + 2` 双侧过道布局（左窗、左廊 | 过道 | 右廊、右窗）。
  - 第 13 排车尾（`49` ~ `53` 号）：车尾 `5 连座` 布局。
- **默认领队预留席位**：创建班次初始化 53 个座位时，**`01` 号、`02` 号默认设为 `status = 3 (RESERVED)`**（领队/随车安全员/应急席位），普通同学不可选；管理员可在后台动态调整预留座。
- **实际可售席位**：默认对外发售 `03` 至 `53` 号共 **51 个席位**。

### 4. 阶梯退票与席位自愈（Tiered Refund & Self-Healing）
以班次始发时间 `departure_time` 与当前申请退票时间 `now` 的差值（`hours_before_departure`）为准（具体比例支持在班次 `refund_rules` JSON 中由管理员自定义，默认规则如下）：
- **距离发车 $\ge 48$ 小时**：扣除 **5%** 手续费，退还 **95%** 票款；
- **$24$ 小时 $\le$ 距离发车 $< 48$ 小时**：扣除 **20%** 违约金，退还 **80%** 票款；
- **距离发车 $< 24$ 小时**：**严禁线上退票**（接口直接拦截返回 `REFUND_WINDOW_CLOSED`），小程序弹窗提示联系同乡会领队进行线下名额转让。
- **席位毫秒级自愈**：退款确认后，在同一数据库事务中将订单状态更新为 `2 (REFUNDED)`，并将 `schedule_seats` 对应座位重置为 `0 (AVAILABLE)`，清空 `locked_by_openid`、`locked_until` 与 `order_id`，同时释放该用户的限购配额。

### 5. 前端削峰与交互防抖
- **禁轮询本地倒计时**：定时开票前及锁座后 300 秒支付倒计时期间，小程序仅在进入页面时获取一次服务端基准时间 `server_time_ms`，倒计时完全由本地定时器计算，**严禁每秒轮询后端**。
- **防抖保护**：点击“确认选座并支付”按钮后，立即禁用按钮 1.5 秒并展示 Loading 态，防止连续连点产生重复请求。

---

## 四、 数据库设计（SQLite 3 WAL DDL）

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 1. 返乡乘车意向收集表 (intentions)
CREATE TABLE IF NOT EXISTS intentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT NOT NULL,                      -- 用户微信 OpenID
  student_name TEXT NOT NULL,                -- 填报学生姓名
  phone TEXT NOT NULL,                       -- 联系手机号 (11位)
  departure_campus TEXT NOT NULL,            -- 出发校区
  destination TEXT NOT NULL,                 -- 目的地/期望下车点
  travel_date TEXT NOT NULL,                 -- 期望出发日期 (YYYY-MM-DD)
  luggage_count INTEGER NOT NULL DEFAULT 1,  -- 行李箱件数
  created_at INTEGER NOT NULL                -- 创建时间戳 (ms)
);
CREATE INDEX IF NOT EXISTS idx_intentions_route_date
  ON intentions (departure_campus, destination, travel_date);

-- 2. 正式大巴班次表 (schedules)
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_name TEXT NOT NULL,                  -- 路线名称，如：大学城/本部 -> 潮州体育馆
  departure_time INTEGER NOT NULL,           -- 始发站发车时间戳 (ms)
  open_booking_time INTEGER NOT NULL,        -- 定时开票抢座时间戳 (ms)
  price_in_cents INTEGER NOT NULL,           -- 单座票价(分)，如 10500 表示 105.00 元
  total_seats INTEGER NOT NULL DEFAULT 53,   -- 固定总座位数 (53)
  pickup_stations TEXT NOT NULL,             -- JSON 数组: ["大学城正门(08:00)", "本部东门(08:40)"]
  dropoff_stations TEXT NOT NULL,            -- JSON 数组: ["潮州高速口", "潮州体育馆"]
  refund_rules TEXT NOT NULL,                -- JSON: {"tier1_hours":48,"tier1_fee_pct":5,"tier2_hours":24,"tier2_fee_pct":20}
  status INTEGER NOT NULL DEFAULT 0,         -- 0:未开售, 1:售票中, 2:已售罄, 3:已发车
  created_at INTEGER NOT NULL
);

-- 3. 班次席位明细表 (schedule_seats)
CREATE TABLE IF NOT EXISTS schedule_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  seat_number TEXT NOT NULL,                 -- 两位编号：'01' 至 '53'
  status INTEGER NOT NULL DEFAULT 0,         -- 0:空闲可选, 1:锁定待付, 2:已售出, 3:领队预留
  locked_by_openid TEXT DEFAULT NULL,        -- 当前锁定/购票人 OpenID
  locked_until INTEGER DEFAULT NULL,         -- 锁座过期时间戳 (ms)，用于 300s 惰性过期判定
  order_id TEXT DEFAULT NULL,                -- 关联订单号
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  UNIQUE (schedule_id, seat_number)
);
CREATE INDEX IF NOT EXISTS idx_seats_schedule_status
  ON schedule_seats (schedule_id, status);

-- 4. 交易订单主表 (orders)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,                       -- 商户订单号 out_trade_no (如 ORD20260926xxxx)
  schedule_id INTEGER NOT NULL,
  openid TEXT NOT NULL,
  pickup_station TEXT NOT NULL,              -- 选定上车站点
  dropoff_station TEXT NOT NULL,             -- 选定下车站点
  total_amount INTEGER NOT NULL,             -- 订单实付总金额 (分)
  refund_amount INTEGER NOT NULL DEFAULT 0,  -- 累计退款金额 (分)
   refund_fee INTEGER NOT NULL DEFAULT 0,     -- 退票扣除手续费 (分)
  transaction_id TEXT DEFAULT NULL,          -- 微信支付流水号
  refund_id TEXT DEFAULT NULL,               -- 微信退款单号
  status INTEGER NOT NULL DEFAULT 0,         -- 0:待支付, 1:已出票, 2:已退款, 3:已超时取消
  passenger_info TEXT NOT NULL,              -- JSON: [{"seat_number":"03","name":"张三","phone":"13800000000","student_id":"2023001","luggage_count":1}]
  locked_until INTEGER NOT NULL,             -- 订单支付截止时间戳 (ms) = created_at + 300_000
  paid_at INTEGER DEFAULT NULL,
  refunded_at INTEGER DEFAULT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_openid ON orders (openid);
CREATE INDEX IF NOT EXISTS idx_orders_schedule_status ON orders (schedule_id, status);
```

---

## 五、 服务端核心 API 契约

| 序号 | 接口路径与方法 | 角色 | 核心功能说明 |
| :--- | :--- | :---: | :--- |
| 1 | `POST /api/v1/intentions` | 学生端 | 提交返乡乘车意向（姓名、手机、校区、目的地、期望日期、行李数） |
| 2 | `GET /api/v1/schedules` | 公共 | 获取班次列表及各班次余票数、服务器当前时间戳 `server_time_ms` |
| 3 | `GET /api/v1/schedules/:id/seat-map` | 学生端 | 获取 53 座实时状态图（自动将 `status=1 AND locked_until < now` 映射为 `0 可选`） |
| 4 | `POST /api/v1/orders/lock-and-pay` | 学生端 | **核心**：排他事务校验配额与座位 -> 锁座 300s -> 创建待付单 -> 返回微信支付参数 |
| 5 | `POST /api/v1/pay/wx-notify` | 微信回调/沙箱 | 验签解密 -> 幂等校验 -> 校验座位归属 -> 更新订单为 `1 (已出票)`、座位为 `2 (已售出)` |
| 6 | `GET /api/v1/orders` & `GET /api/v1/orders/:id` | 学生端 | 查询个人订单列表、电子乘车凭单详情与锁座剩余支付秒数 |
| 7 | `POST /api/v1/orders/:id/refund` | 学生端 | 校验 `< 24h` 限制 -> 计算阶梯手续费 -> 执行退款并在同事务内重置座位为 `0`、归还配额 |
| 8 | `POST /api/v1/admin/schedules` | 管理端 | 管理员创建新班次（自动生成 01~53 号座位，其中 01、02 默认设为 `3 领队预留`） |
| 9 | `PATCH /api/v1/admin/schedules/:id/seats` | 管理端 | 管理员手动调整预留座（切换 `0 可选` 与 `3 领队预留`） |
| 10 | `GET /api/v1/admin/schedules/:id/dashboard` | 管理端 | 实时售票大盘统计（已售、锁定中、空余、各站点上车人数汇总、意向转化率） |
| 11 | `GET /api/v1/admin/schedules/:id/export` | 管理端 | **导出标准 A4 打印级检票名册 Excel**（按 `pickup_station` 分块，块内按 `seat_number ASC` 升序，含 `[座位号, 姓名, 手机号, 学号, 预选下车点, 行李件数, 领队核验签到栏]`） |

---

## 六、 小程序端四大核心页面规范

1. **`/pages/index/index`（首页：返乡意向登记 & 班次列表）**
   - 顶部展示“返乡包车意向收集卡片”（快速填报出发校区、下车点、日期与行李数）；
   - 下方展示已发布的正式大巴班次卡片（发车时间、途经校区、票价、实时剩余座位数、开票本地倒计时或“立即选座”入口）。
2. **`/pages/bus/seat-select/index`（53 座大巴可视化选座 & 抢票页）**
   - 顶部图例区分：`0 空闲可选（白底）`、`1 已选（主题色）`、`2 锁定/已售（灰/红不可点）`、`3 领队预留（蓝标 01/02）`；
   - 中部还原 **1~12 排 `2+2` 过道车厢 + 第 13 排 `5 连座` 车尾**；
   - 底部联动表单：选择上车点、下车点，动态根据所选座位数（1~2 座）展开对应乘车人实名信息输入框（姓名、手机、学号、行李件数），带 1.5s 防抖提交按钮。
3. **`/pages/order/detail/index`（电子乘车凭单 & 阶梯退票页）**
   - 待支付状态：显示精确到秒的 **300 秒本地倒计时** 与“立即微信支付 / 取消订单”按钮；
   - 已出票状态：展示大字号**电子乘车凭单**（车次、上车站点与时间、醒目座位号、乘车人信息、核验二维码/凭单码），底部提供实时计算手续费提示的**阶梯申请退票**按钮。
4. **`/pages/admin/dashboard/index`（同乡会管理员工作台）**
   - 意向汇总热力榜（辅助决定开几辆车、停哪几个校区）；
   - 一键发布新班次表单（自定义路线、发车时间、开票时间、票价、上下车站点数组、退票费率）；
   - 实时售票大盘与**一键导出 A4 Excel 检票签到名册**。

---

## 七、 验收测试标准（Done Criteria Matrix）

代码交付必须通过以下自动化验证（位于 `server/src/**/*.test.ts`）：
1. **50 并发抢同一席位断言**：50 个并发请求同抢 `03` 号座，断言恰好 `1` 个成功返回待付单，其余 `49` 个返回 `SEAT_UNAVAILABLE`，数据库无脏数据。
2. **多座原子回滚断言**：用户同时抢 `["05", "06"]` 且 `06` 已被占，断言整单报错且 `05` 保持 `0 (AVAILABLE)`。
3. **单人 2 座限购配额断言**：同一 `openid` 累计选座超过 2 座时被精准拦截，退票或锁座超时后配额自动恢复。
4. **300 秒超时惰性释放断言**：`t0` 锁定 `04` 号座不付款，`t0 + 301s` 另一用户查询座位图显示 `04` 为空闲，且可直接抢座成功。
5. **阶梯退票与席位自愈断言**：分别在距发车 `50h`（扣 5%）、`30h`（扣 20%）、`12h`（拦截报错）验证退票计算；退票成功后对应座位状态立即恢复为 `0`。
6. **A4 检票名册导出断言**：验证生成的 Excel 工作簿按 `pickup_station` 分组、组内按 `seat_number` 升序排列，7 列字段完整无缺失。
