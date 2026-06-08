// cloudfunctions/schedule_compute/scheduler.js — 排期算法（纯函数，可独立测试）

const BUFFER_RATIO = 0.8;

/**
 * 解析 "HH:mm-HH:mm" → [开始分钟, 结束分钟]
 */
function parseRange(range) {
  const [s, e] = range.split('-');
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return [toMin(s), toMin(e)];
}

/** 某时刻是否落在高峰时段内 */
function inPeak(minuteOfDay, peakRanges) {
  return peakRanges.some(([s, e]) => minuteOfDay >= s && minuteOfDay < e);
}

// 跳过归因权重（规则5）：区分「你的问题」和「环境的问题」。
// 没状态=回避信号，正常往后压；临时取消=计划变更，中性；等待外部=环境阻塞，不惩罚。
const SKIP_WEIGHTS = { 没状态: 1, 临时取消: 0.5, 等待外部: 0 };

/**
 * 把某任务的跳过历史折算成「回避分」。分越高越往后排。
 * 兼容两种入参：数字（旧版原始计数）或 { 没状态, 等待外部, 临时取消 } 归因映射。
 */
function skipScore(entry) {
  if (entry == null) return 0;
  if (typeof entry === 'number') return entry; // 旧版：原始计数
  return Object.keys(entry).reduce((sum, reason) => {
    const w = SKIP_WEIGHTS[reason] !== undefined ? SKIP_WEIGHTS[reason] : 1;
    return sum + w * (entry[reason] || 0);
  }, 0);
}

/**
 * 计算当日总容量（分钟）。
 */
function dailyCapacity(idealWorkHours) {
  return Math.round(idealWorkHours * 60 * BUFFER_RATIO);
}

/**
 * 核心排期：对 pending 任务排序、分配 scheduled_time、计算溢出。
 * @param {object} ctx { tasks, profile, nowMinute, skipStats }
 *   tasks: [{task_id, duration, is_priority, project_tag, action, vision_statement, skip_count}]
 *   profile: { peak_hours: [], ideal_work_hours }
 *   nowMinute: 当前时刻（分钟），daily_init 时为一天起点
 * @returns { ordered_tasks, overflow_tasks, daily_capacity_used, daily_capacity_total }
 */
/**
 * 应用隐形学习的耗时偏差校正（规则3）。
 * profile.duration_bias 是一个全局系数（实际/预估的中位值），如 1.4 表示用户整体高估。
 * 有系数则按其放大/缩小预估耗时，让排期贴近真实节奏；无则原样返回。
 */
function biasedDuration(task, durationBias) {
  const raw = task.duration || 30;
  if (!durationBias) return raw;
  return Math.round(raw * durationBias);
}

function schedule(ctx) {
  const { tasks = [], profile = {}, nowMinute = 540, skipStats = {}, usedMinutes = 0 } = ctx;
  const peakRanges = (profile.peak_hours || []).map(parseRange);
  const capacityTotal = dailyCapacity(profile.ideal_work_hours || 6);
  const durationBias = profile.duration_bias || null;
  // 待办可用容量 = 总容量 - 今日已完成时长，避免与已完成重复计账（否则 capUsed 可超总量）
  const available = Math.max(0, capacityTotal - usedMinutes);

  // 排序：紧急度 > 命中高峰(可填入高峰优先) > 历史跳过少 > 创建早
  const sorted = [...tasks].sort((a, b) => {
    if (!!b.is_priority !== !!a.is_priority) return b.is_priority ? 1 : -1;
    const sa = skipScore(skipStats[a.task_id]);
    const sb = skipScore(skipStats[b.task_id]);
    if (sa !== sb) return sa - sb; // 回避分低的优先（等待外部不计回避）
    return (a.created_at || 0) - (b.created_at || 0);
  });

  const ordered = [];
  const overflow = [];
  let cursor = nowMinute;
  let used = 0;

  for (const t of sorted) {
    const dur = biasedDuration(t, durationBias);
    // 容量已满，或排到此任务会越过午夜 → 溢出，不静默回绕到次日凌晨
    if (used + dur > available || cursor + dur > MINUTES_IN_DAY) {
      overflow.push({ ...t, reason: 'capacity_full' });
      continue;
    }
    ordered.push({
      ...t,
      type: 'normal',
      scheduled_time: minToHHmm(cursor),
      in_peak: inPeak(cursor, peakRanges),
    });
    cursor += dur;
    used += dur;
  }

  return {
    ordered_tasks: ordered,
    overflow_tasks: overflow,
    daily_capacity_used: used,
    daily_capacity_total: capacityTotal,
  };
}

const MINUTES_IN_DAY = 24 * 60;

function minToHHmm(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = { schedule, dailyCapacity, parseRange, inPeak, minToHHmm, BUFFER_RATIO };
