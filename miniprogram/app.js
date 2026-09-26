App({
  globalData: {
    apiBaseUrl: 'http://localhost:3000',
    openid: 'wx_student_01',
    adminToken: 'chaozhou_admin_dev_token_change_in_prod',
    testUsers: [
      { label: '学生A (陈晓潮)', value: 'wx_student_01', name: '陈晓潮', phone: '13800138001' },
      { label: '学生B (林韩江)', value: 'wx_student_02', name: '林韩江', phone: '13800138002' },
      { label: '学生C (许湘桥)', value: 'wx_student_03', name: '许湘桥', phone: '13800138003' }
    ]
  },

  onLaunch() {
    const savedOpenid = wx.getStorageSync('czbus_openid')
    if (savedOpenid) {
      this.globalData.openid = savedOpenid
    }
  },

  getCurrentUser() {
    const found = this.globalData.testUsers.find((u) => u.value === this.globalData.openid)
    return found || this.globalData.testUsers[0]
  },

  setOpenid(newOpenid) {
    this.globalData.openid = newOpenid
    wx.setStorageSync('czbus_openid', newOpenid)
  }
})
