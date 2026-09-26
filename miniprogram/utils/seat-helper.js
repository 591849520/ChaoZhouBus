/**
 * 53 座大巴车厢物理排布、倒计时与阶梯退票计算纯函数工具模块
 * 前后端同构复用，支持自动化单测验证
 */

/**
 * 将后端返回的 53 座一维数组转换为：
 * - standardRows: 第 1~12 排（01~48号），每排为 { rowIndex, rowNumber, left: [左窗, 左廊], right: [右廊, 右窗] }
 * - backRow: 第 13 排车尾 5 连座（49~53号）
 */
function build53SeatLayout(seats, selectedSeatNumbers) {
  const selectedSet = new Set(selectedSeatNumbers || []);
  const mapByNo = new Map();

  for (const s of seats || []) {
    const isSelected = selectedSet.has(s.seat_number);
    const visualState =
      s.status === 3
        ? 'reserved'
        : s.status === 2
          ? 'sold'
          : s.status === 1
            ? 'locked'
            : isSelected
              ? 'selected'
              : 'available';

    mapByNo.set(s.seat_number, {
      seat_number: s.seat_number,
      status: s.status,
      isSelected,
      visualState,
      cssClass: `seat--${visualState}`,
      label:
        s.status === 3
          ? '留座'
          : s.status === 2
            ? '已售'
            : s.status === 1
              ? '锁定'
              : isSelected
                ? '✓已选'
                : '可选',
    });
  }

  function getSeatItem(num) {
    const no = String(num).padStart(2, '0');
    const visualState = selectedSet.has(no) ? 'selected' : 'available';
    return (
      mapByNo.get(no) || {
        seat_number: no,
        status: 0,
        isSelected: selectedSet.has(no),
        visualState,
        cssClass: `seat--${visualState}`,
        label: selectedSet.has(no) ? '✓已选' : '可选',
      }
    );
  }

  const standardRows = [];
  for (let r = 0; r < 12; r++) {
    const base = r * 4;
    standardRows.push({
      rowIndex: r + 1,
      rowNumber: r + 1,
      left: [getSeatItem(base + 1), getSeatItem(base + 2)],
      right: [getSeatItem(base + 3), getSeatItem(base + 4)],
    });
  }

  const backRow = [
    getSeatItem(49),
    getSeatItem(50),
    getSeatItem(51),
    getSeatItem(52),
    getSeatItem(53),
  ];

  return {
    standardRows,
    backRow,
  };
}

/**
 * 将剩余秒数格式化为 mm:ss（用于 300s 锁座自动关单倒计时）
 */
function formatCountdownMMSS(seconds) {
  const safeSec = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = String(Math.floor(safeSec / 60)).padStart(2, '0');
  const ss = String(safeSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * 格式化 ISO 字符串或秒/毫秒时间戳为 YYYY-MM-DD HH:mm
 */
function formatDateTime(input) {
  if (!input) return '-';
  let ms = typeof input === 'string' && Number.isNaN(Number(input))
    ? new Date(input).getTime()
    : Number(input);
  if (ms > 0 && ms < 1e11) {
    ms *= 1000;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(input);
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mo}-${dd} ${hh}:${mi}`;
}

/**
 * 预计算阶梯退票手续费与可退金额（供前端弹窗确认展示）
 */
function previewTieredRefund(totalAmountCents, departureInput, nowMs, refundRules) {
  const rules = refundRules || {
    tier1_hours: 48,
    tier1_fee_pct: 5,
    tier2_hours: 24,
    tier2_fee_pct: 20,
  };
  const departureMs =
    typeof departureInput === 'string' && Number.isNaN(Number(departureInput))
      ? new Date(departureInput).getTime()
      : Number(departureInput);
  const currentMs = nowMs !== undefined ? Number(nowMs) : Date.now();
  const hoursLeft = (departureMs - currentMs) / (1000 * 3600);

  if (hoursLeft < rules.tier2_hours) {
    const tierLabel = `距发车不足 ${rules.tier2_hours}h（剩余 ${Math.max(0, hoursLeft).toFixed(1)}h），已禁止线上退票`;
    return {
      allowed: false,
      hoursLeft: Number(hoursLeft.toFixed(1)),
      feePct: 100,
      feeRate: 1,
      feeYuan: '0.00',
      refundYuan: '0.00',
      tierLabel,
      reason: tierLabel,
    };
  }

  const feePct = hoursLeft >= rules.tier1_hours ? rules.tier1_fee_pct : rules.tier2_fee_pct;
  const feeRate = feePct / 100;
  const feeCents = Math.round((Number(totalAmountCents) * feePct) / 100);
  const refundCents = Number(totalAmountCents) - feeCents;
  const tierLabel =
    hoursLeft >= rules.tier1_hours
      ? `距发车 ≥48h（剩余 ${hoursLeft.toFixed(1)}h）· 扣 5% 手续费`
      : `距发车 24h~48h（剩余 ${hoursLeft.toFixed(1)}h）· 扣 20% 手续费`;

  return {
    allowed: true,
    hoursLeft: Number(hoursLeft.toFixed(1)),
    feePct,
    feeRate,
    feeYuan: (feeCents / 100).toFixed(2),
    refundYuan: (refundCents / 100).toFixed(2),
    tierLabel,
    reason: `${tierLabel}，扣除 ¥${(feeCents / 100).toFixed(2)}，预计实退 ¥${(refundCents / 100).toFixed(2)}`,
  };
}

module.exports = {
  build53SeatLayout,
  formatCountdownMMSS,
  formatDateTime,
  previewTieredRefund,
};
