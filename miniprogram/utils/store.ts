// utils/store.ts — 本地缓存与离线暂存（秒开 + 断网兜底）

const KEY_TASKS = 'today_tasks';        // 今日队列缓存
const KEY_CAPACITY = 'today_capacity';  // 进度胶囊数据
const KEY_PENDING_INPUT = 'pending_input';   // 断网未处理的输入
const KEY_PENDING_COMPLETE = 'pending_complete'; // 断网未同步的完成状态
const KEY_PENDING_PROFILE = 'pending_profile';

// ---- 今日队列 ----
export function cacheTasks(tasks: Task[]): void {
  wx.setStorageSync(KEY_TASKS, tasks);
}
export function getCachedTasks(): Task[] {
  return wx.getStorageSync(KEY_TASKS) || [];
}

export function cacheCapacity(used: number, total: number): void {
  wx.setStorageSync(KEY_CAPACITY, { used, total });
}
export function getCachedCapacity(): { used: number; total: number } {
  return wx.getStorageSync(KEY_CAPACITY) || { used: 0, total: 0 };
}

// ---- 离线暂存：输入 ----
export function stashInput(text: string): void {
  const list: string[] = wx.getStorageSync(KEY_PENDING_INPUT) || [];
  list.push(text);
  wx.setStorageSync(KEY_PENDING_INPUT, list);
}
export function drainInputs(): string[] {
  const list = wx.getStorageSync(KEY_PENDING_INPUT) || [];
  wx.removeStorageSync(KEY_PENDING_INPUT);
  return list;
}
export function hasPendingInput(): boolean {
  return (wx.getStorageSync(KEY_PENDING_INPUT) || []).length > 0;
}

// ---- 离线暂存：完成状态 ----
export function stashComplete(payload: any): void {
  const list = wx.getStorageSync(KEY_PENDING_COMPLETE) || [];
  list.push(payload);
  wx.setStorageSync(KEY_PENDING_COMPLETE, list);
}
export function drainCompletes(): any[] {
  const list = wx.getStorageSync(KEY_PENDING_COMPLETE) || [];
  wx.removeStorageSync(KEY_PENDING_COMPLETE);
  return list;
}

// ---- 离线暂存：Profile ----
export function stashProfile(p: any): void {
  wx.setStorageSync(KEY_PENDING_PROFILE, p);
}
export function drainProfile(): any | null {
  const p = wx.getStorageSync(KEY_PENDING_PROFILE) || null;
  if (p) wx.removeStorageSync(KEY_PENDING_PROFILE);
  return p;
}

export function hasPendingComplete(): boolean {
  return (wx.getStorageSync(KEY_PENDING_COMPLETE) || []).length > 0;
}

// ---- 进行中任务（中断恢复 TC-011）----
const KEY_ACTIVE = 'active_task';
export interface ActiveTask {
  task_id: string;
  action: string;
  started_at: number;
  planned_duration: number; // 分钟
}
export function setActiveTask(t: ActiveTask): void {
  wx.setStorageSync(KEY_ACTIVE, t);
}
export function getActiveTask(): ActiveTask | null {
  return wx.getStorageSync(KEY_ACTIVE) || null;
}
export function clearActiveTask(): void {
  wx.removeStorageSync(KEY_ACTIVE);
}
