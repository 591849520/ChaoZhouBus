import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';
import { appConfig } from '../config/env.js';

const requireCjs = createRequire(import.meta.url);
const seatHelperPath = path.resolve(
  process.cwd(),
  '../miniprogram/utils/seat-helper.js'
);
const seatHelper = requireCjs(seatHelperPath) as {
  build53SeatLayout: (
    seats: Array<{ seat_number: string; status: number }>,
    selectedSeatNumbers: string[]
  ) => {
    standardRows: Array<{
      rowIndex: number;
      left: Array<{ seat_number: string; cssClass: string; label: string }>;
      right: Array<{ seat_number: string; cssClass: string; label: string }>;
    }>;
    backRow: Array<{ seat_number: string; cssClass: string; label: string }>;
  };
  formatCountdownMMSS: (remainingSeconds: number) => string;
  previewTieredRefund: (
    totalAmountCents: number,
    departureIsoString: string | number,
    nowMs: number
  ) => {
    allowed: boolean;
    feeRate: number;
    feeYuan: string;
    refundYuan: string;
    tierLabel: string;
  };
};

// 1. 验证 53 座大巴网格构建逻辑（12排 2+2 双侧 + 第13排 5连座）
const mockSeats = Array.from({ length: 53 }, (_, idx) => {
  const seatNumber = String(idx + 1).padStart(2, '0');
  return {
    seat_number: seatNumber,
    status: seatNumber === '01' || seatNumber === '02' ? 3 : 0,
  };
});

const layout = seatHelper.build53SeatLayout(mockSeats, ['03', '53']);
assert.equal(layout.standardRows.length, 12, 'Should have 12 standard 2+2 rows (seats 01-48)');
assert.equal(layout.backRow.length, 5, 'Should have 5 seats in the 13th back row (seats 49-53)');
assert.equal(layout.standardRows[0]?.left[0]?.seat_number, '01');
assert.equal(layout.standardRows[0]?.left[0]?.cssClass, 'seat--reserved');
assert.equal(layout.standardRows[0]?.right[0]?.seat_number, '03');
assert.equal(layout.standardRows[0]?.right[0]?.cssClass, 'seat--selected');
assert.equal(layout.backRow[4]?.seat_number, '53');
assert.equal(layout.backRow[4]?.cssClass, 'seat--selected');

// 2. 验证 300s 倒计时格式化逻辑
assert.equal(seatHelper.formatCountdownMMSS(300), '05:00');
assert.equal(seatHelper.formatCountdownMMSS(65), '01:05');
assert.equal(seatHelper.formatCountdownMMSS(0), '00:00');
assert.equal(seatHelper.formatCountdownMMSS(-15), '00:00');

// 3. 验证前端阶梯退票预览算法（>=48h 5%，24h~48h 20%，<24h 禁止）
const departureIso = '2026-10-05T10:00:00+08:00';
const departureMs = new Date(departureIso).getTime();

const tier5 = seatHelper.previewTieredRefund(10000, departureIso, departureMs - 50 * 3600 * 1000);
assert.equal(tier5.allowed, true);
assert.equal(tier5.feeRate, 0.05);
assert.equal(tier5.feeYuan, '5.00');
assert.equal(tier5.refundYuan, '95.00');

const tier20 = seatHelper.previewTieredRefund(10000, departureIso, departureMs - 30 * 3600 * 1000);
assert.equal(tier20.allowed, true);
assert.equal(tier20.feeRate, 0.2);
assert.equal(tier20.feeYuan, '20.00');
assert.equal(tier20.refundYuan, '80.00');

const tierBlocked = seatHelper.previewTieredRefund(
  10000,
  departureIso,
  departureMs - 12 * 3600 * 1000
);
assert.equal(tierBlocked.allowed, false);

// 4. 验证 shadcn/ui 小程序组件库注册完备性与所有页面 API 路径 /api/v1/ 规范性
const miniprogramRoot = path.resolve(process.cwd(), '../miniprogram');
const appJson = JSON.parse(
  fs.readFileSync(path.join(miniprogramRoot, 'app.json'), 'utf8')
) as {
  pages: string[];
  usingComponents: Record<string, string>;
};

assert.equal(appJson.pages.length, 4, 'Should register all 4 business pages');
const expectedComponents = [
  'ui-button',
  'ui-input',
  'ui-card',
  'ui-badge',
  'ui-tabs',
  'ui-alert',
  'bus-seat-grid',
];
for (const compName of expectedComponents) {
  assert.ok(
    compName in appJson.usingComponents,
    `Global usingComponents should register ${compName}`
  );
}

