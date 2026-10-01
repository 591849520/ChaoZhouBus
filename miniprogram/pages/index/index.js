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
    const currentProfile =
      (app && typeof app.getCurrentUser === 'function' && app.getCurrentUser()) ||
      profiles[0] ||
      {};
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
      const [schedulesRes, ordersRes] = await Promise.all([
        api.get('/api/v1/schedules'),
        api.get('/api/v1/orders').catch(() => ({ orders: [] })),
      ]);

      const rawList = schedulesRes.schedules || [];
      const myOrders = (ordersRes && ordersRes.orders) || [];
      let activeBanner = null;

      // 优先查找当前用户的待支付(status===0)或已支付(status===1)有效订单
      const activeOrdersBySchedule = new Map();
      for (const ord of myOrders) {
        if (ord.status === 0 || ord.status === 1) {
          if (!activeOrdersBySchedule.has(ord.schedule_id)) {
            activeOrdersBySchedule.set(ord.schedule_id, ord);
          }
          if (!activeBanner) {
            const seatStr = (ord.passengers || []).map((p) => p.seat_number).join('、');
            if (ord.status === 0) {
              activeBanner = {
                orderId: ord.id,
                variant: 'warning',
                title: `⏳ 待支付订单（座位 ${seatStr}）`,
                description: '席位为您保留 300 秒，请尽快完成微信支付，超时将自动释放',
              };
            } else if (ord.status === 1) {
              activeBanner = {
                orderId: ord.id,
                variant: 'success',
                title: `🎫 已出票（${ord.route_name} · 座位 ${seatStr}）`,
                description: '上车时请出示电子乘车凭单或 6 位检票码供领队核验',
              };
            }
          }
        }
      }

      const enriched = rawList.map((item) => {
        const myOrder = activeOrdersBySchedule.get(item.id) || null;
        const priceCents = Number(item.price_in_cents || item.unit_price_cents || 0);
        const remainingSeats =
          item.available_seats !== undefined
            ? Number(item.available_seats)
            : Number(item.remaining_seats || 0);

        return {
          ...item,
          title: item.route_name || item.title || '潮州同乡会大巴专车',
          remaining_seats: remainingSeats,
          formattedDepartureTime: seatHelper.formatDateTime(item.departure_time),
          priceYuan: (priceCents / 100).toFixed(0),
          pickupText: (item.pickup_stations || []).join(' / '),
          dropoffText: (item.dropoff_stations || []).join(' / '),
          myOrderId: myOrder ? myOrder.id : '',
        };
      });

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
    const scheduleId =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.scheduleId) ||
      (e && e.detail && (e.detail.scheduleId || e.detail['schedule-id'])) ||
      (this.data.schedules && this.data.schedules[0] && this.data.schedules[0].id) ||
      1;
    wx.navigateTo({
      url: `/pages/bus/seat-select/index?scheduleId=${scheduleId}`,
    });
  },

  handleViewMyOrder(e) {
    const orderId =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderId) ||
      (e && e.detail && (e.detail.orderId || e.detail['order-id']));
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expected_date || '')) {
      wx.showToast({ title: '日期格式需为 YYYY-MM-DD', icon: 'none' });
      return;
    }

    const profile = this.data.currentProfile || {};
    const studentName = profile.name || '同乡学友';
    const phone = /^1\d{10}$/.test(profile.phone || '') ? profile.phone : '13800138001';

    this.setData({ submittingIntention: true });
    try {
      await api.post('/api/v1/intentions', {
        student_name: studentName,
        phone,
        departure_campus: form.preferred_pickup_station,
        destination: form.preferred_dropoff_station,
        travel_date: form.expected_date,
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
