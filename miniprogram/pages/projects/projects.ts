// pages/projects/projects.ts — 项目圆环 + 任务点流（纯展示：项目由任务自动归类产生）
import { api } from '../../utils/api';

Page({
  data: {
    projects: [] as Project[],
    activeId: '',                // 展开的项目
    activeGroups: [] as any[],   // 展开项目的任务分组（大事归组 + 独立任务）
    loading: true,
    // 新建项目面板
    showCreate: false,
    newName: '',
    newMode: 'count' as ProjectMode,   // count / streak / result
    newGoal: '',                       // count 目标件数 / result 目标数值
    newQuota: '',                      // streak 每日标准
    newUnit: '',                       // result 单位
    // 项目内加任务面板
    addingId: '',                      // 正在加任务的项目 id（空=未展开输入）
    addAction: '',
    addRepeat: false,                  // 是否每日重复
  },

  onShow() { this.load(); },

  async load() {
    try {
      const r = await api.listProjects();
      const projects = r.projects.map((p) => {
        // result：进度 = current_value/goal_target；count：completed/goal_target（回退 total_tasks）
        let percent = 0;
        if (p.mode === 'result') {
          percent = p.goal_target ? Math.min(100, Math.round(((p.current_value || 0) / p.goal_target) * 100)) : 0;
        } else {
          const denom = (p.mode === 'count' || !p.mode) && p.goal_target ? p.goal_target : p.total_tasks;
          percent = denom ? Math.min(100, Math.round((p.completed_tasks / denom) * 100)) : 0;
        }
        return { ...p, percent };
      });
      this.setData({ projects, loading: false });
      this.drawRings(projects.filter((p) => p.mode === 'count' || !p.mode));
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
    if (this.data.activeId === id) { this.setData({ activeId: '', activeGroups: [], addingId: '' }); return; }
    const p: any = this.data.projects.find((x) => x.project_id === id);
    this.setData({ activeId: id, activeGroups: p?.groups || [], addingId: '' });
  },

  // ---- 项目内加任务（一键同步今日清单）----
  openAdd(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ addingId: id, addAction: '', addRepeat: false });
  },
  closeAdd() { this.setData({ addingId: '' }); },
  onAddInput(e: WechatMiniprogram.Input) { this.setData({ addAction: e.detail.value }); },
  onRepeatToggle(e: WechatMiniprogram.SwitchChange) { this.setData({ addRepeat: e.detail.value }); },

  async submitAdd() {
    const action = this.data.addAction.trim();
    if (!action) return wx.showToast({ title: '写点要做的事', icon: 'none' });
    const p: any = this.data.projects.find((x) => x.project_id === this.data.addingId);
    if (!p) return;
    try {
      await api.saveTask({
        action, duration: 30, project_tag: p.name, vision_statement: '',
        ...(this.data.addRepeat ? { repeat: 'daily' } : {}),
      });
      this.setData({ addingId: '' });
      wx.showToast({ title: this.data.addRepeat ? '已加，每天进清单' : '已加进今日清单', icon: 'none', duration: 1500 });
      this.load();
    } catch (err: any) {
      wx.showToast({ title: err.msg || '添加失败', icon: 'none' });
    }
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

  // ---- result 模式：记一笔 ----
  recordValue(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const p: any = this.data.projects.find((x) => x.project_id === id);
    if (!p) return;
    wx.showModal({
      title: `记一笔 · ${p.name}`,
      editable: true,
      placeholderText: `本次增加多少${p.goal_unit || ''}（减少填负数）`,
      success: async (res) => {
        if (!res.confirm) return;
        const delta = Number((res.content || '').trim());
        if (!delta) return wx.showToast({ title: '填个有效数值', icon: 'none' });
        try {
          await api.recordValue(id, delta);
          wx.showToast({ title: '已记一笔', icon: 'success' });
          this.load();
        } catch (err: any) {
          wx.showToast({ title: err.msg || '记录失败', icon: 'none' });
        }
      },
    });
  },

  // ---- 新建项目 ----
  openCreate() {
    this.setData({ showCreate: true, newName: '', newMode: 'count', newGoal: '', newQuota: '', newUnit: '' });
  },
  closeCreate() { this.setData({ showCreate: false }); },
  stopPropagation() {}, // 拦截面板内点击冒泡到遮罩

  onNameInput(e: WechatMiniprogram.Input) { this.setData({ newName: e.detail.value }); },
  pickMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ newMode: e.currentTarget.dataset.mode as ProjectMode });
  },
  onGoalInput(e: WechatMiniprogram.Input) { this.setData({ newGoal: e.detail.value }); },
  onQuotaInput(e: WechatMiniprogram.Input) { this.setData({ newQuota: e.detail.value }); },
  onUnitInput(e: WechatMiniprogram.Input) { this.setData({ newUnit: e.detail.value }); },

  async submitCreate() {
    const name = this.data.newName.trim();
    if (!name) return wx.showToast({ title: '给项目起个名', icon: 'none' });
    const mode = this.data.newMode;
    const payload: any = { name, mode };
    if (mode === 'count' || mode === 'result') {
      const goal = Number(this.data.newGoal);
      if (!(goal > 0)) return wx.showToast({ title: mode === 'count' ? '填个目标件数' : '填个目标数值', icon: 'none' });
      payload.goal_target = goal;
      if (mode === 'result') { payload.goal_unit = this.data.newUnit.trim(); payload.cycle = 'month'; }
    } else if (mode === 'streak') {
      const quota = Number(this.data.newQuota) || 1; // 默认日更 1
      payload.daily_quota = quota;
    }
    try {
      await api.createProject(payload);
      this.setData({ showCreate: false });
      wx.showToast({ title: '已创建', icon: 'success' });
      this.load();
    } catch (err: any) {
      wx.showToast({ title: err.msg || '创建失败', icon: 'none' });
    }
  },
});
