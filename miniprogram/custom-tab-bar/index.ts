// custom-tab-bar/index.ts — 自绘底部导航
// 改用自绘的原因：原生 tabBar 在真机上背景色被系统强制为白，无法贴合沙米底色（#F5F0E1）。
// 自绘后背景/样式完全可控，真机与开发工具表现一致。纯文字风格，沿用原 tabBar 配置。
Component({
  data: {
    selected: 0,
    color: '#B0AAA2',          // 未选中文字（沿用原 tabBar color）
    selectedColor: '#7A9E7E',  // 选中文字（沿用原 selectedColor）
    list: [
      { pagePath: '/pages/home/home', text: '今日' },
      { pagePath: '/pages/projects/projects', text: '项目' },
      { pagePath: '/pages/review/review', text: '复盘' },
    ],
  },
  methods: {
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const idx = Number(e.currentTarget.dataset.index);
      const url = this.data.list[idx].pagePath;
      wx.switchTab({ url });
    },
  },
});
