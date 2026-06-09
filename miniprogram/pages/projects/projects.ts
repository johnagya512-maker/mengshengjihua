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
        return { ...p, percent, initial: (p.name || '?').trim().charAt(0), auto_badges: p.auto_badges || [], achievements: p.achievements || [] };
      });
      this.setData({ projects, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  toggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (this.data.activeId === id) { this.setData({ activeId: '', activeGroups: [], addingId: '' }); return; }
    const p: any = this.data.projects.find((x) => x.project_id === id);
    this.setData({ activeId: id, activeGroups: p?.groups || [], addingId: '' });
  },

  // 点空白遮罩收起展开的卡片
  collapse() { this.setData({ activeId: '', activeGroups: [], addingId: '' }); },

  // 删除项目内的单个任务（展开区任务点的「×」）
  deleteTask(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.showModal({
      title: '删除任务',
      content: '确定删掉这件任务？今日清单里也会一并移除。',
      confirmText: '删除',
      confirmColor: '#E05A4F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteTask(id);
          wx.showToast({ title: '已删除', icon: 'none' });
          // 重载后刷新展开项目的任务点
          await this.load();
          const p: any = this.data.projects.find((x) => x.project_id === this.data.activeId);
          if (p) this.setData({ activeGroups: p.groups || [] });
        } catch (err: any) {
          wx.showToast({ title: err.msg || '删除失败', icon: 'none' });
        }
      },
    });
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
        from_project: true,
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

  // ---- 手动成就：记里程碑 / 删里程碑 ----
  addAchievement(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const p: any = this.data.projects.find((x) => x.project_id === id);
    if (!p) return;
    wx.showModal({
      title: `记一个成就 · ${p.name}`,
      editable: true,
      placeholderText: '如：这条笔记破了 10 万赞',
      success: async (res) => {
        if (!res.confirm) return;
        const text = (res.content || '').trim();
        if (!text) return wx.showToast({ title: '写点什么吧', icon: 'none' });
        try {
          await api.addAchievement(id, text);
          wx.showToast({ title: '记下了 🎉', icon: 'none' });
          this.load();
        } catch (err: any) {
          wx.showToast({ title: err.msg || '记录失败', icon: 'none' });
        }
      },
    });
  },
  deleteAchievement(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const ach = e.currentTarget.dataset.ach as string;
    if (!id || !ach) return;
    wx.showModal({
      title: '删除成就',
      content: '确定删掉这条成就？',
      confirmText: '删除',
      confirmColor: '#E05A4F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteAchievement(id, ach);
          this.load();
        } catch (err: any) {
          wx.showToast({ title: err.msg || '删除失败', icon: 'none' });
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
