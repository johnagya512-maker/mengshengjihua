// pages/focus/focus.ts — 专注计时执行页
import { api } from '../../utils/api';
import {
  getCachedTasks, stashComplete,
  setActiveTask, clearActiveTask,
} from '../../utils/store';
import { SKIP_REASONS } from '../../utils/constants';
import { skipReply } from '../../utils/coach';

Page({
  data: {
    task: null as Task | null,
    duration: 30,          // 可微调
    durationPresets: [15, 25, 30, 45, 60, 90],  // 常用时长档位（番茄钟25、半小时、1小时等）
    phase: 'confirm' as 'confirm' | 'running' | 'finish',
    remainSec: 0,
    timeLabel: '00:00',
    progress: 0,           // 计时进度百分比（已过 / 计划）
    showSkip: false,
    skipReasons: SKIP_REASONS,
  },
  timer: 0 as any,

  onLoad(q: Record<string, string>) {
    const task = getCachedTasks().find((t) => t.task_id === q.task_id) || null;
    if (!task) { wx.navigateBack(); return; }
    this.setData({ task, duration: task.duration });
  },

  // 选时长档位（预设芯片，一步到位）
  pickDuration(e: WechatMiniprogram.TouchEvent) {
    this.setData({ duration: Number(e.currentTarget.dataset.m) });
  },

  // 确认阶段返回今日列表（计时未开始，无副作用）
  goBack() { wx.navigateBack(); },

  start() {
    const sec = this.data.duration * 60;
    const t = this.data.task!;
    setActiveTask({ task_id: t.task_id, action: t.action, started_at: Date.now(), planned_duration: this.data.duration });
    this.setData({ phase: 'running', remainSec: sec, timeLabel: this.fmt(sec), progress: 0 });
    this.timer = setInterval(() => {
      const r = this.data.remainSec - 1;
      if (r <= 0) {
        clearInterval(this.timer);
        this.setData({ remainSec: 0, timeLabel: '00:00', progress: 100, phase: 'finish' });
      } else {
        this.setData({ remainSec: r, timeLabel: this.fmt(r), progress: Math.round(((sec - r) / sec) * 100) });
      }
    }, 1000);
  },

  fmt(sec: number): string {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  // 提前结束
  earlyFinish() { clearInterval(this.timer); this.setData({ phase: 'finish' }); },

  async complete() {
    await this.submit('complete');
  },
  openSkip() { this.setData({ showSkip: true }); },
  closeSkip() { this.setData({ showSkip: false }); },
  noop() {},
  async chooseSkip(e: WechatMiniprogram.TouchEvent) {
    await this.submit('skip', e.currentTarget.dataset.r as SkipReason);
  },

  async submit(result: 'complete' | 'skip', skip_reason?: SkipReason) {
    const t = this.data.task!;
    const actual = this.data.duration - Math.floor(this.data.remainSec / 60);
    const payload = { task_id: t.task_id, actual_duration: actual || t.duration, result, skip_reason };
    clearActiveTask();
    // 跳过：按归因给教练式接话（不评判）
    if (result === 'skip' && skip_reason) {
      wx.showToast({ title: skipReply(skip_reason), icon: 'none', duration: 1800 });
    }
    try {
      await api.completeTask(payload);
      await api.compute(result); // 弹性重排
    } catch (e: any) {
      if (e.code === 0) stashComplete(payload); // 断网缓存
    }
    wx.navigateBack();
  },

  onUnload() { if (this.timer) clearInterval(this.timer); },
});
