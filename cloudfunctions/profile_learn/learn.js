// cloudfunctions/profile_learn/learn.js — 隐形学习纯函数（可独立测试，对应设计文档规则2/3/5）

const WINDOW_DAYS = 21;        // 滚动窗口：只看最近 3 周（护栏2）
const COLD_START_MIN = 20;     // 冷启动门槛：完成 < 20 条不学（护栏1）
const BUFFER_RATIO = 0.8;      // 与排期引擎一致的缓冲系数
const DAY_MS = 86400 * 1000;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function cstDate(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 规则2 每日容量：近 3 周「实际完成总时长」的按天中位数（治规划谬误）
function learnCapacity(doneTasks, nowMs) {
  const cutoff = nowMs - WINDOW_DAYS * DAY_MS;
  const byDay = {};
  doneTasks.forEach((t) => {
    if (!t.finished_at || t.finished_at < cutoff) return;
    const mins = t.actual_duration || t.duration || 0;
    byDay[cstDate(t.finished_at)] = (byDay[cstDate(t.finished_at)] || 0) + mins;
  });
  const dailyTotals = Object.values(byDay);
  const med = median(dailyTotals);
  const idealHours = med ? Math.round((med / (60 * BUFFER_RATIO)) * 2) / 2 : 0;
  return {
    median_daily_minutes: Math.round(med),
    ideal_work_hours: idealHours ? clamp(idealHours, 1, 12) : 0,
    active_days: dailyTotals.length,
  };
}
// 规则3 耗时预估校正：学一个全局「实际/预估」系数（用户整体高估/低估多少）。
// 不按任务类型分桶——当前任务无类型，分桶只会稀释样本、放大噪声。
function learnDurationBias(doneTasks, nowMs) {
  const cutoff = nowMs - WINDOW_DAYS * DAY_MS;
  const ratios = [];
  doneTasks.forEach((t) => {
    if (!t.finished_at || t.finished_at < cutoff) return;
    const est = t.duration || 0;
    const act = t.actual_duration || 0;
    if (!est || !act) return;
    ratios.push(act / est);
  });
  if (ratios.length < 3) return 0; // 样本不足，不校正
  return Math.round(clamp(median(ratios), 0.5, 2.5) * 100) / 100;
}

// 规则5 跳过归因：区分「你的问题」和「环境的问题」
function learnSkipAttribution(skipLogs, nowMs) {
  const cutoff = nowMs - WINDOW_DAYS * DAY_MS;
  const counts = { 没状态: 0, 等待外部: 0, 临时取消: 0 };
  skipLogs.forEach((s) => {
    if (!s.created_at || s.created_at < cutoff) return;
    if (counts[s.skip_reason] !== undefined) counts[s.skip_reason] += 1;
  });
  const total = counts.没状态 + counts.等待外部 + counts.临时取消;
  return {
    skip_counts: counts,
    energy_mismatch_ratio: total ? Math.round((counts.没状态 / total) * 100) / 100 : 0,
    blocked_ratio: total ? Math.round((counts.等待外部 / total) * 100) / 100 : 0,
  };
}
// 主入口：汇总三条规则，产出 profile 增量 + learning_meta（可解释、可调试）
function learn({ doneTasks = [], skipLogs = [], nowMs }) {
  const sampleSize = doneTasks.length;
  const cold = sampleSize < COLD_START_MIN; // 护栏1：样本不足先用默认
  const meta = { learned_at: nowMs, sample_size: sampleSize, window_days: WINDOW_DAYS, is_cold_start: cold };
  if (cold) return { updates: {}, learning_meta: meta };

  const cap = learnCapacity(doneTasks, nowMs);
  const updates = {};
  if (cap.ideal_work_hours) updates.ideal_work_hours = cap.ideal_work_hours; // 喂给排期引擎
  const duration_bias = learnDurationBias(doneTasks, nowMs);
  if (duration_bias) updates.duration_bias = duration_bias; // 全局系数，0 表示样本不足不校正

  return {
    updates,
    learning_meta: {
      ...meta,
      median_daily_minutes: cap.median_daily_minutes,
      active_days: cap.active_days,
      duration_bias,
      skip: learnSkipAttribution(skipLogs, nowMs),
    },
  };
}

module.exports = { learn, learnCapacity, learnDurationBias, learnSkipAttribution, median };
