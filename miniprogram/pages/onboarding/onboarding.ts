// pages/onboarding/onboarding.ts — 冷启动引导 2 问（选完自动跳；每日工时留待定项目时匹配）
import { api } from '../../utils/api';
import { getUserId } from '../../utils/auth';
import { stashProfile } from '../../utils/store';

// Q1 自然醒 → 推导精力高峰（醒后 2~4h 为认知峰值）。含「说不准」兜底。
const WAKE_OPTIONS = [
  { value: 'early',  label: '🌅 6 点前就醒了',     peak: ['08:00-11:00'] },
  { value: 'mid_am', label: '🌤 7~8 点',          peak: ['09:00-12:00'] },
  { value: 'mid',    label: '☀️ 9~10 点',         peak: ['11:00-14:00'] },
  { value: 'late',   label: '🌙 10 点以后',        peak: ['15:00-18:00', '20:00-22:00'] },
  { value: 'unsure', label: '🤷 说不准 / 没观察过', peak: ['09:00-11:00', '15:00-17:00'] },
];

// Q2 单次专注耐受 → 治愈间隙节奏。含「不清楚」兜底（45）。
const FOCUS_OPTIONS = [
  { value: 25, label: '🍅 25 分钟左右' },
  { value: 45, label: '⏱ 45 分钟左右' },
  { value: 90, label: '🔋 90 分钟也行' },
  { value: 45, label: '🤷 不清楚（先按 45）' },
];

// Q3 每日可投入时长 → 容量初值。后续由 profile_learn 按实际完成情况隐形微调。
const WORK_HOURS_OPTIONS = [
  { value: 2, label: '🌱 1~2 小时（业余 / 通勤间隙）' },
  { value: 4, label: '☕ 3~4 小时（有本职，挤时间）' },
  { value: 6, label: '💪 5~6 小时（较自由）' },
  { value: 8, label: '🔥 8 小时以上（全职投入）' },
];

// 每日容量默认种子（小时）。仅当用户跳过/异常时兜底，正常由 Q3 选定、再由实际耗时校正。
const DEFAULT_IDEAL_HOURS = 4;

Page({
  data: {
    step: 1,
    wakeOptions: WAKE_OPTIONS,
    focusOptions: FOCUS_OPTIONS,
    workHoursOptions: WORK_HOURS_OPTIONS,
    wakeIdx: -1,
    focusIdx: -1,
    workIdx: -1,
  },

  pickWake(e: WechatMiniprogram.TouchEvent) {
    this.setData({ wakeIdx: Number(e.currentTarget.dataset.i) });
    setTimeout(() => this.setData({ step: 2 }), 220); // 让用户看到高亮反馈再跳
  },
  pickFocus(e: WechatMiniprogram.TouchEvent) {
    this.setData({ focusIdx: Number(e.currentTarget.dataset.i) });
    setTimeout(() => this.setData({ step: 3 }), 220);
  },
  pickWork(e: WechatMiniprogram.TouchEvent) {
    this.setData({ workIdx: Number(e.currentTarget.dataset.i) });
    setTimeout(() => this.finish(), 220); // 最后一问，选完直接完成
  },

  async finish() {
    const wake = WAKE_OPTIONS[this.data.wakeIdx];
    const workHours = this.data.workIdx >= 0 ? WORK_HOURS_OPTIONS[this.data.workIdx].value : DEFAULT_IDEAL_HOURS;
    const profile = {
      peak_hours: wake.peak,                          // 由作息推导
      wake_type: wake.value,
      focus_tolerance: FOCUS_OPTIONS[this.data.focusIdx].value,
      pain_task_types: [],
      ideal_work_hours: workHours,                     // 用户设定初值，后续隐形学习微调
      user_id: getUserId(),
    };
    try {
      await api.initProfile(profile);
      getApp<IAppOption>().globalData.profileReady = true;
    } catch (e) {
      stashProfile(profile);
    }
    wx.reLaunch({ url: '/pages/home/home' });
  },
});