for (const pageRel of appJson.pages) {
  const pageJsPath = path.join(miniprogramRoot, `${pageRel}.js`);
  const jsSource = fs.readFileSync(pageJsPath, 'utf8');
  const apiCallRegex = /api\.(?:get|post|patch)\(\s*['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = apiCallRegex.exec(jsSource)) !== null) {
    const endpoint = match[1] ?? '';
    assert.ok(
      endpoint.startsWith('/api/v1/'),
      `Page ${pageRel}.js called non-v1 endpoint: ${endpoint}`
    );
  }
}

// 5. 前后端端到端契约回归测试（模拟小程序各页面真实 Payload 打入 Fastify app.inject）
async function runContractIntegrationTest() {
  const db = new Database(':memory:');
  const { app } = buildApp({ db, config: appConfig });
  const adminHeaders = {
    'x-admin-token': appConfig.adminSecretToken,
    'x-wx-openid': 'wx_student_01',
  };

  try {
    // 5.1 管理端发布班次 (pages/admin/dashboard/index.js)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/schedules',
      headers: adminHeaders,
      payload: {
        route_name: '2026国庆潮州返乡专车（大学城线）',
        departure_time: Date.now() + 72 * 3600 * 1000,
        open_booking_time: Date.now() - 60_000,
        price_in_cents: 6500,
        pickup_stations: ['大学城南站B口', '五山地铁站B1口'],
        dropoff_stations: ['潮州人民广场', '湘桥西湖公园'],
        reserved_seat_numbers: ['01', '02'],
      },
    });
    assert.equal(createRes.statusCode, 200);
    const scheduleId = (createRes.json() as { data: { schedule_id: number } }).data.schedule_id;

    // 5.2 首页提交返乡意向 (pages/index/index.js)
    const intentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/intentions',
      headers: adminHeaders,
      payload: {
        student_name: '陈晓潮',
        phone: '13800138001',
        departure_campus: '大学城南站B口',
        destination: '潮州人民广场',
        travel_date: '2026-10-01',
      },
    });
    assert.equal(intentRes.statusCode, 200);

    // 5.3 选座页原子锁座下单 (pages/bus/seat-select/index.js)
    const lockRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/lock-and-pay',
      headers: adminHeaders,
      payload: {
        schedule_id: scheduleId,
        pickup_station: '大学城南站B口',
        dropoff_station: '潮州人民广场',
        passengers: [
          { seat_number: '03', name: '陈晓潮', phone: '13800138001' },
        ],
      },
    });
    assert.equal(lockRes.statusCode, 200);
    const orderId = (lockRes.json() as { data: { orderId: string } }).data.orderId;
    assert.ok(orderId, 'Should return orderId for navigation to order detail page');

    // 5.4 订单详情页模拟微信支付 (pages/order/detail/index.js)
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/v1/pay/wx-notify',
      headers: adminHeaders,
      payload: {
        order_id: orderId,
        transaction_id: '420000202609260001',
      },
    });
    assert.equal(payRes.statusCode, 200);

    // 5.5 查询订单详情获取 6 位检票码并执行领队核验 (pages/admin/dashboard/index.js)
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}`,
      headers: adminHeaders,
    });
    assert.equal(detailRes.statusCode, 200);
    const detailData = (
      detailRes.json() as {
        data: {
          status: number;
          passengers: Array<{ seat_number: string; check_in_code: string }>;
        };
      }
    ).data;
    assert.equal(detailData.status, 1, 'Order status should be 1 (PAID)');
    const checkInCode = detailData.passengers[0]?.check_in_code;
    assert.ok(checkInCode && /^\d{6}$/.test(checkInCode), 'Should generate 6-digit check_in_code');

    const checkInRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/schedules/${scheduleId}/check-in`,
      headers: adminHeaders,
      payload: {
        check_in_code: checkInCode,
        checked_in: true,
      },
    });
    assert.equal(checkInRes.statusCode, 200);

    // 5.6 订单详情页申请阶梯退票 (pages/order/detail/index.js)
    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/refund`,
      headers: adminHeaders,
      payload: {},
    });
    assert.equal(refundRes.statusCode, 200);
  } finally {
    await app.close();
    db.close();
  }
}

await runContractIntegrationTest();
console.log(
  '✓ miniprogram-layout.test.ts: All 53-seat layout, countdown, refund preview, shadcn/ui component, and Frontend<->Backend /api/v1 contract integration tests passed.'
);
