const api = require('../../../utils/api');
const seatHelper = require('../../../utils/seat-helper');

Page({
  data: {
    orderId: '',
    order: null,
    schedule: null,
    formattedDepartureTime: '',
    totalAmountYuan: '0',
    refundAmountYuan: '0',
    refundFeeYuan: '0',
    statusLabel: '',
    statusBadgeVariant: 'default',
    countdownText: '05:00',
    refundPreview: {
      allowed: false,
      feeRate: 0,
      feeYuan: '0.00',
      refundYuan: '0.00',
      tierLabel: '',
    },
    paying: false,
    refunding: false,
  },

  countdownTimer: null,

  onLoad(options) {
    const orderId = String(options.orderId || '');
    this.setData({ orderId });
    this.loadOrderDetail();
  },

  onUnload() {
    this.clearLocalCountdown();
  },

  clearLocalCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  async loadOrderDetail() {
    if (!this.data.orderId) return;
    try {
      const rawOrder = await api.get(`/api/v1/orders/${this.data.orderId}`);
      const seatMapData = await api.get(`/api/v1/schedules/${rawOrder.schedule_id}/seat-map`);

      // 后端 OrderStatus 数字枚举：0=PENDING_PAY, 1=PAID, 2=REFUNDED, 3=CANCELLED, 4=EXPIRED_REFUNDING
      const statusCodeMap = {
        0: 'PENDING_PAYMENT',
        1: 'PAID',
        2: 'REFUNDED',
        3: 'EXPIRED_CANCELLED',
        4: 'REFUNDED',
      };
      const normalizedStatus =
        typeof rawOrder.status === 'number'
          ? statusCodeMap[rawOrder.status] || 'PENDING_PAYMENT'
          : rawOrder.status;

      const statusMetaMap = {
        PENDING_PAYMENT: { label: '待支付（锁座300s）', variant: 'warning' },
        PAID: { label: '已出票', variant: 'success' },
        REFUNDED: { label: '已退票', variant: 'default' },
        EXPIRED_CANCELLED: { label: '超时已关单', variant: 'destructive' },
      };
      const statusMeta = statusMetaMap[normalizedStatus] || {
        label: String(normalizedStatus),
        variant: 'default',
      };

      const rawPassengers = rawOrder.passengers || rawOrder.items || [];
      const enrichedItems = rawPassengers.map((p) => ({
        seat_number: p.seat_number,
        passenger_name: p.name || p.passenger_name,
        passenger_phone: p.phone || p.passenger_phone,
        pickup_station: rawOrder.pickup_station || p.pickup_station,
        dropoff_station: rawOrder.dropoff_station || p.dropoff_station,
        check_in_code: p.check_in_code || null,
        checked_in_at: p.checked_in_at || null,
        checkedInTimeFormatted: p.checked_in_at
          ? seatHelper.formatDateTime(p.checked_in_at)
          : '',
      }));

      const totalAmountCents = Number(
        rawOrder.total_amount !== undefined ? rawOrder.total_amount : rawOrder.total_amount_cents || 0
      );
      const refundAmountCents = Number(
        rawOrder.refund_amount !== undefined
          ? rawOrder.refund_amount
          : rawOrder.refund_amount_cents || 0
      );
      const refundFeeCents = Number(
        rawOrder.refund_fee !== undefined ? rawOrder.refund_fee : rawOrder.refund_fee_cents || 0
      );

      const schedule = {
        id: seatMapData.schedule_id,
        title: seatMapData.route_name,
        departure_time: seatMapData.departure_time,
        refund_rules: seatMapData.refund_rules,
      };

      const refundPreview = seatHelper.previewTieredRefund(
        totalAmountCents,
        schedule.departure_time,
        Date.now(),
        schedule.refund_rules
      );

      const normalizedOrder = {
        order_id: rawOrder.id || rawOrder.order_id,
        schedule_id: rawOrder.schedule_id,
        status: normalizedStatus,
        total_amount_cents: totalAmountCents,
        locked_until: rawOrder.locked_until,
        items: enrichedItems,
      };

      this.setData(
        {
          order: normalizedOrder,
          schedule,
          formattedDepartureTime: seatHelper.formatDateTime(schedule.departure_time),
          totalAmountYuan: (totalAmountCents / 100).toFixed(2),
          refundAmountYuan: (refundAmountCents / 100).toFixed(2),
          refundFeeYuan: (refundFeeCents / 100).toFixed(2),
          statusLabel: statusMeta.label,
          statusBadgeVariant: statusMeta.variant,
          refundPreview,
        },
        () => {
          if (normalizedOrder.status === 'PENDING_PAYMENT') {
            this.startLocalCountdown(normalizedOrder.locked_until);
          } else {
            this.clearLocalCountdown();
          }

          if (normalizedOrder.status === 'PAID') {
            this.drawCheckInQrCodes();
          }
        }
      );
    } catch (err) {
      wx.showToast({
        title: err.message || '订单加载失败',
        icon: 'none',
      });
    }
  },

  /**
   * 300秒纯本地 setInterval 倒计时（兼容秒或毫秒级 locked_until，零轮询，归零时刷新一次状态）
   */
  startLocalCountdown(lockedUntilInput) {
    this.clearLocalCountdown();
    const rawVal = Number(lockedUntilInput || 0);
    const lockedUntilMs = rawVal > 0 && rawVal < 1e11 ? rawVal * 1000 : rawVal;

    const tick = () => {
      const remainingSec = Math.ceil((lockedUntilMs - Date.now()) / 1000);
      this.setData({
        countdownText: seatHelper.formatCountdownMMSS(remainingSec),
      });

      if (remainingSec <= 0) {
        this.clearLocalCountdown();
        this.loadOrderDetail();
      }
    };

    tick();
    this.countdownTimer = setInterval(tick, 1000);
  },

  /**
   * 使用 Canvas 2D 绘制检票核验矩阵码图案，方便现场演示扫码检票
   */
  drawCheckInQrCodes() {
    const items = (this.data.order && this.data.order.items) || [];
    items.forEach((item) => {
      const query = this.createSelectorQuery();
      query
        .select(`#qrCanvas_${item.seat_number}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const width = res[0].width || 120;
          const height = res[0].height || 120;
          canvas.width = width;
          canvas.height = height;

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);

          // 基于检票码生成确定性 11x11 视觉矩阵 + 三个定位角标
          const grid = 11;
          const cell = width / grid;
          const seedStr = `${item.seat_number}${item.check_in_code || '888888'}`;

          for (let r = 0; r < grid; r++) {
            for (let c = 0; c < grid; c++) {
              const isFinder =
                (r < 3 && c < 3) || (r < 3 && c >= grid - 3) || (r >= grid - 3 && c < 3);
              const charCode = seedStr.charCodeAt((r * grid + c) % seedStr.length) || 49;
              const fill = isFinder || (charCode + r * 7 + c * 13) % 2 === 0;
              if (fill) {
                ctx.fillStyle = isFinder ? '#0F766E' : '#09090B';
                ctx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
              }
            }
          }
        });
    });
  },

  async handleSimulateWechatPay() {
    if (!this.data.order) return;
    this.setData({ paying: true });
    try {
      await api.post('/api/v1/pay/wx-notify', {
        order_id: this.data.order.order_id,
        transaction_id: `4200002026${Date.now()}`,
      });

      wx.showToast({
        title: '微信支付成功，已生成检票码',
        icon: 'success',
      });
      this.loadOrderDetail();
    } catch (err) {
      wx.showToast({
        title: err.message || '支付失败',
        icon: 'none',
      });
      this.loadOrderDetail();
    } finally {
      this.setData({ paying: false });
    }
  },

  handleApplyRefund() {
    const preview = this.data.refundPreview;
    if (!preview.allowed) return;

    wx.showModal({
      title: '确认申请阶梯退票？',
      content: `${preview.tierLabel}\n扣除手续费：¥${preview.feeYuan}\n预计退回金额：¥${preview.refundYuan}\n退票后座位将立即释放给其他学友。`,
      confirmColor: '#DC2626',
      confirmText: '确认退票',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ refunding: true });
        try {
          await api.post(`/api/v1/orders/${this.data.order.order_id}/refund`, {});
          wx.showToast({
            title: '退票成功，座位已释放',
            icon: 'success',
          });
          this.loadOrderDetail();
        } catch (err) {
          wx.showToast({
            title: err.message || '退票失败',
            icon: 'none',
          });
        } finally {
          this.setData({ refunding: false });
        }
      },
    });
  },

  goHome() {
    wx.reLaunch({
      url: '/pages/index/index',
    });
  },
});
