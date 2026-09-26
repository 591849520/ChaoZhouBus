const DEFAULT_PROFILES = [
  {
    label: '学生A (陈晓潮)',
    openid: 'wx_student_01',
    value: 'wx_student_01',
    name: '陈晓潮',
    phone: '13800138001',
  },
  {
    label: '学生B (林韩江)',
    openid: 'wx_student_02',
    value: 'wx_student_02',
    name: '林韩江',
    phone: '13800138002',
  },
  {
    label: '学生C (许湘桥)',
    openid: 'wx_student_03',
    value: 'wx_student_03',
    name: '许湘桥',
    phone: '13800138003',
  },
];

App({
  globalData: {
    apiBaseUrl: 'http://localhost:3000',
    openid: 'wx_student_01',
    adminToken: 'chaozhou_admin_dev_token_change_in_prod',
    studentProfiles: DEFAULT_PROFILES,
    testUsers: DEFAULT_PROFILES,
    currentUser: DEFAULT_PROFILES[0],
  },

  onLaunch() {
    const savedOpenid = wx.getStorageSync('czbus_openid');
    if (savedOpenid) {
      this.switchStudentProfile(savedOpenid);
    }
  },

  getCurrentUser() {
    const found = this.globalData.studentProfiles.find(
      (u) => u.openid === this.globalData.openid
    );
    return found || this.globalData.studentProfiles[0];
  },

  switchStudentProfile(newOpenid) {
    const found =
      this.globalData.studentProfiles.find((u) => u.openid === newOpenid) ||
      this.globalData.studentProfiles[0];
    this.globalData.openid = found.openid;
    this.globalData.currentUser = found;
    try {
      wx.setStorageSync('czbus_openid', found.openid);
    } catch (_err) {
      // 忽略本地缓存异常
    }
    return found;
  },

  setOpenid(newOpenid) {
    return this.switchStudentProfile(newOpenid);
  },
});
