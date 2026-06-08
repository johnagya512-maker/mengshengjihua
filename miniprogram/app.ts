// app.ts — 全局入口
import { getToken } from './utils/auth';

App<IAppOption>({
  globalData: {
    userId: '',
    isNewUser: false,
    profileReady: false,
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      env: 'sonice-d3g2fm0ex2d185044',
      traceUser: true,
    });
    // 预热本地登录态
    const token = getToken();
    if (token) {
      this.globalData.userId = wx.getStorageSync('user_id') || '';
    }
  },
});
