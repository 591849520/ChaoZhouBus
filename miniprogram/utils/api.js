/**
 * 统一 REST API 请求（自动解包后端 { code: 0, data } 结构）与 Excel 检票名册下载预览工具
 */
function request(method, path, data) {
  const app = getApp();
  const baseUrl = (app && app.globalData && app.globalData.apiBaseUrl) || 'http://localhost:3000';
  const openid = (app && app.globalData && app.globalData.openid) || 'wx_student_01';
  const adminToken =
    (app && app.globalData && app.globalData.adminToken) ||
    'chaozhou_admin_dev_token_change_in_prod';

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method,
      data,
      header: {
        'content-type': 'application/json',
        'x-wx-openid': openid,
        'x-admin-token': adminToken,
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = res.data;
          if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
            if (payload.code === 0) {
              resolve(payload.data);
            } else {
              reject(new Error(payload.message || '业务请求失败'));
            }
            return;
          }
          resolve(payload);
        } else {
          const msg = (res.data && res.data.message) || `请求失败 (${res.statusCode})`;
          reject(new Error(msg));
        }
      },
      fail(err) {
        reject(
          new Error(
            `无法连接本地服务端 (${baseUrl})，请确认已运行 cd server && npm run dev。详情: ${err.errMsg}`
          )
        );
      },
    });
  });
}

/**
 * 下载并在微信内直接打开双 Sheet A4 检票名册 Excel（返回 Promise，支持右上角转发到微信群）
 */
function downloadAndOpenRosterExcel(scheduleId) {
  const app = getApp();
  const baseUrl = (app && app.globalData && app.globalData.apiBaseUrl) || 'http://localhost:3000';
  const adminToken =
    (app && app.globalData && app.globalData.adminToken) ||
    'chaozhou_admin_dev_token_change_in_prod';
  const url = `${baseUrl}/api/v1/admin/schedules/${scheduleId}/export?admin_token=${encodeURIComponent(adminToken)}`;

  return new Promise((resolve, reject) => {
    wx.showLoading({ title: '正在生成名册...' });
    wx.downloadFile({
      url,
      header: { 'x-admin-token': adminToken },
      success(res) {
        wx.hideLoading();
        if (res.statusCode === 200) {
          wx.openDocument({
            filePath: res.tempFilePath,
            fileType: 'xlsx',
            showMenu: true,
            success() {
              resolve(res.tempFilePath);
            },
            fail() {
              wx.showModal({
                title: '导出成功',
                content: `Excel 检票名册已下载至临时目录：${res.tempFilePath}（真机微信内可直接打开并转发至领队群）`,
                showCancel: false,
                complete() {
                  resolve(res.tempFilePath);
                },
              });
            },
          });
        } else {
          reject(new Error(`导出名册失败 (${res.statusCode})`));
        }
      },
      fail(err) {
        wx.hideLoading();
        reject(new Error((err && err.errMsg) || '下载失败，请检查服务端'));
      },
    });
  });
}

module.exports = {
  get: (path, data) => request('GET', path, data),
  post: (path, data) => request('POST', path, data),
  patch: (path, data) => request('PATCH', path, data),
  downloadAndOpenRosterExcel,
};
