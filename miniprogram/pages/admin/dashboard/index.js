const api = require('../../../utils/api');

Page({
  data: {
    schedules: [],
    scheduleTabOptions: [],
    selectedScheduleId: '',
    stats: null,
    passengers: [],
    stationFilterOptions: [{ label: '全部站点', value: 'ALL' }],
    selectedPickupStation: 'ALL',
    statusFilterOptions: [
      { label: '全部乘客', value: 'false' },
      { label: '只看未到', value: 'true' },
    ],
    onlyUnchecked: 'false',
    manualCheckInCode: '',
    exportingExcel: false,
    showCreateForm: false,
    creatingSchedule: false,
    createForm: {
      title: '2026国庆潮州返乡专车（大学城线）',
      departure_time: '2026-10-01T08:30:00+08:00',
      price_yuan: '65',
    },
  },

  onLoad() {
    this.loadSchedules();
  },

  onPullDownRefresh() {
    this.loadDashboard().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadSchedules() {
    try {
      const res = await api.get('/api/v1/schedules');
      const list = res.schedules || [];
      const scheduleTabOptions = list.map((s) => ({
        label: s.route_name || s.title,
        value: String(s.id),
      }));
      const selectedScheduleId =
        this.data.selectedScheduleId || (list[0] ? String(list[0].id) : '');

      this.setData(
        {
          schedules: list,
          scheduleTabOptions,
          selectedScheduleId,
        },
        () => {
          if (selectedScheduleId) {
            this.loadDashboard();
          }
        }
      );
    } catch (err) {
      wx.showToast({ title: err.message || '班次加载失败', icon: 'none' });
    }
  },

  async loadDashboard() {
    const scheduleId = Number(this.data.selectedScheduleId);
    if (!scheduleId) return;

    try {
      const queryParts = [];
      if (this.data.selectedPickupStation && this.data.selectedPickupStation !== 'ALL') {
        queryParts.push(`pickup_station=${encodeURIComponent(this.data.selectedPickupStation)}`);
      }
      if (this.data.onlyUnchecked === 'true') {
        queryParts.push('only_unchecked=true');
      }
      const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

      const [dash, seatMapData] = await Promise.all([
        api.get(`/api/v1/admin/schedules/${scheduleId}/dashboard${qs}`),
        api.get(`/api/v1/schedules/${scheduleId}/seat-map`),
      ]);

      const pickupStations = seatMapData.pickup_stations || [];
      const stationFilterOptions = [
        { label: '全部站点', value: 'ALL' },
        ...pickupStations.map((s) => ({ label: s, value: s })),
      ];

      const stats = {
        sold_count: Number(dash.sold_count || 0),
        checked_in_count: Number(dash.checked_in_count || 0),
        unchecked_in_count: Number(
          dash.un_checked_in_count !== undefined
            ? dash.un_checked_in_count
            : dash.unchecked_in_count || 0
        ),
        available_count: Number(dash.available_count || 0),
      };

      const normalizedPassengers = (dash.passengers || []).map((p) => ({
        ...p,
        passenger_name: p.name || p.passenger_name,
        passenger_phone: p.phone || p.passenger_phone,
      }));

      this.setData({
        stats,
        passengers: normalizedPassengers,
        stationFilterOptions,
      });
    } catch (err) {
      wx.showToast({
        title: err.message || '管理大盘加载失败',
        icon: 'none',
      });
    }
  },

  handleScheduleSwitch(e) {
    this.setData(
      {
        selectedScheduleId: e.detail.value,
        selectedPickupStation: 'ALL',
      },
      () => {
        this.loadDashboard();
      }
    );
  },

  handleStationFilterChange(e) {
    this.setData({ selectedPickupStation: e.detail.value }, () => {
      this.loadDashboard();
    });
  },

  handleUncheckedFilterChange(e) {
    this.setData({ onlyUnchecked: e.detail.value }, () => {
      this.loadDashboard();
    });
  },

  onManualCodeInput(e) {
    this.setData({ manualCheckInCode: e.detail.value });
  },

  async handleVerifyByCode() {
    const code = (this.data.manualCheckInCode || '').trim();
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: '请输入 6 位数字检票码', icon: 'none' });
      return;
    }

    try {
      const res = await api.post(
        `/api/v1/admin/schedules/${this.data.selectedScheduleId}/check-in`,
        {
          check_in_code: code,
          checked_in: true,
        }
      );
      const seatNo = res.seatNumber || res.seat_number;
      const pName = res.name || res.passenger_name;
      wx.showToast({
        title: `${seatNo}座 ${pName} 检票通过`,
        icon: 'success',
      });
      this.setData({ manualCheckInCode: '' });
      this.loadDashboard();
    } catch (err) {
      wx.showToast({ title: err.message || '检票码无效', icon: 'none' });
    }
  },

  handleScanQrCode() {
    wx.scanCode({
      onlyFromCamera: false,
      success: async (scanRes) => {
        // 载荷格式：CZBUS:<scheduleId>:<seatNumber>:<6位检票码> 或直接为 6 位数字
        const raw = String(scanRes.result || '').trim();
        let code = raw;
        if (raw.startsWith('CZBUS:')) {
          const parts = raw.split(':');
          code = parts[3] || '';
        }
        if (!/^\d{6}$/.test(code)) {
          wx.showToast({ title: '无法识别的乘车二维码', icon: 'none' });
          return;
        }
        this.setData({ manualCheckInCode: code }, () => {
          this.handleVerifyByCode();
        });
      },
    });
  },

  async handleToggleCheckIn(e) {
    const seatNumber = String(e.currentTarget.dataset.seat || '');
    const currentlyChecked = e.currentTarget.dataset.checked === '1';

    try {
      await api.post(`/api/v1/admin/schedules/${this.data.selectedScheduleId}/check-in`, {
        seat_number: seatNumber,
        checked_in: !currentlyChecked,
      });
      wx.showToast({
        title: !currentlyChecked ? `${seatNumber}座已确认上车` : `${seatNumber}座已撤销签到`,
        icon: 'none',
      });
      this.loadDashboard();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  handleCallPassenger(e) {
    const phone = String(e.currentTarget.dataset.phone || '');
    if (!phone) return;
    wx.makePhoneCall({
      phoneNumber: phone,
    });
  },

  async handleExportExcel() {
    const scheduleId = Number(this.data.selectedScheduleId);
    if (!scheduleId) return;

    this.setData({ exportingExcel: true });
    try {
      await api.downloadAndOpenRosterExcel(scheduleId);
      wx.showToast({
        title: 'A4检票表已打开，可转发微信打印',
        icon: 'success',
      });
    } catch (err) {
      wx.showToast({
        title: err.message || 'Excel名册导出失败',
        icon: 'none',
      });
    } finally {
      this.setData({ exportingExcel: false });
    }
  },

  toggleCreateForm() {
    this.setData({ showCreateForm: !this.data.showCreateForm });
  },

  onCreateTitleInput(e) {
    this.setData({ 'createForm.title': e.detail.value });
  },

  onCreateTimeInput(e) {
    this.setData({ 'createForm.departure_time': e.detail.value });
  },

  onCreatePriceInput(e) {
    this.setData({ 'createForm.price_yuan': e.detail.value });
  },

  async handleCreateSchedule() {
    const form = this.data.createForm;
    const priceCents = Math.round(Number(form.price_yuan || 0) * 100);
    const departureMs = new Date(form.departure_time).getTime();
    if (!form.title || priceCents <= 0 || Number.isNaN(departureMs)) {
      wx.showToast({ title: '请填写有效的班次名称、时间与票价', icon: 'none' });
      return;
    }

    this.setData({ creatingSchedule: true });
    try {
      const res = await api.post('/api/v1/admin/schedules', {
        route_name: form.title,
        departure_time: departureMs,
        open_booking_time: Date.now() - 60_000,
        price_in_cents: priceCents,
        pickup_stations: ['大学城南站B口', '五山地铁站B1口'],
        dropoff_stations: ['潮州人民广场', '湘桥西湖公园', '潮安彩塘客运站'],
        reserved_seat_numbers: ['01', '02'],
      });
      wx.showToast({ title: '53座新班次发布成功', icon: 'success' });
      this.setData({
        showCreateForm: false,
        selectedScheduleId: String(res.schedule_id),
      });
      this.loadSchedules();
    } catch (err) {
      wx.showToast({ title: err.message || '发布失败', icon: 'none' });
    } finally {
      this.setData({ creatingSchedule: false });
    }
  },
});
