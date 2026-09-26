import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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
    departureIsoString: string,
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

// 4. 验证 shadcn/ui 小程序组件库与 4 个业务页面文件完备性
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

console.log('✓ miniprogram-layout.test.ts: All 53-seat layout, countdown, refund preview, and shadcn/ui component assertions passed.');
