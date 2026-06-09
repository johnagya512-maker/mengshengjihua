// pages/focus/focus.ts — 专注计时执行页（支持单任务 / 大任务组两种模式）
import { api } from '../../utils/api';
import {
  getCachedTasks, stashComplete, cacheTasks,
  setActiveTask, clearActiveTask, getCachedCapacity,
} from '../../utils/store';
import { SKIP_REASONS } from '../../utils/constants';
import { skipReply } from '../../utils/coach';

Page({
  data: {
    task: null as Task | null,
    isGroup: false,        // 大任务组模式：对整件计时，子任务作勾选清单
    parentTaskId: '',
    parentAction: '',
    steps: [] as Array<Task & { done?: boolean }>, // 组模式的子任务
    duration: 30,          // 计划时长（分钟）
    phase: 'confirm' as 'confirm' | 'running' | 'finish',
    remainSec: 0,
    timeLabel: '00:00',
    progress: 0,           // 计时进度百分比（已过 / 计划）
    capacityTip: '',       // 与每日可投入时间的连结
    showSkip: false,
    skipReasons: SKIP_REASONS,
  },
  timer: 0 as any,
  totalSec: 0,             // 计时基数（续时间会增加），用于算进度

  onLoad(q: Record<string, string>) {
    const cached = getCachedTasks();
    if (q.parent_task_id) {
      // 大任务组：加载该 parent 下所有子任务，对整件计时
      const steps = cached.filter((t) => t.parent_task_id === q.parent_task_id);
      if (!steps.length) { wx.navigateBack(); return; }
      const total = steps[0].parent_duration || steps.reduce((s, t) => s + (t.duration || 0), 0) || 30;
      this.setData({
        isGroup: true,
        parentTaskId: q.parent_task_id,
        parentAction: steps[0].parent_action || '这件大事',
        steps: steps.map((s) => ({ ...s, done: false })),
        task: steps[0],
        duration: total,
      });
    } else {
      const task = cached.find((t) => t.task_id === q.task_id) || null;
      if (!task) { wx.navigateBack(); return; }
      this.setData({ task, duration: task.duration });
    }
    this.updateCapacityTip();
  },

  // 耗时微调 ±15min，区间 15~600
  adjust(e: WechatMiniprogram.TouchEvent) {
    const delta = Number(e.currentTarget.dataset.d);
    const next = Math.min(600, Math.max(15, this.data.duration + delta));
    this.setData({ duration: next });
    this.updateCapacityTip();
  },

  // 点中间数字手动输入精确时长（1~600 分钟）
  editDuration() {
    wx.showModal({
      title: '设置时长', editable: true, placeholderText: '输入分钟数',
      content: String(this.data.duration),
      success: (res) => {
        if (!res.confirm) return;
        const n = Math.round(Number((res.content || '').trim()));
        if (!(n > 0)) return wx.showToast({ title: '填个有效分钟数', icon: 'none' });
        this.setData({ duration: Math.min(600, n) });
        this.updateCapacityTip();
      },
    });
  },

  // 把「时长 ↔ 今日可投入时间」连结显性化
  updateCapacityTip() {
    const cap = getCachedCapacity();
    if (!cap || !cap.total) { this.setData({ capacityTip: '' }); return; }
    const remainAfter = cap.total - cap.used - this.data.duration;
    const h = Math.floor(Math.abs(remainAfter) / 60);
    const m = Math.abs(remainAfter) % 60;
    const left = h ? `${h} 小时 ${m} 分` : `${m} 分`;
    this.setData({
      capacityTip: remainAfter >= 0
        ? `这件占 ${this.data.duration} 分，今日还剩 ${left}`
        : `这件占 ${this.data.duration} 分，今日已超出 ${left}`,
    });
  },

  goBack() { wx.navigateBack(); },

  start() {
    const sec = this.data.duration * 60;
    const t = this.data.task!;
    this.totalSec = sec;
    setActiveTask({
      task_id: this.data.isGroup ? this.data.parentTaskId : t.task_id,
      action: this.data.isGroup ? this.data.parentAction : t.action,
      started_at: Date.now(), planned_duration: this.data.duration,
    });
    this.setData({ phase: 'running', remainSec: sec, timeLabel: this.fmt(sec), progress: 0 });
    this.tick();
  },

  tick() {
    this.timer = setInterval(() => {
      const r = this.data.remainSec - 1;
      if (r <= 0) {
        clearInterval(this.timer);
        this.setData({ remainSec: 0, timeLabel: '00:00', progress: 100, phase: 'finish' });
      } else {
        this.setData({ remainSec: r, timeLabel: this.fmt(r), progress: Math.round(((this.totalSec - r) / this.totalSec) * 100) });
      }
    }, 1000);
  },

  // 时间不够：续时间（+15 分钟），计时阶段可多次点
  addTime() {
    const add = 15 * 60;
    this.totalSec += add;
    const remain = this.data.remainSec + add;
    this.setData({
      remainSec: remain, timeLabel: this.fmt(remain),
      duration: this.data.duration + 15,
      progress: Math.round(((this.totalSec - remain) / this.totalSec) * 100),
    });
    wx.showToast({ title: '加了 15 分钟', icon: 'none', duration: 1000 });
  },

  // 组模式：计时中勾选子任务，即时标记完成
  toggleStep(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const steps = this.data.steps.map((s) => s.task_id === id ? { ...s, done: !s.done } : s);
    this.setData({ steps });
    const target = steps.find((s) => s.task_id === id);
    if (target && target.done) {
      api.completeTask({ task_id: id, actual_duration: 0, result: 'complete' }).catch(() => {});
    }
    // 全部勾完 → 自动进完成阶段
    if (steps.every((s) => s.done)) {
      clearInterval(this.timer);
      this.setData({ phase: 'finish' });
    }
  },

  fmt(sec: number): string {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  earlyFinish() { clearInterval(this.timer); this.setData({ phase: 'finish' }); },

  async complete() { await this.submit('complete'); },
  openSkip() { this.setData({ showSkip: true }); },
  closeSkip() { this.setData({ showSkip: false }); },
  noop() {},
  async chooseSkip(e: WechatMiniprogram.TouchEvent) {
    await this.submit('skip', e.currentTarget.dataset.r as SkipReason);
  },

  async submit(result: 'complete' | 'skip', skip_reason?: SkipReason) {
    clearActiveTask();
    if (result === 'skip' && skip_reason) {
      wx.showToast({ title: skipReply(skip_reason), icon: 'none', duration: 1800 });
    }
    try {
      const doneIds: string[] = [];
      if (this.data.isGroup) {
        // 组模式：完成 = 把所有还没勾的子任务一并按结果提交（已勾的计时中已提交）
        const pending = this.data.steps.filter((s) => !s.done);
        const actualEach = pending.length ? Math.round((this.data.duration - Math.floor(this.data.remainSec / 60)) / pending.length) : 0;
        for (const s of pending) {
          const payload = { task_id: s.task_id, actual_duration: actualEach || 0, result, skip_reason };
          try { await api.completeTask(payload); } catch (e: any) { if (e.code === 0) stashComplete(payload); }
        }
        // 整组（含计时中已勾的）都已离开待办：从缓存移除全部子任务
        this.data.steps.forEach((s) => doneIds.push(s.task_id));
      } else {
        const t = this.data.task!;
        const actual = this.data.duration - Math.floor(this.data.remainSec / 60);
        const payload = { task_id: t.task_id, actual_duration: actual || t.duration, result, skip_reason };
        try { await api.completeTask(payload); } catch (e: any) { if (e.code === 0) stashComplete(payload); }
        doneIds.push(t.task_id);
      }
      // 同步首页缓存：移除已处理任务，使同天返回的缓存渲染正确（不复活已完成项）
      const rest = getCachedTasks().filter((t) => !doneIds.includes(t.task_id));
      cacheTasks(rest);
      await api.compute(result); // 弹性重排（服务端，跨天或下次主动刷新时生效）
      if (result === 'complete') this.maybeLearn(); // 完成后触发隐形学习（当天只学一次）
    } catch (e) { /* 已在分支内兜底 */ }
    wx.navigateBack();
  },

  // 隐形学习触发（节流）：与 home.maybeLearn 共用 last_learn_day，当天只学一次。
  // 纯数据库+数学，不调 AI；失败静默并回退标记，下次再试。
  maybeLearn() {
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    if (wx.getStorageSync('last_learn_day') === today) return;
    wx.setStorageSync('last_learn_day', today);
    api.learnProfile().catch(() => {
      if (wx.getStorageSync('last_learn_day') === today) wx.removeStorageSync('last_learn_day');
    });
  },

  onUnload() { if (this.timer) clearInterval(this.timer); },
});
