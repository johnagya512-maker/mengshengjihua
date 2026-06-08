// pages/projects/projects.ts — 项目圆环 + 任务点流（纯展示：项目由任务自动归类产生）
import { api } from '../../utils/api';

Page({
  data: {
    projects: [] as Project[],
    activeId: '',                // 展开的项目
    activeGroups: [] as any[],   // 展开项目的任务分组（大事归组 + 独立任务）
    loading: true,
  },

  onShow() { this.load(); },

  async load() {
    try {
      const r = await api.listProjects();
      const projects = r.projects.map((p) => ({
        ...p,
        percent: p.total_tasks ? Math.round((p.completed_tasks / p.total_tasks) * 100) : 0,
      }));
      this.setData({ projects, loading: false });
      this.drawRings(projects);
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  // Canvas 圆环绘制
  drawRings(projects: any[]) {
    projects.forEach((p) => {
      const q = wx.createSelectorQuery();
      q.select(`#ring-${p.project_id}`).fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0]) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        const size = res[0].width;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        ctx.scale(dpr, dpr);
        const cx = size / 2, cy = size / 2, r = size / 2 - 8;
        ctx.clearRect(0, 0, size, size);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.stroke();
        const end = -Math.PI / 2 + (p.percent / 100) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, end);
        ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.strokeStyle = p.color; ctx.stroke();
      });
    });
  },

  toggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (this.data.activeId === id) { this.setData({ activeId: '', activeGroups: [] }); return; }
    const p: any = this.data.projects.find((x) => x.project_id === id);
    this.setData({ activeId: id, activeGroups: p?.groups || [] });
  },

  // 长按项目卡 → 确认删除（连带删除该项目下任务）
  confirmDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const p: any = this.data.projects.find((x) => x.project_id === id);
    if (!p) return;
    wx.showModal({
      title: '删除项目',
      content: `删除「${p.name}」？项目下的任务会一并删除，不可恢复。`,
      confirmText: '删除',
      confirmColor: '#E05A4F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteProject(id);
          wx.showToast({ title: '已删除', icon: 'none' });
          this.setData({ activeId: '', activeGroups: [] });
          this.load();
        } catch (err: any) {
          wx.showToast({ title: err.msg || '删除失败', icon: 'none' });
        }
      },
    });
  },
});
