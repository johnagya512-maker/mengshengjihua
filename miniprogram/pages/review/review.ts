// pages/review/review.ts — 本周复盘：把已有数据呈现出来（方向 v1.1 §4）
import { api } from '../../utils/api';
import { isLoggedIn } from '../../utils/auth';
import { reviewHeadline, skipInsight, biasInsight } from '../../utils/coach';

const REASON_LABEL: Record<string, string> = {
  没状态: '没状态', 等待外部: '等待外部', 临时取消: '临时取消',
};

Page({
  data: {
    loading: true,
    empty: false,
    headline: '',
    doneCount: 0,
    distribution: [] as Array<ReviewDistItem & { width: number }>,
    skipRows: [] as Array<{ reason: string; count: number; width: number }>,
    skipTotal: 0,
    skipInsight: '',
    biasInsight: '',
    biasRatio: 0,
    biasSample: 0,
  },

  onShow() {
    if (!isLoggedIn()) { wx.reLaunch({ url: '/pages/guide/guide' }); return; }
    this.load();
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
      this.setData({
        loading: false,
        empty: r.done_count === 0 && r.skip_total === 0,
        headline: reviewHeadline(r.done_count, r.top_project?.name || ''),
        doneCount: r.done_count,
        distribution,
        skipRows,
        skipTotal: r.skip_total,
        skipInsight: skipInsight(r.skip_counts),
        biasInsight: biasInsight(r.duration_bias.ratio, r.duration_bias.sample),
        biasRatio: r.duration_bias.ratio,
        biasSample: r.duration_bias.sample,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },
});
