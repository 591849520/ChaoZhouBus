const api = require('../../../utils/api');
const seatHelper = require('../../../utils/seat-helper');

Page({
  data: {
    scheduleId: 0,
    schedule: null,
    formattedDepartureTime: '',
    unitPriceYuan: '0',
    seats: [],
    standardRows: [],
    backRow: [],
    myActiveOrder: null,
    remainingQuota: 2,
    pickupTabOptions: [],
    dropoffTabOptions: [],
    selectedList: [], // [{ seat_number, passenger_name, passenger_phone, pickup_station, dropoff_station }]
    selectedSeatsText: '',
    totalAmountYuan: '0',
    submittingLock: false,
  },

  onLoad(options) {
    const scheduleId = Number(options.scheduleId || 1);
    this.setData({ scheduleId });
    this.loadScheduleDetail();
  },

  onShow() {
    if (this.data.scheduleId) {
      this.loadScheduleDetail();
    }
  },

  async loadScheduleDetail() {
    try {
      const [seatMapData, ordersRes] = await Promise.all([
        api.get(`/api/v1/schedules/${this.data.scheduleId}/seat-map`),
        api.get('/api/v1/orders').catch(() => ({ orders: [] })),
      ]);

      const schedule = {
        id: seatMapData.schedule_id,
        title: seatMapData.route_name,
        route_name: seatMapData.route_name,
        departure_time: seatMapData.departure_time,
        unit_price_cents: seatMapData.price_in_cents,
        price_in_cents: seatMapData.price_in_cents,
        pickup_stations: seatMapData.pickup_stations || [],
        dropoff_stations: seatMapData.dropoff_stations || [],
        refund_rules: seatMapData.refund_rules,
      };
      const seats = seatMapData.seats || [];

      // 查找当前用户在该班次下的有效订单（status 0=PENDING_PAY 或 1=PAID）
      const activeOrders = ((ordersRes && ordersRes.orders) || []).filter(
        (o) => o.schedule_id === this.data.scheduleId && (o.status === 0 || o.status === 1)
      );
      const occupiedByMe = activeOrders.reduce(
        (sum, o) => sum + ((o.passengers && o.passengers.length) || 0),
        0
      );
      const firstActive = activeOrders[0] || null;
      const myActiveOrder = firstActive
        ? {
            order_id: firstActive.id,
            status: firstActive.status === 1 ? 'PAID' : 'PENDING_PAYMENT',
            items: firstActive.passengers || [],
          }
        : null;
      const remainingQuota = Math.max(0, 2 - occupiedByMe);

      const pickupTabOptions = (schedule.pickup_stations || []).map((s) => ({
        label: s,
        value: s,
      }));
      const dropoffTabOptions = (schedule.dropoff_stations || []).map((s) => ({
        label: s,
        value: s,
      }));

      // 过滤掉已经被他人抢走的已选座位
      const availableMap = new Map();
      seats.forEach((s) => {
        if (s.status === 0) availableMap.set(s.seat_number, true);
      });
      const validSelected = this.data.selectedList.filter((item) =>
        availableMap.get(item.seat_number)
      );

      this.setData(
        {
          schedule,
          formattedDepartureTime: seatHelper.formatDateTime(schedule.departure_time),
          unitPriceYuan: (Number(schedule.price_in_cents || 0) / 100).toFixed(0),
          seats,
          myActiveOrder,
          remainingQuota,
          pickupTabOptions,
          dropoffTabOptions,
        },
        () => {
          this.updateSelectionState(validSelected);
        }
      );
    } catch (err) {
      wx.showToast({
        title: err.message || '班次座位加载失败',
        icon: 'none',
      });
    }
  },

  updateSelectionState(nextSelectedList) {
    const selectedNumbers = nextSelectedList.map((item) => item.seat_number);
    const layout = seatHelper.build53SeatLayout(this.data.seats, selectedNumbers);
    const unitPriceCents = this.data.schedule ? Number(this.data.schedule.price_in_cents || 0) : 0;
    const totalAmountYuan = ((unitPriceCents * nextSelectedList.length) / 100).toFixed(0);

    this.setData({
      selectedList: nextSelectedList,
      selectedSeatsText: selectedNumbers.join('、'),
      totalAmountYuan,
      standardRows: layout.standardRows,
      backRow: layout.backRow,
    });
  },

  handleSeatSelect(e) {
    const { seatNumber, status } = e.detail;
    const currentList = [...this.data.selectedList];
    const existingIdx = currentList.findIndex((item) => item.seat_number === seatNumber);

    // 若已选中，再次点击取消选中
    if (existingIdx >= 0) {
      currentList.splice(existingIdx, 1);
      this.updateSelectionState(currentList);
      return;
    }

    // 非可选状态提示
    if (status === 3) {
      wx.showToast({ title: `${seatNumber}号为同乡会领队留座`, icon: 'none' });
      return;
    }
    if (status === 1) {
      wx.showToast({ title: `${seatNumber}号正被其他学友锁定支付中`, icon: 'none' });
      return;
    }
    if (status === 2) {
      wx.showToast({ title: `${seatNumber}号座位已售出`, icon: 'none' });
      return;
    }

    // 配额校验（单人单班次限购 2 座）
    if (currentList.length >= this.data.remainingQuota) {
      wx.showToast({
        title:
          this.data.remainingQuota === 0
            ? '您在该班次已达 2 座购票上限'
            : `单人限购 2 座，您还可再选 ${this.data.remainingQuota} 座`,
        icon: 'none',
      });
      return;
    }

    const app = getApp();
    const currentUser =
      (app && typeof app.getCurrentUser === 'function' && app.getCurrentUser()) || {};
    const defaultPickup =
      (this.data.pickupTabOptions[0] && this.data.pickupTabOptions[0].value) || '';
    const defaultDropoff =
      (this.data.dropoffTabOptions[0] && this.data.dropoffTabOptions[0].value) || '';

    // 第一个选中座位自动带入当前登录学友姓名与手机号，减少重复输入
    const isFirstSeat = currentList.length === 0;
    currentList.push({
      seat_number: seatNumber,
      passenger_name: isFirstSeat ? currentUser.name || '' : '',
      passenger_phone: isFirstSeat ? currentUser.phone || '' : '',
      pickup_station: defaultPickup,
      dropoff_station: defaultDropoff,
    });

    this.updateSelectionState(currentList);
  },

  onPassengerNameInput(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({
      [`selectedList[${idx}].passenger_name`]: e.detail.value,
    });
  },

  onPassengerPhoneInput(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({
      [`selectedList[${idx}].passenger_phone`]: e.detail.value,
    });
  },

  onPassengerPickupChange(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({
      [`selectedList[${idx}].pickup_station`]: e.detail.value,
    });
  },

  onPassengerDropoffChange(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({
      [`selectedList[${idx}].dropoff_station`]: e.detail.value,
    });
  },

  goToExistingOrder() {
    if (!this.data.myActiveOrder) return;
    wx.navigateTo({
      url: `/pages/order/detail/index?orderId=${this.data.myActiveOrder.order_id}`,
    });
  },

  async handleSubmitLock() {
    const items = this.data.selectedList;
    if (items.length === 0) return;

    for (const item of items) {
      if (!item.passenger_name || !item.passenger_name.trim()) {
        wx.showToast({ title: `请填写 ${item.seat_number} 号座乘车人姓名`, icon: 'none' });
        return;
      }
      if (!/^1\d{10}$/.test(item.passenger_phone || '')) {
        wx.showToast({ title: `请填写 ${item.seat_number} 号座 11 位手机号`, icon: 'none' });
        return;
      }
    }

    this.setData({ submittingLock: true });
    try {
      const firstItem = items[0];
      const res = await api.post('/api/v1/orders/lock-and-pay', {
        schedule_id: this.data.scheduleId,
        pickup_station: firstItem.pickup_station,
        dropoff_station: firstItem.dropoff_station,
        passengers: items.map((item) => ({
          seat_number: item.seat_number,
          name: item.passenger_name.trim(),
          phone: item.passenger_phone.trim(),
        })),
      });

      const orderId = res.orderId || res.order_id;
      wx.showToast({
        title: '锁座成功，请在300秒内支付',
        icon: 'success',
      });

      wx.redirectTo({
        url: `/pages/order/detail/index?orderId=${orderId}`,
      });
    } catch (err) {
      // 若遇 409 座位冲突，立即自动重刷座位图高亮提示
      wx.showModal({
        title: '抢座提示',
        content: err.message || '手慢一步，所选座位刚被其他学友抢先锁定，请重选其他座位',
        showCancel: false,
        confirmText: '重新选座',
        success: () => {
          this.loadScheduleDetail();
        },
      });
    } finally {
      this.setData({ submittingLock: false });
    }
  },
});
