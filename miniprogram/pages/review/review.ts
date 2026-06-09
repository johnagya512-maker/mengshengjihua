// pages/review/review.ts — 本周复盘：把已有数据呈现出来（方向 v1.1 §4）
import { api } from '../../utils/api';
import { isLoggedIn } from '../../utils/auth';
import { reviewHeadline, skipInsight, biasInsight, todayHeadline, todayCheer, compareInsight, lifetimeHeadline } from '../../utils/coach';

const REASON_LABEL: Record<string, string> = {
  没状态: '没状态', 等待外部: '等待外部', 临时取消: '临时取消',
};

Page({
  data: {
    loading: true,
    empty: false,
    tab: 'today' as 'today' | 'week' | 'month' | 'year',
    // 渐进解锁的 tab：默认只有今日，按首次使用天数在 load() 里追加（3天解锁本周/14天本月/60天今年）
    tabs: [{ key: 'today', label: '今日' }] as Array<{ key: string; label: string }>,
    emptyTip: '这段时间还没有记录，去今日清单做一件，这里就有复盘了',
    todayHeadline: '',
    todayCheer: '',
    todayDone: 0,
    todayMinutes: 0,
    todayActions: [] as string[],
    todayStreak: 0,
    lifetime: { total_done: 0, total_minutes: 0, active_days: 0, longest_streak: 0, current_streak: 0, first_day: '' } as LifetimeStats,
    lifetimeHeadline: '',
    lifetimeHours: 0,
    monthlyTrend: [] as Array<{ month: number; count: number; minutes: number; height: number }>,
    headline: '',
    compareTitle: '环比上周',
    compareCap: '件完成 vs 上周',
    doneCount: 0,
    distribution: [] as Array<ReviewDistItem & { width: number }>,
    timeDistribution: [] as Array<{ name: string; color: string; minutes: number; width: number; label: string }>,
    skipRows: [] as Array<{ reason: string; count: number; width: number }>,
    skipTotal: 0,
    skipInsight: '',
    biasInsight: '',
    biasRatio: 0,
    biasSample: 0,
    compareInsight: '',
    doneDelta: 0,
    showCompare: false,  // 上一周期无数据时隐藏环比卡（拿空气对比没意义）
  },

  onShow() {
    if (!isLoggedIn()) { wx.reLaunch({ url: '/pages/guide/guide' }); return; }
    // 自绘 tabBar：高亮当前页（复盘=2）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.load();
  },

  switchTab(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as 'today' | 'week' | 'month' | 'year';
    this.setData({ tab, loading: true });
    this.load();
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
      // tab=today 时后端取数退回 week（今日数据所有周期都返回）；区间视图按 tab 取对应周期
      const period: ReviewPeriod = this.data.tab === 'today' ? 'week' : (this.data.tab as ReviewPeriod);
      const r = await api.reviewWeek(period);
      const maxCount = r.distribution.reduce((m, d) => Math.max(m, d.count), 0) || 1;
      const distribution = r.distribution.map((d) => ({ ...d, width: Math.round((d.count / maxCount) * 100) }));
      // 时间花费分布：条宽按最大耗时归一；时长转「Xh Ym / Ym」可读文案
      const maxMin = r.time_distribution.reduce((m, d) => Math.max(m, d.minutes), 0) || 1;
      const timeDistribution = r.time_distribution.map((d) => ({
        ...d,
        width: Math.round((d.minutes / maxMin) * 100),
        label: d.minutes >= 60 ? `${Math.floor(d.minutes / 60)}h${d.minutes % 60 ? ' ' + (d.minutes % 60) + 'm' : ''}` : `${d.minutes}m`,
      }));
      const maxSkip = Math.max(r.skip_counts.没状态, r.skip_counts.等待外部, r.skip_counts.临时取消) || 1;
      const skipRows = (['没状态', '等待外部', '临时取消'] as const).map((k) => ({
        reason: REASON_LABEL[k], count: r.skip_counts[k],
        width: Math.round((r.skip_counts[k] / maxSkip) * 100),
      }));
      const t = r.today;
      // 周期文案：empty 提示、环比标题/副标题、headline 用词
      const periodWord = period === 'month' ? '这个月' : period === 'year' ? '今年' : '本周';
      const prevWord = period === 'month' ? '上月' : period === 'year' ? '去年' : '上周';
      // 年度月度趋势：按最大件数归一成柱高（%）
      const trend = r.monthly_trend || [];
      const maxTrend = trend.reduce((m, x) => Math.max(m, x.count), 0) || 1;
      const monthlyTrend = trend.map((x) => ({ ...x, height: Math.round((x.count / maxTrend) * 100) }));
      const lt = r.lifetime;
      // 渐进解锁：按首次使用至今的天数，逐步放出更长周期的 tab
      // first_day 为空（没有任何完成记录）→ 视为第 0 天，只显示今日
      const ALL_TABS = [
        { key: 'today', label: '今日', unlockDay: 0 },
        { key: 'week', label: '本周', unlockDay: 3 },
        { key: 'month', label: '本月', unlockDay: 14 },
        { key: 'year', label: '今年', unlockDay: 60 },
      ];
      let usedDays = 0;
      if (lt.first_day) {
        const firstMs = new Date(lt.first_day + 'T00:00:00+08:00').getTime();
        usedDays = Math.floor((Date.now() - firstMs) / 86400000);
      }
      const tabs = ALL_TABS.filter((tt) => usedDays >= tt.unlockDay).map((tt) => ({ key: tt.key, label: tt.label }));
      // 当前 tab 若已超出解锁范围（理论上不会，兜底），回落到今日
      const tabKeys = tabs.map((tt) => tt.key);
      const safeTab = tabKeys.includes(this.data.tab) ? this.data.tab : 'today';
      this.setData({
        loading: false,
        tabs,
        tab: safeTab,
        empty: r.done_count === 0 && r.skip_total === 0,
        emptyTip: `${periodWord}还没有记录，去今日清单做一件，这里就有复盘了`,
        // 今日
        todayHeadline: todayHeadline(t.done_count),
        todayCheer: todayCheer(t.done_count, t.streak_days, Date.now()),
        todayDone: t.done_count,
        todayMinutes: t.minutes,
        todayActions: t.actions,
        todayStreak: t.streak_days,
        // 生涯累计常驻卡
        lifetime: lt,
        lifetimeHeadline: lifetimeHeadline(lt.total_done, lt.active_days, lt.first_day),
        lifetimeHours: Math.round(lt.total_minutes / 60),
        monthlyTrend,
        // 区间
        headline: reviewHeadline(r.done_count, r.top_project?.name || '', period),
        compareTitle: `环比${prevWord}`,
        compareCap: `件完成 vs ${prevWord}`,
        doneCount: r.done_count,
        distribution,
        timeDistribution,
        skipRows,
        skipTotal: r.skip_total,
        skipInsight: skipInsight(r.skip_counts),
        biasInsight: biasInsight(r.duration_bias.ratio, r.duration_bias.sample),
        biasRatio: r.duration_bias.ratio,
        biasSample: r.duration_bias.sample,
        compareInsight: compareInsight(r.compare.done_delta, r.compare.skip_delta, period),
        doneDelta: r.compare.done_delta,
        // 上一周期完全无记录（完成+跳过都为0）时隐藏环比：避免「环比去年 +3」这类拿空气对比
        showCompare: r.compare.last_done > 0 || r.compare.last_skip > 0,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },
});
