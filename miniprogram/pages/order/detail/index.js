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
      const order = await api.get(`/api/orders/${this.data.orderId}`);
      const detail = await api.get(`/api/schedules/${order.schedule_id}`);
      const schedule = detail.schedule;

      const statusMap = {
        PENDING_PAYMENT: { label: '待支付（锁座300s）', variant: 'warning' },
        PAID: { label: '已出票', variant: 'success' },
        REFUNDED: { label: '已退票', variant: 'default' },
        EXPIRED_CANCELLED: { label: '超时已关单', variant: 'destructive' },
      };
      const statusMeta = statusMap[order.status] || { label: order.status, variant: 'default' };

      const enrichedItems = (order.items || []).map((item) => ({
        ...item,
        checkedInTimeFormatted: item.checked_in_at
          ? seatHelper.formatDateTime(item.checked_in_at)
          : '',
      }));

      const refundPreview = seatHelper.previewTieredRefund(
        order.total_amount_cents,
        schedule.departure_time,
        Date.now()
      );

      this.setData(
        {
          order: {
            ...order,
            items: enrichedItems,
          },
          schedule,
          formattedDepartureTime: seatHelper.formatDateTime(schedule.departure_time),
          totalAmountYuan: (Number(order.total_amount_cents || 0) / 100).toFixed(2),
          refundAmountYuan: (Number(order.refund_amount_cents || 0) / 100).toFixed(2),
          refundFeeYuan: (Number(order.refund_fee_cents || 0) / 100).toFixed(2),
          statusLabel: statusMeta.label,
          statusBadgeVariant: statusMeta.variant,
          refundPreview,
        },
        () => {
          if (order.status === 'PENDING_PAYMENT') {
            this.startLocalCountdown(order.locked_until);
          } else {
            this.clearLocalCountdown();
          }

          if (order.status === 'PAID') {
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
   * 300秒纯本地 setInterval 倒计时（零轮询，归零时发起 1 次订单状态刷新触发服务端惰性释放）
   */
  startLocalCountdown(lockedUntilSec) {
    this.clearLocalCountdown();

    const tick = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const remaining = Number(lockedUntilSec || 0) - nowSec;
      this.setData({
        countdownText: seatHelper.formatCountdownMMSS(remaining),
      });

      if (remaining <= 0) {
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
      await api.post('/api/payments/wechat-webhook', {
        event_id: `evt_wx_${Date.now()}`,
        order_id: this.data.order.order_id,
        wechat_transaction_id: `4200002026${Date.now()}`,
        paid_amount_cents: this.data.order.total_amount_cents,
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
          await api.post(`/api/orders/${this.data.order.order_id}/refund`, {});
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
