// pages/home/home.ts — 主界面：今日队列 / 进度胶囊 / 任务输入
import { api } from '../../utils/api';
import { isLoggedIn } from '../../utils/auth';
import {
  cacheTasks, getCachedTasks, cacheCapacity, getCachedCapacity,
  stashInput, drainInputs, hasPendingInput, drainProfile,
  stashComplete, drainCompletes, hasPendingComplete,
  getActiveTask, clearActiveTask,
} from '../../utils/store';
import { getUserId } from '../../utils/auth';
import { startVoice, stopVoice } from '../../utils/voice';
import { completeEcho, progressLine } from '../../utils/coach';

Page({
  data: {
    tasks: [] as Task[],
    current: null as Task | null,
    doneTasks: [] as Task[],             // 今日及历史已完成/跳过，划线留痕，用户自删
    capUsed: 0,
    capTotal: 0,
    remainLabel: '0 小时 0 分钟',
    showInput: false,
    inputText: '',
    recording: false,
    parsing: false,
    parseCard: null as ParseResult | null,
    overflowTask: null as Task | null,   // 容量饱和待确认
    coachLine: '',                       // 教练式进度行
    allowSplit: false,                   // 是否让 AI 拆分大事（默认关，快速建单条）
  },

  onLoad() {
    if (!isLoggedIn()) { wx.reLaunch({ url: '/pages/guide/guide' }); return; }
    // 秒开：先渲染缓存
    const cached = getCachedTasks();
    const cap = getCachedCapacity();
    this.applyTasks(cached);
    this.applyCapacity(cap.used, cap.total);
  },

  onShow() {
    this.syncOffline();
    this.checkInterrupted();
    this.refresh('daily_init');
  },

  // 拉取最新排期
  async refresh(trigger: ScheduleTrigger) {
    try {
      const r = await api.compute(trigger);
      // 合并溢出任务一起显示：容量是柔性提示，不应隐藏用户已添加的任务
      const all = [...r.ordered_tasks, ...(r.overflow_tasks || [])];
      this.applyTasks(all, r.done_today, r.done_tasks || []);
      this.applyCapacity(r.daily_capacity_used, r.daily_capacity_total);
      cacheTasks(all);
      cacheCapacity(r.daily_capacity_used, r.daily_capacity_total);
    } catch (e) { /* 用缓存兜底 */ }
  },

  applyTasks(tasks: Task[], doneToday = 0, doneTasks?: Task[]) {
    const pending = tasks.filter((t) => t.status === 'pending' || !t.status);
    const coachLine = pending.length > 0 ? progressLine(doneToday, pending.length) : '';
    const patch: any = { tasks: pending, current: pending[0] || null, coachLine };
    if (doneTasks) patch.doneTasks = doneTasks; // 仅在有新数据时更新，避免缓存渲染清空留痕
    this.setData(patch);
  },

  applyCapacity(used: number, total: number) {
    const remain = Math.max(0, total - used);
    const h = Math.floor(remain / 60);
    const m = remain % 60;
    this.setData({ capUsed: used, capTotal: total, remainLabel: `${h} 小时 ${m} 分钟` });
  },

  // 离线数据恢复同步
  async syncOffline() {
    const profile = drainProfile();
    if (profile) { try { await api.initProfile(profile); } catch (e) { /* 下次再试 */ } }
    // 离线完成状态回放（TC-012）
    if (hasPendingComplete()) {
      const items = drainCompletes();
      for (const p of items) {
        try { await api.completeTask(p); }
        catch (e) { stashComplete(p); /* 回放失败：写回队列，下次再试，避免完成记录丢失 */ }
      }
    }
    if (hasPendingInput()) {
      wx.showToast({ title: '有一条任务还没处理', icon: 'none' });
      const inputs = drainInputs();
      for (const text of inputs) { try { await this.doParse(text); } catch (e) { stashInput(text); } }
    }
  },

  // 中断恢复（TC-011）：上次有进行中任务
  checkInterrupted() {
    const active = getActiveTask();
    if (!active) return;
    wx.showModal({
      title: '任务做完了吗？',
      content: active.action,
      confirmText: '完成了',
      cancelText: '跳过',
      success: async (res) => {
        const result = res.confirm ? 'complete' : 'skip';
        try {
          await api.completeTask({
            task_id: active.task_id,
            actual_duration: active.planned_duration,
            result,
            ...(result === 'skip' ? { skip_reason: '临时取消' as SkipReason } : {}),
          });
          await this.refresh('complete');
        } catch (e) { /* 网络异常下次再问 */ }
        clearActiveTask();
      },
    });
  },

  // ---- 任务输入 ----
  openInput() { this.setData({ showInput: true, inputText: '', parseCard: null }); },
  closeInput() { this.setData({ showInput: false, inputText: '', parseCard: null }); },
  onInput(e: WechatMiniprogram.Input) { this.setData({ inputText: e.detail.value }); },
  onToggleSplit(e: WechatMiniprogram.SwitchChange) { this.setData({ allowSplit: e.detail.value }); },
  noop() {}, // 拦截面板内点击冒泡到遮罩，避免误关闭

  // ---- 语音录入：长按说话 ----
  startRecord() {
    this.setData({ recording: true });
    startVoice({
      onResult: (text) => {
        this.setData({ recording: false, inputText: (this.data.inputText + text).slice(0, 500) });
      },
      onError: (msg) => {
        this.setData({ recording: false });
        wx.showToast({ title: msg, icon: 'none' }); // 「没录到声音」时保留文字输入兜底
      },
    });
  },
  stopRecord() {
    if (this.data.recording) stopVoice();
  },

  async submitInput() {
    if (this.data.parsing) return; // 防重复提交
    const text = this.data.inputText.trim();
    if (!text) return wx.showToast({ title: '说点什么吧', icon: 'none' });
    // 快速添加：不走 AI，直接存一条任务（默认时长/项目），秒记
    if (!this.data.allowSplit) {
      return this.quickAdd(text);
    }
    // 拆分模式：交给 AI 解析后出确认卡片
    try {
      await this.doParse(text);
    } catch (e: any) {
      // code===0 是调用彻底失败：可能断网，也可能云函数没部署。
      // 仅在确认断网时才暂存并关面板；否则保留输入与面板，让用户重试。
      if (e && e.code === 0) {
        wx.getNetworkType({
          success: (n) => {
            if (n.networkType === 'none') { stashInput(text); this.closeInput(); }
          },
        });
      }
      // 其它错误（超时/500/函数报错）：错误提示已由 request 层弹出，输入保留
    }
  },

  // 快速添加：零等待。先本地显示，再后台保存+重排，不阻塞 UI
  quickAdd(text: string) {
    const action = text.slice(0, 100);
    // 1) 立即显示，关面板 —— 不 await 任何网络。无项目（项目由用户自建）
    const optimistic = {
      task_id: `local_${Date.now()}`, project_id: '', project_tag: '',
      action, duration: 30, vision_statement: '',
      type: 'normal', status: 'pending', scheduled_time: '',
    } as Task;
    const merged = [...this.data.tasks, optimistic];
    this.applyTasks(merged);
    cacheTasks(merged);
    this.closeInput();
    wx.showToast({ title: '已添加', icon: 'success', duration: 1200 });
    // 2) 后台保存 + 重排；成功则用真实排期覆盖，失败保留本地任务
    (async () => {
      try {
        await api.saveTask({ action, duration: 30, vision_statement: '' });
        const r = await api.compute('add_task');
        const all = [...r.ordered_tasks, ...(r.overflow_tasks || [])];
        this.applyTasks(all, r.done_today);
        this.applyCapacity(r.daily_capacity_used, r.daily_capacity_total);
        cacheTasks(all);
        cacheCapacity(r.daily_capacity_used, r.daily_capacity_total);
      } catch (e: any) {
        if (e && e.code === 0) stashInput(text); // 断网暂存，本地任务仍在
      }
    })();
  },

  async doParse(text: string) {
    this.setData({ parsing: true });
    try {
      const card = await api.parseTask(text, this.data.allowSplit);
      // 强制打开面板：避免旧请求超时关闭面板后，新数据回来却无处显示
      this.setData({ parseCard: card, showInput: true });
    } finally {
      this.setData({ parsing: false });
    }
  },

  onCardChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ parseCard: { ...this.data.parseCard!, ...e.detail } });
  },

  // 确认卡片 → 写队列 → 重排（支持大事拆分：多子任务依次入队）
  async confirmCard() {
    const c = this.data.parseCard;
    if (!c) return;
    try {
      if (c.is_big_task && c.subtasks && c.subtasks.length >= 2) {
        // 大事：生成共享父身份，每个子任务作为可执行任务挂在这件大事下
        const parentTaskId = `pt_${Date.now()}`;
        for (const s of c.subtasks) {
          await api.saveTask({
            action: s.action, duration: s.duration,
            project_tag: c.project_tag, vision_statement: c.vision_statement,
            parent_task_id: parentTaskId, parent_action: c.action,
          });
        }
      } else {
        await api.saveTask({
          action: c.action, duration: c.duration,
          project_tag: c.project_tag, vision_statement: c.vision_statement,
        });
      }
      this.closeInput();
      // 容量检测：重排后若有溢出，询问移次日
      const r = await api.compute('add_task');
      if (r.overflow_tasks && r.overflow_tasks.length > 0) {
        this.setData({ overflowTask: r.overflow_tasks[0] });
      }
      this.applyTasks(r.ordered_tasks);
      this.applyCapacity(r.daily_capacity_used, r.daily_capacity_total);
      cacheTasks(r.ordered_tasks);
      cacheCapacity(r.daily_capacity_used, r.daily_capacity_total);
    } catch (e) { /* 提示已由 request 层弹出 */ }
  },

  // 容量饱和确认：移次日 —— 真正把任务标记到次日队列，跨天后自动回归今日
  async confirmMoveTomorrow() {
    const t = this.data.overflowTask;
    this.setData({ overflowTask: null });
    if (!t) return;
    try {
      await api.deferTask(t.task_id);
      // 从今日列表移除该任务，刷新容量
      const rest = this.data.tasks.filter((x) => x.task_id !== t.task_id);
      this.applyTasks(rest);
      cacheTasks(rest);
      wx.showToast({ title: '已移到明天', icon: 'none', duration: 1200 });
    } catch (e) {
      wx.showToast({ title: '移动失败，任务留在今天', icon: 'none' });
    }
  },
  // 强制今天：不移走，溢出任务留在今日末尾（用户自行承担超载）
  forceToday() { this.setData({ overflowTask: null }); },

  // 开始执行 → 跳转专注页
  startTask() {
    const t = this.data.current;
    if (!t) return;
    wx.navigateTo({ url: `/pages/focus/focus?task_id=${t.task_id}` });
  },

  // 从待办列表点某条任务：提到顶部成为当前任务卡，再由用户点「开始」进专注页
  selectTask(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const picked = this.data.tasks.find((t) => t.task_id === id);
    if (!picked) return;
    const rest = this.data.tasks.filter((t) => t.task_id !== id);
    const reordered = [picked, ...rest];
    this.applyTasks(reordered);
    cacheTasks(reordered);
  },

  // 从待办列表点某条任务直接进专注页
  startTaskById(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/focus/focus?task_id=${id}` });
  },

  // 直接完成：不走计时，App 外做完的事一键勾掉。耗时用预估值兜底
  completeDirect(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const task = this.data.tasks.find((t) => t.task_id === id);
    if (!task) return;
    const rest = this.data.tasks.filter((t) => t.task_id !== id);
    this.applyTasks(rest, 0, [{ ...task, status: 'done' }, ...this.data.doneTasks]);
    wx.showToast({ title: '清掉一件，牛', icon: 'none', duration: 1200 });
    (async () => {
      try {
        await api.completeTask({ task_id: id, actual_duration: task.duration, result: 'complete' });
        await this.refresh('complete');
      } catch (err) { /* 失败下次刷新自愈 */ }
    })();
  },

  // 删除一条已完成/跳过留痕（用户主动清理）。乐观删除：先从列表移除，再后台删库
  deleteDone(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const rest = this.data.doneTasks.filter((t) => t.task_id !== id);
    this.setData({ doneTasks: rest });
    api.deleteTask(id).catch(() => {
      wx.showToast({ title: '删除失败，下次刷新会恢复', icon: 'none' });
    });
  },
});
