// pages/guide/guide.ts — 引导页 / 微信一键登录
import { api } from '../../utils/api';
import { setAuth, isLoggedIn } from '../../utils/auth';

Page({
  data: { loading: false },

  onLoad() {
    if (isLoggedIn()) this.go();
  },

  async onLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      await new Promise<void>((res, rej) =>
        wx.login({ success: () => res(), fail: () => rej() })
      );
      const r = await api.login();
      setAuth(r.token, r.user_id);
      const app = getApp<IAppOption>();
      app.globalData.userId = r.user_id;
      // 无引导：登录后一律进主界面，默认 Profile 已由云端静默写入
      this.go();
    } catch (e) {
      wx.showToast({ title: '网络开小差了，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  go() {
    wx.reLaunch({ url: '/pages/home/home' });
  },

  // 隐私政策：优先用微信平台配置的隐私协议，不可用时降级提示
  openPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: () => wx.showToast({ title: '请在小程序后台配置隐私协议', icon: 'none' }),
      });
    } else {
      wx.showToast({ title: '隐私协议即将上线', icon: 'none' });
    }
  },
});
