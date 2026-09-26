const api = require('../../utils/api');
const seatHelper = require('../../utils/seat-helper');

Page({
  data: {
    profileTabOptions: [],
    currentProfile: {},
    schedules: [],
    activeOrderBanner: null,
    pickupOptions: [
      { label: '大学城南站B口', value: '大学城南站B口' },
      { label: '五山地铁站B1口', value: '五山地铁站B1口' },
    ],
    dropoffOptions: [
      { label: '潮州人民广场', value: '潮州人民广场' },
      { label: '湘桥西湖公园', value: '湘桥西湖公园' },
      { label: '潮安彩塘客运站', value: '潮安彩塘客运站' },
    ],
    seatCountOptions: [
      { label: '1人返乡', value: '1' },
      { label: '2人同行', value: '2' },
    ],
    intentionForm: {
      expected_date: '2026-10-01',
      preferred_pickup_station: '大学城南站B口',
      preferred_dropoff_station: '潮州人民广场',
      seat_count: '1',
    },
    submittingIntention: false,
  },

  onLoad() {
    this.initProfiles();
  },

  onShow() {
    this.initProfiles();
    this.loadSchedules();
  },

  onPullDownRefresh() {
    this.loadSchedules().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  initProfiles() {
    const app = getApp();
    const profiles = (app && app.globalData && app.globalData.studentProfiles) || [];
    const currentProfile = (app && app.globalData && app.globalData.currentUser) || profiles[0] || {};
    const profileTabOptions = profiles.map((p) => ({
      label: p.label,
      value: p.openid,
    }));
    this.setData({
      profileTabOptions,
      currentProfile,
    });
  },

  handleProfileSwitch(e) {
    const openid = e.detail.value;
    const app = getApp();
    if (app && typeof app.switchStudentProfile === 'function') {
      const nextUser = app.switchStudentProfile(openid);
      if (nextUser) {
        this.setData({ currentProfile: nextUser });
        wx.showToast({
          title: `已切换为 ${nextUser.name}`,
          icon: 'none',
        });
        this.loadSchedules();
      }
    }
  },

  async loadSchedules() {
    try {
      const res = await api.get('/api/schedules');
      const rawList = res.schedules || [];
      let activeBanner = null;

      // 并发拉取各班次下当前用户的有效订单状态
      const enriched = await Promise.all(
        rawList.map(async (item) => {
          let myOrder = null;
          try {
            const detail = await api.get(`/api/schedules/${item.id}`);
            myOrder = detail.my_active_order || null;
          } catch (_err) {
            myOrder = null;
          }

          if (myOrder && !activeBanner) {
            const seatStr = (myOrder.items || []).map((i) => i.seat_number).join('、');
            if (myOrder.status === 'PENDING_PAYMENT') {
              activeBanner = {
                orderId: myOrder.order_id,
                variant: 'warning',
                title: `⏳ 待支付订单（座位 ${seatStr}）`,
                description: '席位为您保留 300 秒，请尽快完成微信支付，超时将自动释放',
              };
            } else if (myOrder.status === 'PAID') {
              activeBanner = {
                orderId: myOrder.order_id,
                variant: 'success',
                title: `🎫 已出票（${item.title} · 座位 ${seatStr}）`,
                description: '上车时请出示电子乘车凭单或 6 位检票码供领队核验',
              };
            }
          }

          return {
            ...item,
            formattedDepartureTime: seatHelper.formatDateTime(item.departure_time),
            priceYuan: (Number(item.unit_price_cents || 0) / 100).toFixed(0),
            pickupText: (item.pickup_stations || []).join(' / '),
            dropoffText: (item.dropoff_stations || []).join(' / '),
            myOrderId: myOrder ? myOrder.order_id : '',
          };
        })
      );

      this.setData({
        schedules: enriched,
        activeOrderBanner: activeBanner,
      });
    } catch (err) {
      wx.showToast({
        title: err.message || '班次加载失败',
        icon: 'none',
      });
    }
  },

  handleSelectSeat(e) {
    const scheduleId = e.currentTarget.dataset.scheduleId;
    wx.navigateTo({
      url: `/pages/bus/seat-select/index?scheduleId=${scheduleId}`,
    });
  },

  handleViewMyOrder(e) {
    const orderId = e.currentTarget.dataset.orderId;
    if (!orderId) return;
    wx.navigateTo({
      url: `/pages/order/detail/index?orderId=${orderId}`,
    });
  },

  goToActiveOrder() {
    if (!this.data.activeOrderBanner || !this.data.activeOrderBanner.orderId) return;
    wx.navigateTo({
      url: `/pages/order/detail/index?orderId=${this.data.activeOrderBanner.orderId}`,
    });
  },

  goToAdminDashboard() {
    wx.navigateTo({
      url: '/pages/admin/dashboard/index',
    });
  },

  onIntentionDateInput(e) {
    this.setData({
      'intentionForm.expected_date': e.detail.value,
    });
  },

  onIntentionPickupChange(e) {
    this.setData({
      'intentionForm.preferred_pickup_station': e.detail.value,
    });
  },

  onIntentionDropoffChange(e) {
    this.setData({
      'intentionForm.preferred_dropoff_station': e.detail.value,
    });
  },

  onIntentionCountChange(e) {
    this.setData({
      'intentionForm.seat_count': e.detail.value,
    });
  },

  async submitIntention() {
    const form = this.data.intentionForm;
    if (!form.expected_date) {
      wx.showToast({ title: '请填写期望出发日期', icon: 'none' });
      return;
    }

    this.setData({ submittingIntention: true });
    try {
      await api.post('/api/intentions', {
        expected_date: form.expected_date,
        preferred_pickup_station: form.preferred_pickup_station,
        preferred_dropoff_station: form.preferred_dropoff_station,
        seat_count: Number(form.seat_count || 1),
      });
      wx.showToast({
        title: '意向登记成功，满45人将通知您',
        icon: 'success',
      });
    } catch (err) {
      wx.showToast({
        title: err.message || '提交失败',
        icon: 'none',
      });
    } finally {
      this.setData({ submittingIntention: false });
    }
  },
});
