// pages/review/review.ts — 本周复盘：把已有数据呈现出来（方向 v1.1 §4）
import { api } from '../../utils/api';
import { isLoggedIn } from '../../utils/auth';
import { reviewHeadline, skipInsight, biasInsight, todayHeadline, todayCheer, compareInsight } from '../../utils/coach';

const REASON_LABEL: Record<string, string> = {
  没状态: '没状态', 等待外部: '等待外部', 临时取消: '临时取消',
};

Page({
  data: {
    loading: true,
    empty: false,
    tab: 'today' as 'today' | 'week',  // 默认今日小结
    // 今日小结
    todayHeadline: '',
    todayCheer: '',
    todayDone: 0,
    todayMinutes: 0,
    todayActions: [] as string[],
    todayStreak: 0,
    // 周复盘
    headline: '',
    doneCount: 0,
    distribution: [] as Array<ReviewDistItem & { width: number }>,
    skipRows: [] as Array<{ reason: string; count: number; width: number }>,
    skipTotal: 0,
    skipInsight: '',
    biasInsight: '',
    biasRatio: 0,
    biasSample: 0,
    compareInsight: '',
    doneDelta: 0,
  },

  onShow() {
    if (!isLoggedIn()) { wx.reLaunch({ url: '/pages/guide/guide' }); return; }
    this.load();
  },

  switchTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ tab: e.currentTarget.dataset.tab as 'today' | 'week' });
  },

  // 生成今日小结分享卡片：canvas 画竖图 → 存相册
  shareCard() {
    if (this.data.todayDone === 0) {
      wx.showToast({ title: '今天先完成一件再来', icon: 'none' });
      return;
    }
    const q = wx.createSelectorQuery();
    q.select('#shareCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) { wx.showToast({ title: '生成失败', icon: 'none' }); return; }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo().pixelRatio;
      const W = 600, H = 800;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
      // 背景：暖色
      ctx.fillStyle = '#FBF6EF'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#C67B5C'; ctx.fillRect(0, 0, W, 12);
      // 标题
      ctx.fillStyle = '#3A352F'; ctx.font = '600 40px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('今日小结', W / 2, 110);
      // 大数字
      ctx.fillStyle = '#C67B5C'; ctx.font = '700 160px sans-serif';
      ctx.fillText(String(this.data.todayDone), W / 2, 300);
      ctx.fillStyle = '#8A8178'; ctx.font = '28px sans-serif';
      ctx.fillText(`今天完成 ${this.data.todayDone} 件 · 专注 ${this.data.todayMinutes} 分钟`, W / 2, 360);
      if (this.data.todayStreak > 0) {
        ctx.fillText(`连续行动第 ${this.data.todayStreak} 天`, W / 2, 405);
      }
      // 不画具体任务清单：任务名属隐私，分享只传递「状态」不公开「做了什么」（契合「闷声」）
      // 鼓励语 + 落款（放底部，整体上下平衡）
      ctx.fillStyle = '#8A8178'; ctx.font = '28px sans-serif';
      ctx.fillText(this.data.todayCheer, W / 2, H - 120);
      ctx.fillStyle = '#C67B5C'; ctx.font = '600 30px sans-serif';
      ctx.fillText('闷声计划', W / 2, H - 60);
      // 导出图片 → 弹微信分享菜单（可直接发好友/存图；朋友圈受微信限制需存图后手动发）
      wx.canvasToTempFilePath({
        canvas,
        success: (r) => {
          const path = r.tempFilePath;
          if (wx.showShareImageMenu) {
            wx.showShareImageMenu({
              path,
              fail: (err) => {
                // 用户取消不提示；其他失败降级为存相册
                if (String(err.errMsg).includes('cancel')) return;
                this.saveToAlbum(path);
              },
            });
          } else {
            this.saveToAlbum(path); // 旧基础库降级
          }
        },
        fail: () => wx.showToast({ title: '生成失败', icon: 'none' }),
      });
    });
  },

  // 降级：保存到相册
  saveToAlbum(filePath: string) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已存到相册，去分享吧', icon: 'none' }),
      fail: (err) => {
        if (String(err.errMsg).includes('auth')) {
          wx.showModal({ title: '需要相册权限', content: '请在设置里允许保存到相册', showCancel: false });
        }
      },
    });
  },

  async load() {
    try {
      const r = await api.reviewWeek();
      const maxCount = r.distribution.reduce((m, d) => Math.max(m, d.count), 0) || 1;
      const distribution = r.distribution.map((d) => ({ ...d, width: Math.round((d.count / maxCount) * 100) }));
      const maxSkip = Math.max(r.skip_counts.没状态, r.skip_counts.等待外部, r.skip_counts.临时取消) || 1;
      const skipRows = (['没状态', '等待外部', '临时取消'] as const).map((k) => ({
        reason: REASON_LABEL[k], count: r.skip_counts[k],
        width: Math.round((r.skip_counts[k] / maxSkip) * 100),
      }));
      const t = r.today;
      this.setData({
        loading: false,
        empty: r.done_count === 0 && r.skip_total === 0 && t.done_count === 0,
        // 今日
        todayHeadline: todayHeadline(t.done_count),
        todayCheer: todayCheer(t.done_count, t.streak_days),
        todayDone: t.done_count,
        todayMinutes: t.minutes,
        todayActions: t.actions,
        todayStreak: t.streak_days,
        // 周
        headline: reviewHeadline(r.done_count, r.top_project?.name || ''),
        doneCount: r.done_count,
        distribution,
        skipRows,
        skipTotal: r.skip_total,
        skipInsight: skipInsight(r.skip_counts),
        biasInsight: biasInsight(r.duration_bias.ratio, r.duration_bias.sample),
        biasRatio: r.duration_bias.ratio,
        biasSample: r.duration_bias.sample,
        compareInsight: compareInsight(r.compare.done_delta, r.compare.skip_delta),
        doneDelta: r.compare.done_delta,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },
});
